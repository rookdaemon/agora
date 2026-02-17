/**
 * Commit-reveal pattern implementation for tamper-proof predictions.
 * Agents commit to predictions before outcomes are known, then reveal after.
 */

import { createHash } from 'node:crypto';
import { createEnvelope } from '../message/envelope.js';
import type { CommitRecord, RevealRecord } from './types.js';
import { validateCommitRecord, validateRevealRecord } from './types.js';

/**
 * Create a commitment hash for a prediction
 * @param prediction - The prediction string
 * @returns SHA-256 hash of the prediction (hex string)
 */
export function hashPrediction(prediction: string): string {
  return createHash('sha256').update(prediction).digest('hex');
}

/**
 * Create a signed commit record
 * @param agent - Public key of the committing agent
 * @param privateKey - Private key for signing
 * @param domain - Domain of the prediction
 * @param prediction - The prediction to commit to
 * @param expiryMs - Expiry time in milliseconds from now
 * @returns Signed CommitRecord
 */
export function createCommit(
  agent: string,
  privateKey: string,
  domain: string,
  prediction: string,
  expiryMs: number
): CommitRecord {
  const timestamp = Date.now();
  const commitment = hashPrediction(prediction);
  const expiry = timestamp + expiryMs;
  
  // Create the payload for signing
  const payload = {
    agent,
    domain,
    commitment,
    timestamp,
    expiry,
  };
  
  // Create signed envelope with type 'commit'
  const envelope = createEnvelope('commit', agent, privateKey, payload);
  
  // Return commit record
  return {
    id: envelope.id,
    agent,
    domain,
    commitment,
    timestamp,
    expiry,
    signature: envelope.signature,
  };
}

/**
 * Create a signed reveal record
 * @param agent - Public key of the revealing agent
 * @param privateKey - Private key for signing
 * @param commitmentId - ID of the original commit record
 * @param prediction - The original prediction (plaintext)
 * @param outcome - The observed outcome
 * @param evidence - Optional evidence for the outcome
 * @returns Signed RevealRecord
 */
export function createReveal(
  agent: string,
  privateKey: string,
  commitmentId: string,
  prediction: string,
  outcome: string,
  evidence?: string
): RevealRecord {
  const timestamp = Date.now();
  
  // Create the payload for signing
  const payload: Record<string, unknown> = {
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
  };
  
  if (evidence !== undefined) {
    payload.evidence = evidence;
  }
  
  // Create signed envelope with type 'reveal'
  const envelope = createEnvelope('reveal', agent, privateKey, payload);
  
  // Return reveal record
  const record: RevealRecord = {
    id: envelope.id,
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
    signature: envelope.signature,
  };
  
  if (evidence !== undefined) {
    record.evidence = evidence;
  }
  
  return record;
}

/**
 * Verify a reveal against its commitment
 * @param commit - The original commit record
 * @param reveal - The reveal record
 * @returns Object with valid flag and optional reason for failure
 */
export function verifyReveal(
  commit: CommitRecord,
  reveal: RevealRecord
): { valid: boolean; reason?: string } {
  // Validate structures
  const commitValidation = validateCommitRecord(commit);
  if (!commitValidation.valid) {
    return { valid: false, reason: `Invalid commit: ${commitValidation.errors.join(', ')}` };
  }
  
  const revealValidation = validateRevealRecord(reveal);
  if (!revealValidation.valid) {
    return { valid: false, reason: `Invalid reveal: ${revealValidation.errors.join(', ')}` };
  }
  
  // Check that reveal references the correct commit
  if (reveal.commitmentId !== commit.id) {
    return { valid: false, reason: 'Reveal does not reference this commit' };
  }
  
  // Check that agents match
  if (reveal.agent !== commit.agent) {
    return { valid: false, reason: 'Reveal agent does not match commit agent' };
  }
  
  // Check that reveal is after commit expiry
  if (reveal.timestamp < commit.expiry) {
    return { valid: false, reason: 'Reveal timestamp is before commit expiry' };
  }
  
  // Verify that the prediction hash matches the commitment
  const predictedHash = hashPrediction(reveal.prediction);
  if (predictedHash !== commit.commitment) {
    return { valid: false, reason: 'Prediction hash does not match commitment' };
  }
  
  return { valid: true };
}
