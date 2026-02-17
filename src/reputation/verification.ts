/**
 * Verification record creation and validation.
 * 
 * Provides functions to create and verify verification records
 * for building computational reputation.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { VerificationRecord } from './types.js';

/**
 * Deterministic JSON serialization with recursively sorted keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Creates a signed verification record.
 * 
 * @param verifier - Public key of the verifying agent
 * @param privateKey - Private key for signing
 * @param target - ID of message/output being verified
 * @param domain - Capability domain
 * @param verdict - Verification verdict
 * @param confidence - Verifier's confidence (0-1)
 * @param evidence - Optional evidence link
 * @returns Signed verification record
 */
export function createVerification(
  verifier: string,
  privateKey: string,
  target: string,
  domain: string,
  verdict: 'correct' | 'incorrect' | 'disputed',
  confidence: number,
  evidence?: string
): VerificationRecord {
  // Validate inputs
  if (confidence < 0 || confidence > 1) {
    throw new Error('Confidence must be between 0 and 1');
  }

  const timestamp = Date.now();
  
  // Build record without signature
  const recordWithoutSig: Omit<VerificationRecord, 'id' | 'signature'> = {
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
  };
  
  if (evidence !== undefined) {
    recordWithoutSig.evidence = evidence;
  }
  
  // Compute content-addressed ID
  const canonical = stableStringify(recordWithoutSig);
  const id = createHash('sha256').update(canonical).digest('hex');
  
  // Sign the canonical representation
  const signature = signMessage(canonical, privateKey);
  
  return {
    id,
    ...recordWithoutSig,
    signature,
  };
}

/**
 * Validates a verification record.
 * 
 * @param record - Verification record to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateVerification(record: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return ['Verification record must be an object'];
  }
  
  const r = record as Partial<VerificationRecord>;
  
  // Check required fields
  if (typeof r.id !== 'string') {
    errors.push('Missing or invalid field: id');
  }
  if (typeof r.verifier !== 'string') {
    errors.push('Missing or invalid field: verifier');
  }
  if (typeof r.target !== 'string') {
    errors.push('Missing or invalid field: target');
  }
  if (typeof r.domain !== 'string') {
    errors.push('Missing or invalid field: domain');
  }
  if (!['correct', 'incorrect', 'disputed'].includes(r.verdict as string)) {
    errors.push('Invalid verdict: must be correct, incorrect, or disputed');
  }
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    errors.push('Invalid confidence: must be a number between 0 and 1');
  }
  if (typeof r.timestamp !== 'number') {
    errors.push('Missing or invalid field: timestamp');
  }
  if (typeof r.signature !== 'string') {
    errors.push('Missing or invalid field: signature');
  }
  
  // Check optional fields
  if (r.evidence !== undefined && typeof r.evidence !== 'string') {
    errors.push('Invalid field: evidence must be a string');
  }
  
  return errors;
}

/**
 * Verifies the cryptographic signature and content-address of a verification record.
 * 
 * @param record - Verification record to verify
 * @returns true if signature and ID are valid, false otherwise
 */
export function verifyVerification(record: VerificationRecord): boolean {
  // Validate structure first
  const errors = validateVerification(record);
  if (errors.length > 0) {
    return false;
  }
  
  // Reconstruct canonical form without signature
  const { signature, id, ...recordWithoutSig } = record;
  const canonical = stableStringify(recordWithoutSig);
  
  // Verify content-addressed ID
  const computedId = createHash('sha256').update(canonical).digest('hex');
  if (computedId !== id) {
    return false;
  }
  
  // Verify signature
  return verifySignature(canonical, signature, record.verifier);
}
