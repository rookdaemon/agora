/**
 * Core data structures for the reputation and trust layer.
 * 
 * Provides types for verification records, commit-reveal patterns,
 * and trust score computation.
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
 * Revokes a prior verification record.
 * Used when a verifier discovers their verification was incorrect.
 */
export interface RevocationRecord {
  /** Content-addressed ID */
  id: string;
  
  /** Public key of agent revoking their verification */
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
 * Query for reputation data about a specific agent.
 */
export interface ReputationQuery {
  /** Public key of agent being queried */
  agent: string;
  
  /** Optional domain filter */
  domain?: string;
  
  /** Maximum age of verifications to return (ms) */
  maxAge?: number;
}

/**
 * Response containing reputation data for an agent.
 */
export interface ReputationResponse {
  /** Public key of agent */
  agent: string;
  
  /** Domain (if filtered) */
  domain?: string;
  
  /** Verification records */
  verifications: VerificationRecord[];
  
  /** Computed trust score (if available) */
  trustScore?: TrustScore;
}
