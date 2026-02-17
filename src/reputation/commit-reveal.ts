/**
 * Commit-reveal pattern implementation.
 * 
 * Enables agents to commit to predictions before outcomes are known,
 * preventing post-hoc editing and creating verifiable temporal ordering.
 */

import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';
import type { CommitRecord, RevealRecord } from './types.js';

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
 * Creates a commitment to a prediction.
 * 
 * @param agent - Public key of committing agent
 * @param privateKey - Private key for signing
 * @param domain - Domain of prediction
 * @param prediction - The prediction text (will be hashed)
 * @param expiryMs - How long until commitment expires (milliseconds from now)
 * @returns Signed commit record
 */
export function createCommit(
  agent: string,
  privateKey: string,
  domain: string,
  prediction: string,
  expiryMs: number
): CommitRecord {
  const timestamp = Date.now();
  const expiry = timestamp + expiryMs;
  
  // Hash the prediction
  const commitment = createHash('sha256').update(prediction).digest('hex');
  
  // Build record without signature
  const recordWithoutSig: Omit<CommitRecord, 'id' | 'signature'> = {
    agent,
    domain,
    commitment,
    timestamp,
    expiry,
  };
  
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
 * Creates a reveal record that discloses the prediction and outcome.
 * 
 * @param agent - Public key of revealing agent
 * @param privateKey - Private key for signing
 * @param commitmentId - ID of original commit record
 * @param prediction - Original prediction (plaintext)
 * @param outcome - Observed outcome
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
  
  // Build record without signature
  const recordWithoutSig: Omit<RevealRecord, 'id' | 'signature'> = {
    agent,
    commitmentId,
    prediction,
    outcome,
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
 * Validates a commit record.
 * 
 * @param record - Commit record to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateCommit(record: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return ['Commit record must be an object'];
  }
  
  const r = record as Partial<CommitRecord>;
  
  if (typeof r.id !== 'string') {
    errors.push('Missing or invalid field: id');
  }
  if (typeof r.agent !== 'string') {
    errors.push('Missing or invalid field: agent');
  }
  if (typeof r.domain !== 'string') {
    errors.push('Missing or invalid field: domain');
  }
  if (typeof r.commitment !== 'string') {
    errors.push('Missing or invalid field: commitment');
  }
  if (typeof r.timestamp !== 'number') {
    errors.push('Missing or invalid field: timestamp');
  }
  if (typeof r.expiry !== 'number') {
    errors.push('Missing or invalid field: expiry');
  }
  if (typeof r.signature !== 'string') {
    errors.push('Missing or invalid field: signature');
  }
  
  // Validate expiry is after timestamp
  if (typeof r.timestamp === 'number' && typeof r.expiry === 'number' && r.expiry <= r.timestamp) {
    errors.push('Expiry must be after timestamp');
  }
  
  return errors;
}

/**
 * Validates a reveal record.
 * 
 * @param record - Reveal record to validate
 * @returns Array of validation errors (empty if valid)
 */
export function validateReveal(record: unknown): string[] {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return ['Reveal record must be an object'];
  }
  
  const r = record as Partial<RevealRecord>;
  
  if (typeof r.id !== 'string') {
    errors.push('Missing or invalid field: id');
  }
  if (typeof r.agent !== 'string') {
    errors.push('Missing or invalid field: agent');
  }
  if (typeof r.commitmentId !== 'string') {
    errors.push('Missing or invalid field: commitmentId');
  }
  if (typeof r.prediction !== 'string') {
    errors.push('Missing or invalid field: prediction');
  }
  if (typeof r.outcome !== 'string') {
    errors.push('Missing or invalid field: outcome');
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
 * Verifies the cryptographic signature and content-address of a commit record.
 * 
 * @param record - Commit record to verify
 * @returns true if signature and ID are valid, false otherwise
 */
export function verifyCommit(record: CommitRecord): boolean {
  const errors = validateCommit(record);
  if (errors.length > 0) {
    return false;
  }
  
  const { signature, id, ...recordWithoutSig } = record;
  const canonical = stableStringify(recordWithoutSig);
  
  // Verify content-addressed ID
  const computedId = createHash('sha256').update(canonical).digest('hex');
  if (computedId !== id) {
    return false;
  }
  
  // Verify signature
  return verifySignature(canonical, signature, record.agent);
}

/**
 * Verifies the cryptographic signature and content-address of a reveal record.
 * 
 * @param record - Reveal record to verify
 * @returns true if signature and ID are valid, false otherwise
 */
export function verifyReveal(record: RevealRecord): boolean {
  const errors = validateReveal(record);
  if (errors.length > 0) {
    return false;
  }
  
  const { signature, id, ...recordWithoutSig } = record;
  const canonical = stableStringify(recordWithoutSig);
  
  // Verify content-addressed ID
  const computedId = createHash('sha256').update(canonical).digest('hex');
  if (computedId !== id) {
    return false;
  }
  
  // Verify signature
  return verifySignature(canonical, signature, record.agent);
}

/**
 * Validates that a reveal matches its commit.
 * 
 * @param commit - Original commit record
 * @param reveal - Reveal record to validate
 * @returns true if reveal matches commit, false otherwise
 */
export function validateRevealMatchesCommit(
  commit: CommitRecord,
  reveal: RevealRecord
): boolean {
  // Check that commitmentId matches
  if (reveal.commitmentId !== commit.id) {
    return false;
  }
  
  // Check that agents match
  if (reveal.agent !== commit.agent) {
    return false;
  }
  
  // Check that prediction hash matches commitment
  const predictionHash = createHash('sha256').update(reveal.prediction).digest('hex');
  if (predictionHash !== commit.commitment) {
    return false;
  }
  
  // Check that reveal happened after commit expiry
  if (reveal.timestamp <= commit.expiry) {
    return false;
  }
  
  return true;
}

/**
 * Checks if a commit has expired.
 * 
 * @param commit - Commit record to check
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns true if commit has expired, false otherwise
 */
export function isCommitExpired(commit: CommitRecord, currentTime?: number): boolean {
  const now = currentTime ?? Date.now();
  return now > commit.expiry;
}
