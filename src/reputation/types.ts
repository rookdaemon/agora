/**
 * Core reputation data structures for Agora's trust and verification layer.
 * Implements Phase 1 of RFC-001.
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
