/**
 * Verification record creation and validation.
 * Provides functions to create and validate verification records.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { VerificationRecord } from './types.js';

/**
 * Canonical JSON serialization for verification records.
 * Used for content-addressing and signing.
 */
function canonicalizeVerification(
  verifier: string,
  target: string,
  domain: string,
  verdict: 'correct' | 'incorrect' | 'disputed',
  confidence: number,
  timestamp: number,
  evidence?: string
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
  
  // Sort keys alphabetically for deterministic output
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${JSON.stringify(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute content-addressed ID for a verification record.
 */
export function computeVerificationId(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a verification record.
 * 
 * @param verifier - Public key of the verifying agent
 * @param privateKey - Private key for signing
 * @param target - ID of message/output being verified
 * @param domain - Capability domain
 * @param verdict - Verification verdict
 * @param confidence - Confidence level (0-1)
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
  // Validate confidence is in range [0, 1]
  if (confidence < 0 || confidence > 1) {
    throw new Error(`Confidence must be between 0 and 1, got ${confidence}`);
  }
  
  const timestamp = Date.now();
  const canonical = canonicalizeVerification(
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
    evidence
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
 * Validate a verification record.
 * Checks signature and content-addressed ID.
 * 
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function validateVerification(record: VerificationRecord): { valid: boolean; reason?: string } {
  const { id, verifier, target, domain, verdict, confidence, timestamp, signature, evidence } = record;
  
  // Validate required fields
  if (!verifier || !target || !domain || !verdict || confidence === undefined || !timestamp || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  
  // Validate confidence range
  if (confidence < 0 || confidence > 1) {
    return { valid: false, reason: 'confidence_out_of_range' };
  }
  
  // Validate verdict
  if (!['correct', 'incorrect', 'disputed'].includes(verdict)) {
    return { valid: false, reason: 'invalid_verdict' };
  }
  
  // Reconstruct canonical form
  const canonical = canonicalizeVerification(
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
    evidence
  );
  
  // Check content-addressed ID
  const expectedId = computeVerificationId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }
  
  // Check signature
  const sigValid = verifySignature(canonical, signature, verifier);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }
  
  return { valid: true };
}
