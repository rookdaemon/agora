/**
 * Verification record creation and validation.
 * Implements signed verification of agent outputs.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { VerificationRecord, ValidationResult } from './types.js';

/**
 * Canonical form of a verification for signing/hashing.
 * Deterministic JSON serialization with sorted keys.
 */
function canonicalizeVerification(
  verifier: string,
  target: string,
  domain: string,
  verdict: 'correct' | 'incorrect' | 'disputed',
  confidence: number,
  timestamp: number,
  evidence?: string,
): string {
  const obj: Record<string, unknown> = {
    confidence,
    domain,
    target,
    timestamp,
    verdict,
    verifier,
  };
  
  if (evidence !== undefined) {
    obj.evidence = evidence;
  }
  
  // Sort keys and stringify
  const sorted = Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {} as Record<string, unknown>);
  
  return JSON.stringify(sorted);
}

/**
 * Compute content-addressed ID for a verification.
 */
function computeVerificationId(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a signed verification record.
 * 
 * @param verifier - Public key of verifying agent
 * @param privateKey - Private key for signing
 * @param target - ID of message/output being verified
 * @param domain - Capability domain
 * @param verdict - Verification verdict
 * @param confidence - Verifier's confidence (0-1)
 * @param evidence - Optional evidence link
 * @returns Signed VerificationRecord
 */
export function createVerification(
  verifier: string,
  privateKey: string,
  target: string,
  domain: string,
  verdict: 'correct' | 'incorrect' | 'disputed',
  confidence: number,
  evidence?: string,
): VerificationRecord {
  const timestamp = Date.now();
  
  // Validate inputs
  if (confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }
  
  const canonical = canonicalizeVerification(
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
    evidence,
  );
  
  const id = computeVerificationId(canonical);
  const signature = signMessage(canonical, privateKey);
  
  return {
    id,
    verifier,
    target,
    domain,
    verdict,
    confidence,
    ...(evidence !== undefined ? { evidence } : {}),
    timestamp,
    signature,
  };
}

/**
 * Validate a verification record's structure and signature.
 * 
 * @param record - Verification record to validate
 * @returns Validation result with errors if invalid
 */
export function validateVerification(record: VerificationRecord): ValidationResult {
  const errors: string[] = [];
  
  // Check required fields
  if (!record.id) errors.push('Missing field: id');
  if (!record.verifier) errors.push('Missing field: verifier');
  if (!record.target) errors.push('Missing field: target');
  if (!record.domain) errors.push('Missing field: domain');
  if (!record.verdict) errors.push('Missing field: verdict');
  if (record.confidence === undefined) errors.push('Missing field: confidence');
  if (!record.timestamp) errors.push('Missing field: timestamp');
  if (!record.signature) errors.push('Missing field: signature');
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Validate verdict
  if (!['correct', 'incorrect', 'disputed'].includes(record.verdict)) {
    errors.push('Invalid verdict: must be correct, incorrect, or disputed');
  }
  
  // Validate confidence
  if (record.confidence < 0 || record.confidence > 1) {
    errors.push('Invalid confidence: must be between 0 and 1');
  }
  
  // Validate timestamp
  if (typeof record.timestamp !== 'number' || record.timestamp <= 0) {
    errors.push('Invalid timestamp: must be positive number');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Verify signature
  const canonical = canonicalizeVerification(
    record.verifier,
    record.target,
    record.domain,
    record.verdict,
    record.confidence,
    record.timestamp,
    record.evidence,
  );
  
  const expectedId = computeVerificationId(canonical);
  if (record.id !== expectedId) {
    errors.push('ID mismatch: computed ID does not match record ID');
  }
  
  const signatureValid = verifySignature(canonical, record.signature, record.verifier);
  if (!signatureValid) {
    errors.push('Invalid signature');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}
