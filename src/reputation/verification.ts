/**
 * Verification record creation and validation.
 * Core primitives for computational reputation.
 */

import { createEnvelope } from '../message/envelope.js';
import type { VerificationRecord, RevocationRecord } from './types.js';

/**
 * Validation result for verification records.
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Create a verification record for another agent's output.
 * @param verifier - Public key of the verifying agent
 * @param privateKey - Private key for signing
 * @param target - ID of message/output being verified
 * @param domain - Capability domain
 * @param verdict - Verification verdict
 * @param confidence - Confidence level (0-1)
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

  const payload: Record<string, unknown> = {
    verifier,
    target,
    domain,
    verdict,
    confidence,
  };

  if (evidence !== undefined) {
    payload.evidence = evidence;
  }

  const envelope = createEnvelope('verification', verifier, privateKey, payload);

  return {
    id: envelope.id,
    verifier,
    target,
    domain,
    verdict,
    confidence,
    ...(evidence !== undefined ? { evidence } : {}),
    timestamp,
    signature: envelope.signature,
  };
}

/**
 * Create a revocation record to retract a prior verification.
 * @param verifier - Public key of the agent who made the original verification
 * @param privateKey - Private key for signing
 * @param verificationId - ID of the verification to revoke
 * @param reason - Reason for revocation
 * @param evidence - Optional supporting evidence
 * @returns Signed RevocationRecord
 */
export function createRevocation(
  verifier: string,
  privateKey: string,
  verificationId: string,
  reason: 'discovered_error' | 'fraud_detected' | 'methodology_flawed' | 'other',
  evidence?: string,
): RevocationRecord {
  const timestamp = Date.now();

  const payload: Record<string, unknown> = {
    verifier,
    verificationId,
    reason,
  };

  if (evidence !== undefined) {
    payload.evidence = evidence;
  }

  const envelope = createEnvelope('revocation', verifier, privateKey, payload);

  return {
    id: envelope.id,
    verifier,
    verificationId,
    reason,
    ...(evidence !== undefined ? { evidence } : {}),
    timestamp,
    signature: envelope.signature,
  };
}

/**
 * Validate a verification record structure.
 * @param record - The verification record to validate
 * @returns Validation result with errors if any
 */
export function validateVerification(record: unknown): ValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be an object'] };
  }

  const v = record as Partial<VerificationRecord>;

  if (!v.id || typeof v.id !== 'string') {
    errors.push('Missing or invalid id');
  }

  if (!v.verifier || typeof v.verifier !== 'string') {
    errors.push('Missing or invalid verifier');
  }

  if (!v.target || typeof v.target !== 'string') {
    errors.push('Missing or invalid target');
  }

  if (!v.domain || typeof v.domain !== 'string') {
    errors.push('Missing or invalid domain');
  }

  if (!v.verdict || !['correct', 'incorrect', 'disputed'].includes(v.verdict)) {
    errors.push('Missing or invalid verdict (must be correct, incorrect, or disputed)');
  }

  if (typeof v.confidence !== 'number' || v.confidence < 0 || v.confidence > 1) {
    errors.push('Missing or invalid confidence (must be number between 0 and 1)');
  }

  if (v.evidence !== undefined && typeof v.evidence !== 'string') {
    errors.push('Invalid evidence (must be string if provided)');
  }

  if (typeof v.timestamp !== 'number' || v.timestamp <= 0) {
    errors.push('Missing or invalid timestamp');
  }

  if (!v.signature || typeof v.signature !== 'string') {
    errors.push('Missing or invalid signature');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validate a revocation record structure.
 * @param record - The revocation record to validate
 * @returns Validation result with errors if any
 */
export function validateRevocation(record: unknown): ValidationResult {
  const errors: string[] = [];

  if (!record || typeof record !== 'object') {
    return { valid: false, errors: ['Record must be an object'] };
  }

  const r = record as Partial<RevocationRecord>;

  if (!r.id || typeof r.id !== 'string') {
    errors.push('Missing or invalid id');
  }

  if (!r.verifier || typeof r.verifier !== 'string') {
    errors.push('Missing or invalid verifier');
  }

  if (!r.verificationId || typeof r.verificationId !== 'string') {
    errors.push('Missing or invalid verificationId');
  }

  const validReasons = ['discovered_error', 'fraud_detected', 'methodology_flawed', 'other'];
  if (!r.reason || !validReasons.includes(r.reason)) {
    errors.push(`Missing or invalid reason (must be one of: ${validReasons.join(', ')})`);
  }

  if (r.evidence !== undefined && typeof r.evidence !== 'string') {
    errors.push('Invalid evidence (must be string if provided)');
  }

  if (typeof r.timestamp !== 'number' || r.timestamp <= 0) {
    errors.push('Missing or invalid timestamp');
  }

  if (!r.signature || typeof r.signature !== 'string') {
    errors.push('Missing or invalid signature');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
