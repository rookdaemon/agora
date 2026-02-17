/**
 * Trust score computation with time-based decay.
 * Implements domain-specific reputation scoring.
 */

import type { VerificationRecord, RevocationRecord, TrustScore } from './types.js';

/**
 * Exponential decay function for time-based reputation degradation.
 * 
 * @param deltaTimeMs - Time since verification (milliseconds)
 * @param lambda - Decay rate per day (default 0.01/day gives ~70-day half-life)
 * @returns Weight multiplier (0-1)
 * 
 * Examples:
 * - 7 days old: ~93% weight
 * - 70 days old: ~50% weight
 * - 1 year old: ~2.5% weight
 */
export function decay(deltaTimeMs: number, lambda = 0.01): number {
  const deltaDays = deltaTimeMs / (1000 * 60 * 60 * 24);
  return Math.exp(-lambda * deltaDays);
}

/**
 * Convert verdict to numerical score.
 * 
 * @param verdict - Verification verdict
 * @returns +1 for correct, -1 for incorrect, 0 for disputed
 */
function verdictToScore(verdict: 'correct' | 'incorrect' | 'disputed'): number {
  switch (verdict) {
    case 'correct':
      return 1;
    case 'incorrect':
      return -1;
    case 'disputed':
      return 0;
  }
}

/**
 * Compute trust score for an agent in a specific domain.
 * 
 * Formula:
 * TrustScore = Σ (verdict × confidence × decay(Δt)) / max(verificationCount, 1)
 * 
 * @param agent - Public key of agent to score
 * @param domain - Capability domain
 * @param verifications - List of verifications for this agent in this domain
 * @param revocations - List of revocations (optional)
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns TrustScore or null if no verifications
 */
export function computeTrustScore(
  agent: string,
  domain: string,
  verifications: VerificationRecord[],
  revocations: RevocationRecord[] = [],
  currentTime: number = Date.now(),
): TrustScore | null {
  // Filter to verifications for this domain
  const domainVerifications = verifications.filter(v => v.domain === domain);
  
  if (domainVerifications.length === 0) {
    return null;
  }
  
  // Build set of revoked verification IDs
  const revokedIds = new Set(revocations.map(r => r.verificationId));
  
  // Filter out revoked verifications
  const activeVerifications = domainVerifications.filter(v => !revokedIds.has(v.id));
  
  if (activeVerifications.length === 0) {
    return null;
  }
  
  // Compute weighted sum
  let weightedSum = 0;
  let lastVerified = 0;
  const verifierCounts = new Map<string, number>();
  
  for (const verification of activeVerifications) {
    const deltaTime = currentTime - verification.timestamp;
    const decayWeight = decay(deltaTime);
    const verdictScore = verdictToScore(verification.verdict);
    const weight = verdictScore * verification.confidence * decayWeight;
    
    weightedSum += weight;
    lastVerified = Math.max(lastVerified, verification.timestamp);
    
    // Track verifier for topVerifiers
    const count = verifierCounts.get(verification.verifier) || 0;
    verifierCounts.set(verification.verifier, count + 1);
  }
  
  // Compute final score (normalize by count, then scale to 0-1)
  const rawScore = weightedSum / activeVerifications.length;
  // Transform from [-1, 1] to [0, 1]
  const score = (rawScore + 1) / 2;
  
  // Get top verifiers (by count)
  const topVerifiers = Array.from(verifierCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verifier]) => verifier);
  
  return {
    agent,
    domain,
    score: Math.max(0, Math.min(1, score)), // Clamp to [0, 1]
    verificationCount: activeVerifications.length,
    lastVerified,
    topVerifiers,
  };
}

/**
 * Compute trust scores for an agent across all domains.
 * 
 * @param agent - Public key of agent to score
 * @param verifications - All verifications for this agent
 * @param revocations - All revocations (optional)
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Map of domain to TrustScore
 */
export function computeAllScores(
  agent: string,
  verifications: VerificationRecord[],
  revocations: RevocationRecord[] = [],
  currentTime: number = Date.now(),
): Map<string, TrustScore> {
  const scores = new Map<string, TrustScore>();
  
  // Get unique domains
  const domains = new Set(verifications.map(v => v.domain));
  
  for (const domain of domains) {
    const score = computeTrustScore(agent, domain, verifications, revocations, currentTime);
    if (score !== null) {
      scores.set(domain, score);
    }
  }
  
  return scores;
}
