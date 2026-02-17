/**
 * Core data structures for the Agora reputation layer.
 * Implements RFC-001 Phase 1: verification primitives and basic reputation scoring.
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
 * Revocation of a prior verification.
 * Allows verifiers to retract incorrect verifications.
 */
export interface RevocationRecord {
  /** Content-addressed ID */
  id: string;
  
  /** Public key of agent revoking the verification */
  verifier: string;
  
  /** ID of verification being revoked */
  verificationId: string;
  
  /** Reason for revocation */
  reason: 'discovered_error' | 'fraud_detected' | 'methodology_flawed' | 'other';
  
  /** Optional evidence supporting revocation */
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
 * Payload for 'reputation_query' messages.
 * Request reputation data for a specific agent and domain.
 */
export interface ReputationQueryPayload {
  /** Public key of agent to query */
  agent: string;
  
  /** Domain to query (e.g., 'ocr', 'summarization') */
  domain: string;
  
  /** Optional: minimum timestamp for verifications */
  since?: number;
}

/**
 * Payload for 'reputation_response' messages.
 * Response containing computed reputation data.
 */
export interface ReputationResponsePayload {
  /** Public key of agent */
  agent: string;
  
  /** Domain of reputation */
  domain: string;
  
  /** Computed trust score (0-1) */
  score: number;
  
  /** Number of verifications */
  verificationCount: number;
  
  /** Most recent verification timestamp */
  lastVerified: number;
  
  /** Top verifiers */
  topVerifiers: string[];
}
