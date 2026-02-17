/**
 * Commit-reveal pattern implementation for verifiable predictions.
 * Prevents post-hoc editing of predictions and enables temporal proof.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { CommitRecord, RevealRecord } from './types.js';

/**
 * Compute SHA-256 hash of a prediction string.
 * Used to create commitments that hide the prediction until reveal.
 */
export function hashPrediction(prediction: string): string {
  return createHash('sha256').update(prediction).digest('hex');
}

/**
 * Canonical JSON serialization for commit records.
 */
function canonicalizeCommit(
  agent: string,
  domain: string,
  commitment: string,
  timestamp: number,
  expiry: number
): string {
  const obj = {
    agent,
    commitment,
    domain,
    expiry,
    timestamp,
  };
  
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${JSON.stringify(obj[k as keyof typeof obj])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Canonical JSON serialization for reveal records.
 */
function canonicalizeReveal(
  agent: string,
  commitmentId: string,
  prediction: string,
  outcome: string,
  timestamp: number,
  evidence?: string
): string {
  const obj: Record<string, unknown> = {
    agent,
    commitmentId,
    outcome,
    prediction,
    timestamp,
  };
  
  if (evidence !== undefined) {
    obj.evidence = evidence;
  }
  
  const keys = Object.keys(obj).sort();
  const pairs = keys.map(k => `"${k}":${JSON.stringify(obj[k])}`);
  return '{' + pairs.join(',') + '}';
}

/**
 * Compute content-addressed ID for a record.
 */
function computeRecordId(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a commit record.
 * 
 * @param agent - Public key of the committing agent
 * @param privateKey - Private key for signing
 * @param domain - Domain of the prediction
 * @param prediction - The prediction being committed to (will be hashed)
 * @param expiryMs - Time until expiry in milliseconds (default: 24 hours)
 * @returns Signed commit record
 */
export function createCommit(
  agent: string,
  privateKey: string,
  domain: string,
  prediction: string,
  expiryMs = 24 * 60 * 60 * 1000 // 24 hours default
): CommitRecord {
  const timestamp = Date.now();
  const expiry = timestamp + expiryMs;
  const commitment = hashPrediction(prediction);
  
  const canonical = canonicalizeCommit(agent, domain, commitment, timestamp, expiry);
  const id = computeRecordId(canonical);
  const signature = signMessage(canonical, privateKey);
  
  return {
    id,
    agent,
    domain,
    commitment,
    timestamp,
    expiry,
    signature,
  };
}

/**
 * Validate a commit record.
 * 
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function validateCommit(record: CommitRecord): { valid: boolean; reason?: string } {
  const { id, agent, domain, commitment, timestamp, expiry, signature } = record;
  
  // Validate required fields
  if (!id || !agent || !domain || !commitment || !timestamp || !expiry || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  
  // Validate expiry is after timestamp
  if (expiry <= timestamp) {
    return { valid: false, reason: 'expiry_before_timestamp' };
  }
  
  // Reconstruct canonical form
  const canonical = canonicalizeCommit(agent, domain, commitment, timestamp, expiry);
  
  // Check content-addressed ID
  const expectedId = computeRecordId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }
  
  // Check signature
  const sigValid = verifySignature(canonical, signature, agent);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }
  
  return { valid: true };
}

/**
 * Create a reveal record.
 * 
 * @param agent - Public key of the revealing agent
 * @param privateKey - Private key for signing
 * @param commitmentId - ID of the original commit record
 * @param prediction - The original prediction (plaintext)
 * @param outcome - The observed outcome
 * @param evidence - Optional evidence link
 * @returns Signed reveal record
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
  
  const canonical = canonicalizeReveal(
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
    evidence
  );
  
  const id = computeRecordId(canonical);
  const signature = signMessage(canonical, privateKey);
  
  return {
    id,
    agent,
    commitmentId,
    prediction,
    outcome,
    ...(evidence !== undefined ? { evidence } : {}),
    timestamp,
    signature,
  };
}

/**
 * Validate a reveal record.
 * 
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function validateReveal(record: RevealRecord): { valid: boolean; reason?: string } {
  const { id, agent, commitmentId, prediction, outcome, timestamp, signature, evidence } = record;
  
  // Validate required fields
  if (!id || !agent || !commitmentId || !prediction || !outcome || !timestamp || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  
  // Reconstruct canonical form
  const canonical = canonicalizeReveal(
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
    evidence
  );
  
  // Check content-addressed ID
  const expectedId = computeRecordId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }
  
  // Check signature
  const sigValid = verifySignature(canonical, signature, agent);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }
  
  return { valid: true };
}

/**
 * Validate a reveal record.
 * 
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function validateReveal(record: RevealRecord): { valid: boolean; reason?: string } {
  const { id, agent, commitmentId, prediction, outcome, timestamp, signature, evidence } = record;
  
  // Validate required fields
  if (!id || !agent || !commitmentId || !prediction || !outcome || !timestamp || !signature) {
    return { valid: false, reason: 'missing_required_fields' };
  }
  
  // Reconstruct canonical form
  const canonical = canonicalizeReveal(
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
    evidence
  );
  
  // Check content-addressed ID
  const expectedId = computeRecordId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }
  
  // Check signature
  const sigValid = verifySignature(canonical, signature, agent);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }
  
  return { valid: true };
}

/**
 * Verify that a reveal matches a commit.
 * Checks that the hash of the revealed prediction matches the commitment.
 * 
 * @param commit - The original commit record
 * @param reveal - The reveal record to verify
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function verifyReveal(
  commit: CommitRecord,
  reveal: RevealRecord
): { valid: boolean; reason?: string } {
  // Check that reveal references this commit
  if (reveal.commitmentId !== commit.id) {
    return { valid: false, reason: 'commitment_id_mismatch' };
  }
  
  // Check that agent matches
  if (reveal.agent !== commit.agent) {
    return { valid: false, reason: 'agent_mismatch' };
  }
  
  // Check that reveal is after commit expiry
  if (reveal.timestamp < commit.expiry) {
    return { valid: false, reason: 'reveal_before_expiry' };
  }
  
  // Check that prediction hash matches commitment
  const predictionHash = hashPrediction(reveal.prediction);
  if (predictionHash !== commit.commitment) {
    return { valid: false, reason: 'prediction_hash_mismatch' };
  }
  
  return { valid: true };
}
