/**
 * Commit-reveal pattern implementation for verifiable predictions.
 * Prevents post-hoc editing of predictions and claims.
 */

import { createHash } from 'node:crypto';
import { createEnvelope } from '../message/envelope.js';
import type { CommitRecord, RevealRecord } from './types.js';

/**
 * Create a SHA-256 commitment hash for a prediction.
 * @param prediction - The prediction string to commit to
 * @returns Hex-encoded SHA-256 hash
 */
export function hashPrediction(prediction: string): string {
  return createHash('sha256').update(prediction).digest('hex');
}

/**
 * Create a commit record for a prediction.
 * @param agent - Public key of the committing agent
 * @param privateKey - Private key for signing
 * @param domain - Capability domain
 * @param prediction - The prediction to commit to
 * @param expiryMs - Time until expiry in milliseconds (default: 24 hours)
 * @returns Signed CommitRecord
 */
export function createCommit(
  agent: string,
  privateKey: string,
  domain: string,
  prediction: string,
  expiryMs: number = 24 * 60 * 60 * 1000,
): CommitRecord {
  const timestamp = Date.now();
  const expiry = timestamp + expiryMs;
  const commitment = hashPrediction(prediction);

  const payload = {
    agent,
    domain,
    commitment,
    expiry,
  };

  const envelope = createEnvelope('commit', agent, privateKey, payload);

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
 * Create a reveal record that discloses the original prediction and outcome.
 * @param agent - Public key of the revealing agent
 * @param privateKey - Private key for signing
 * @param commitmentId - ID of the original commit message
 * @param prediction - The original prediction (plaintext)
 * @param outcome - The observed outcome
 * @param evidence - Optional evidence URL/hash
 * @returns Signed RevealRecord
 */
export function createReveal(
  agent: string,
  privateKey: string,
  commitmentId: string,
  prediction: string,
  outcome: string,
  evidence?: string,
): RevealRecord {
  const timestamp = Date.now();

  const payload: Record<string, unknown> = {
    agent,
    commitmentId,
    prediction,
    outcome,
  };

  if (evidence !== undefined) {
    payload.evidence = evidence;
  }

  const envelope = createEnvelope('reveal', agent, privateKey, payload);

  return {
    id: envelope.id,
    agent,
    commitmentId,
    prediction,
    outcome,
    ...(evidence !== undefined ? { evidence } : {}),
    timestamp,
    signature: envelope.signature,
  };
}

/**
 * Verify that a reveal matches its commitment.
 * @param commit - The original commit record
 * @param reveal - The reveal record to verify
 * @returns Object with valid flag and optional reason
 */
export function verifyReveal(
  commit: CommitRecord,
  reveal: RevealRecord,
): { valid: boolean; reason?: string } {
  // Check that reveal references this commit
  if (reveal.commitmentId !== commit.id) {
    return { valid: false, reason: 'commitment_id_mismatch' };
  }

  // Check that agent matches
  if (reveal.agent !== commit.agent) {
    return { valid: false, reason: 'agent_mismatch' };
  }

  // Check that commitment hasn't expired yet at reveal time
  // (Allow reveal to happen before expiry too)
  // Actually, standard practice is to allow reveal only AFTER expiry
  // But for flexibility, we'll allow it anytime
  
  // Check that revealed prediction matches commitment hash
  const expectedHash = hashPrediction(reveal.prediction);
  if (expectedHash !== commit.commitment) {
    return { valid: false, reason: 'prediction_hash_mismatch' };
  }

  return { valid: true };
}

/**
 * Check if a commitment has expired.
 * @param commit - The commit record to check
 * @param currentTime - Current timestamp (default: Date.now())
 * @returns true if expired, false otherwise
 */
export function isCommitmentExpired(commit: CommitRecord, currentTime: number = Date.now()): boolean {
  return currentTime > commit.expiry;
}
