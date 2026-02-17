/**
 * Commit-reveal pattern implementation for tamper-proof predictions.
 * Agents commit to predictions before outcomes are known, then reveal.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { CommitRecord, RevealRecord, ValidationResult } from './types.js';

/**
 * Canonical form of a commit for signing/hashing.
 */
function canonicalizeCommit(
  agent: string,
  domain: string,
  commitment: string,
  timestamp: number,
  expiry: number,
): string {
  const obj = {
    agent,
    commitment,
    domain,
    expiry,
    timestamp,
  };
  
  return JSON.stringify(obj);
}

/**
 * Canonical form of a reveal for signing/hashing.
 */
function canonicalizeReveal(
  agent: string,
  commitmentId: string,
  prediction: string,
  outcome: string,
  timestamp: number,
  evidence?: string,
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
  
  // Sort keys
  const sorted = Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = obj[key];
    return acc;
  }, {} as Record<string, unknown>);
  
  return JSON.stringify(sorted);
}

/**
 * Compute content-addressed ID.
 */
function computeId(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a SHA-256 hash commitment of a prediction.
 * 
 * @param prediction - The prediction string to commit to
 * @returns SHA-256 hash (hex string)
 */
export function hashPrediction(prediction: string): string {
  return createHash('sha256').update(prediction).digest('hex');
}

/**
 * Create a signed commit record.
 * 
 * @param agent - Public key of committing agent
 * @param privateKey - Private key for signing
 * @param domain - Domain of prediction
 * @param prediction - The prediction to commit to
 * @param expiryMs - Time until expiry (milliseconds from now)
 * @returns Signed CommitRecord
 */
export function createCommit(
  agent: string,
  privateKey: string,
  domain: string,
  prediction: string,
  expiryMs: number,
): CommitRecord {
  const timestamp = Date.now();
  const expiry = timestamp + expiryMs;
  const commitment = hashPrediction(prediction);
  
  const canonical = canonicalizeCommit(agent, domain, commitment, timestamp, expiry);
  const id = computeId(canonical);
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
 * Create a signed reveal record.
 * 
 * @param agent - Public key of revealing agent
 * @param privateKey - Private key for signing
 * @param commitmentId - ID of original commit message
 * @param prediction - Original prediction (plaintext)
 * @param outcome - Observed outcome
 * @param evidence - Optional evidence link
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
  
  const canonical = canonicalizeReveal(
    agent,
    commitmentId,
    prediction,
    outcome,
    timestamp,
    evidence,
  );
  
  const id = computeId(canonical);
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
 * Validate a commit record's structure and signature.
 */
export function validateCommit(record: CommitRecord): ValidationResult {
  const errors: string[] = [];
  
  // Check required fields
  if (!record.id) errors.push('Missing field: id');
  if (!record.agent) errors.push('Missing field: agent');
  if (!record.domain) errors.push('Missing field: domain');
  if (!record.commitment) errors.push('Missing field: commitment');
  if (!record.timestamp) errors.push('Missing field: timestamp');
  if (!record.expiry) errors.push('Missing field: expiry');
  if (!record.signature) errors.push('Missing field: signature');
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Validate expiry is after timestamp
  if (record.expiry <= record.timestamp) {
    errors.push('Invalid expiry: must be after timestamp');
  }
  
  // Verify signature
  const canonical = canonicalizeCommit(
    record.agent,
    record.domain,
    record.commitment,
    record.timestamp,
    record.expiry,
  );
  
  const expectedId = computeId(canonical);
  if (record.id !== expectedId) {
    errors.push('ID mismatch: computed ID does not match record ID');
  }
  
  const signatureValid = verifySignature(canonical, record.signature, record.agent);
  if (!signatureValid) {
    errors.push('Invalid signature');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}

/**
 * Validate a reveal record's structure and signature.
 */
export function validateReveal(reveal: RevealRecord): ValidationResult {
  const errors: string[] = [];
  
  // Check required fields
  if (!reveal.id) errors.push('Missing field: id');
  if (!reveal.agent) errors.push('Missing field: agent');
  if (!reveal.commitmentId) errors.push('Missing field: commitmentId');
  if (!reveal.prediction) errors.push('Missing field: prediction');
  if (!reveal.outcome) errors.push('Missing field: outcome');
  if (!reveal.timestamp) errors.push('Missing field: timestamp');
  if (!reveal.signature) errors.push('Missing field: signature');
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  // Verify signature
  const canonical = canonicalizeReveal(
    reveal.agent,
    reveal.commitmentId,
    reveal.prediction,
    reveal.outcome,
    reveal.timestamp,
    reveal.evidence,
  );
  
  const expectedId = computeId(canonical);
  if (reveal.id !== expectedId) {
    errors.push('ID mismatch: computed ID does not match record ID');
  }
  
  const signatureValid = verifySignature(canonical, reveal.signature, reveal.agent);
  if (!signatureValid) {
    errors.push('Invalid signature');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}

/**
 * Verify that a reveal matches its commit.
 * 
 * @param commit - Original commit record
 * @param reveal - Reveal record to verify
 * @returns Validation result
 */
export function verifyRevealMatchesCommit(
  commit: CommitRecord,
  reveal: RevealRecord,
): ValidationResult {
  const errors: string[] = [];
  
  // Check agent matches
  if (commit.agent !== reveal.agent) {
    errors.push('Agent mismatch: reveal agent does not match commit agent');
  }
  
  // Check commitment ID matches
  if (commit.id !== reveal.commitmentId) {
    errors.push('Commitment ID mismatch');
  }
  
  // Check prediction hash matches commitment
  const predictionHash = hashPrediction(reveal.prediction);
  if (commit.commitment !== predictionHash) {
    errors.push('Prediction hash does not match commitment');
  }
  
  // Check reveal is after expiry
  if (reveal.timestamp < commit.expiry) {
    errors.push('Reveal timestamp is before commitment expiry');
  }
  
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  
  return { valid: true };
}
