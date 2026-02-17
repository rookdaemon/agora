/**
 * Core data structures for the Agora reputation layer.
 * Phase 1: Verification records, commit-reveal patterns, and trust scoring.
 */

/**
 * A cryptographically signed verification of another agent's output or claim.
 * Core primitive for building computational reputation.
 */
export interface VerificationRecord {
  /** Content-addressed ID (hash of canonical JSON) */
  id: string;
  
  /** Public key of verifying agent */
  verifier: string;
  
  /** ID of message/output being verified */
  target: string;
  
  /** Capability domain (e.g., 'ocr', 'summarization', 'code_review') */
  domain: string;
  
  /** Verification verdict */
  verdict: 'correct' | 'incorrect' | 'disputed';
  
  /** Verifier's confidence in their check (0-1) */
  confidence: number;
  
  /** Optional link to independent verification data */
  evidence?: string;
  
  /** Unix timestamp (ms) */
  timestamp: number;
  
  /** Ed25519 signature over canonical JSON */
  signature: string;
}

/**
 * A commitment to a prediction before outcome is known.
 * Prevents post-hoc editing of predictions.
 */
export interface CommitRecord {
  /** Content-addressed ID */
  id: string;
  
  /** Public key of committing agent */
  agent: string;
  
  /** Domain of prediction */
  domain: string;
  
  /** SHA-256 hash of prediction string */
  commitment: string;
  
  /** Unix timestamp (ms) */
  timestamp: number;
  
  /** Expiry time (ms) - commitment invalid after this */
  expiry: number;
  
  /** Ed25519 signature */
  signature: string;
}

/**
 * Reveals the prediction and outcome after commitment expiry.
 * Enables verification of prediction accuracy.
 */
export interface RevealRecord {
  /** Content-addressed ID */
  id: string;
  
  /** Public key of revealing agent */
  agent: string;
  
  /** ID of original commit message */
  commitmentId: string;
  
  /** Original prediction (plaintext) */
  prediction: string;
  
  /** Observed outcome */
  outcome: string;
  
  /** Evidence for outcome (optional) */
  evidence?: string;
  
  /** Unix timestamp (ms) */
  timestamp: number;
  
  /** Ed25519 signature */
  signature: string;
}

/**
 * Computed reputation score for an agent in a specific domain.
 * Derived from verification history, not stored directly.
 */
export interface TrustScore {
  /** Public key of agent being scored */
  agent: string;
  
  /** Domain of reputation */
  domain: string;
  
  /** Computed score (0-1, where 1 = highest trust) */
  score: number;
  
  /** Number of verifications considered */
  verificationCount: number;
  
  /** Timestamp of most recent verification (ms) */
  lastVerified: number;
  
  /** Public keys of top verifiers (by weight) */
  topVerifiers: string[];
}

/**
 * Request for reputation data about a specific agent.
 */
export interface ReputationQuery {
  /** Public key of agent being queried */
  agent: string;
  
  /** Optional: filter by capability domain */
  domain?: string;
  
  /** Optional: only include verifications after this timestamp */
  after?: number;
}

/**
 * Response containing reputation data for a queried agent.
 */
export interface ReputationResponse {
  /** Public key of agent being reported on */
  agent: string;
  
  /** Domain filter (if requested) */
  domain?: string;
  
  /** Verification records matching the query */
  verifications: VerificationRecord[];
  
  /** Computed trust scores by domain */
  scores: Record<string, TrustScore>;
}

/**
 * Revocation of a previously issued verification.
 * Used when a verifier discovers their verification was incorrect.
 */
export interface RevocationRecord {
  /** Content-addressed ID of this revocation */
  id: string;
  
  /** Public key of agent revoking (must match original verifier) */
  verifier: string;
  
  /** ID of verification being revoked */
  verificationId: string;
  
  /** Reason for revocation */
  reason: string;
  
  /** Unix timestamp (ms) */
  timestamp: number;
  
  /** Ed25519 signature */
  signature: string;
}

/**
 * Validation result structure
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate a verification record structure
 */
export function validateVerificationRecord(record: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return { valid: false, errors: ['Record must be an object'] };
  }
  
  const r = record as Record<string, unknown>;
  
  if (typeof r.id !== 'string' || r.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  
  if (typeof r.verifier !== 'string' || r.verifier.length === 0) {
    errors.push('verifier must be a non-empty string');
  }
  
  if (typeof r.target !== 'string' || r.target.length === 0) {
    errors.push('target must be a non-empty string');
  }
  
  if (typeof r.domain !== 'string' || r.domain.length === 0) {
    errors.push('domain must be a non-empty string');
  }
  
  if (!['correct', 'incorrect', 'disputed'].includes(r.verdict as string)) {
    errors.push('verdict must be one of: correct, incorrect, disputed');
  }
  
  if (typeof r.confidence !== 'number' || r.confidence < 0 || r.confidence > 1) {
    errors.push('confidence must be a number between 0 and 1');
  }
  
  if (r.evidence !== undefined && typeof r.evidence !== 'string') {
    errors.push('evidence must be a string if provided');
  }
  
  if (typeof r.timestamp !== 'number' || r.timestamp <= 0) {
    errors.push('timestamp must be a positive number');
  }
  
  if (typeof r.signature !== 'string' || r.signature.length === 0) {
    errors.push('signature must be a non-empty string');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a commit record structure
 */
export function validateCommitRecord(record: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return { valid: false, errors: ['Record must be an object'] };
  }
  
  const r = record as Record<string, unknown>;
  
  if (typeof r.id !== 'string' || r.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  
  if (typeof r.agent !== 'string' || r.agent.length === 0) {
    errors.push('agent must be a non-empty string');
  }
  
  if (typeof r.domain !== 'string' || r.domain.length === 0) {
    errors.push('domain must be a non-empty string');
  }
  
  if (typeof r.commitment !== 'string' || r.commitment.length !== 64) {
    errors.push('commitment must be a 64-character hex string (SHA-256 hash)');
  }
  
  if (typeof r.timestamp !== 'number' || r.timestamp <= 0) {
    errors.push('timestamp must be a positive number');
  }
  
  if (typeof r.expiry !== 'number' || r.expiry <= 0) {
    errors.push('expiry must be a positive number');
  }
  
  if (typeof r.expiry === 'number' && typeof r.timestamp === 'number' && r.expiry <= r.timestamp) {
    errors.push('expiry must be after timestamp');
  }
  
  if (typeof r.signature !== 'string' || r.signature.length === 0) {
    errors.push('signature must be a non-empty string');
  }
  
  return { valid: errors.length === 0, errors };
}

/**
 * Validate a reveal record structure
 */
export function validateRevealRecord(record: unknown): ValidationResult {
  const errors: string[] = [];
  
  if (typeof record !== 'object' || record === null) {
    return { valid: false, errors: ['Record must be an object'] };
  }
  
  const r = record as Record<string, unknown>;
  
  if (typeof r.id !== 'string' || r.id.length === 0) {
    errors.push('id must be a non-empty string');
  }
  
  if (typeof r.agent !== 'string' || r.agent.length === 0) {
    errors.push('agent must be a non-empty string');
  }
  
  if (typeof r.commitmentId !== 'string' || r.commitmentId.length === 0) {
    errors.push('commitmentId must be a non-empty string');
  }
  
  if (typeof r.prediction !== 'string' || r.prediction.length === 0) {
    errors.push('prediction must be a non-empty string');
  }
  
  if (typeof r.outcome !== 'string' || r.outcome.length === 0) {
    errors.push('outcome must be a non-empty string');
  }
  
  if (r.evidence !== undefined && typeof r.evidence !== 'string') {
    errors.push('evidence must be a string if provided');
  }
  
  if (typeof r.timestamp !== 'number' || r.timestamp <= 0) {
    errors.push('timestamp must be a positive number');
  }
  
  if (typeof r.signature !== 'string' || r.signature.length === 0) {
    errors.push('signature must be a non-empty string');
  }
  
  return { valid: errors.length === 0, errors };
}
