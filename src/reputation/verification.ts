/**
 * Verification record creation and validation.
 * Core primitive for computational reputation.
 */

import { createEnvelope, verifyEnvelope } from '../message/envelope.js';
import type { VerificationRecord } from './types.js';
import { validateVerificationRecord } from './types.js';

/**
 * Create a signed verification record
 * @param verifier - Public key of the verifying agent
 * @param privateKey - Private key for signing
 * @param target - ID of the message/output being verified
 * @param domain - Capability domain
 * @param verdict - Verification verdict
 * @param confidence - Verifier's confidence (0-1)
 * @param timestamp - Timestamp for the verification (ms)
 * @param evidence - Optional link to verification evidence
 * @returns Signed VerificationRecord
 */
export function createVerification(
  verifier: string,
  privateKey: string,
  target: string,
  domain: string,
  verdict: 'correct' | 'incorrect' | 'disputed',
  confidence: number,
  timestamp: number,
  evidence?: string
): VerificationRecord {
  // Validate confidence range
  if (confidence < 0 || confidence > 1) {
    throw new Error('confidence must be between 0 and 1');
  }
  
  // Create the payload for signing
  const payload: Record<string, unknown> = {
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
  };
  
  if (evidence !== undefined) {
    payload.evidence = evidence;
  }
  
  // Create signed envelope with type 'verification'
  const envelope = createEnvelope('verification', verifier, privateKey, payload, timestamp);
  
  // Return verification record
  const record: VerificationRecord = {
    id: envelope.id,
    verifier,
    target,
    domain,
    verdict,
    confidence,
    timestamp,
    signature: envelope.signature,
  };
  
  if (evidence !== undefined) {
    record.evidence = evidence;
  }
  
  return record;
}

/**
 * Verify the cryptographic signature of a verification record
 * @param record - The verification record to verify
 * @returns Object with valid flag and optional reason for failure
 */
export function verifyVerificationSignature(
  record: VerificationRecord
): { valid: boolean; reason?: string } {
  // First validate the structure
  const structureValidation = validateVerificationRecord(record);
  if (!structureValidation.valid) {
    return { 
      valid: false, 
      reason: `Invalid structure: ${structureValidation.errors.join(', ')}` 
    };
  }
  
  // Reconstruct the envelope for signature verification
  const payload: Record<string, unknown> = {
    verifier: record.verifier,
    target: record.target,
    domain: record.domain,
    verdict: record.verdict,
    confidence: record.confidence,
    timestamp: record.timestamp,
  };
  
  if (record.evidence !== undefined) {
    payload.evidence = record.evidence;
  }
  
  const envelope = {
    id: record.id,
    type: 'verification' as const,
    sender: record.verifier,
    timestamp: record.timestamp,
    payload,
    signature: record.signature,
  };
  
  // Verify the envelope signature
  return verifyEnvelope(envelope);
}
