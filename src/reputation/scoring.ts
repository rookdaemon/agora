/**
 * Trust score computation with time-based decay.
 * Implements Phase 1 reputation scoring algorithm.
 */

import type { VerificationRecord, TrustScore } from './types.js';

/**
 * Exponential decay function for time-based reputation degradation.
 * @param deltaTimeMs - Time since verification (milliseconds)
 * @param lambda - Decay rate per millisecond (default: 1.157e-10/ms ≈ 0.01/day, ~70-day half-life)
 * @returns Weight multiplier (0-1)
 * 
 * Examples:
 * - 7 days old: ~93% weight
 * - 70 days old: ~50% weight
 * - 1 year old: ~2.5% weight
 */
export function decay(deltaTimeMs: number, lambda: number = 1.157e-10): number {
  return Math.exp(-lambda * deltaTimeMs);
}

/**
 * Convert verdict to numeric score.
 * @param verdict - The verification verdict
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
 * Phase 1 implementation: basic scoring with time decay, no recursive trust.
 * 
 * Formula:
 * TrustScore = Σ (verdict(v) × confidence(v) × decay(currentTime - v.timestamp))
 *              / max(verificationCount, 1)
 * 
 * @param agent - Public key of agent to score
 * @param domain - Capability domain
 * @param verifications - All verification records for this agent/domain
 * @param currentTime - Current timestamp (default: Date.now())
 * @param revokedIds - Set of revoked verification IDs to exclude
 * @returns Computed TrustScore
 */
export function computeTrustScore(
  agent: string,
  domain: string,
  verifications: VerificationRecord[],
  currentTime: number = Date.now(),
  revokedIds: Set<string> = new Set(),
): TrustScore {
  // Filter verifications for this agent and domain, excluding revoked ones
  const relevantVerifications = verifications.filter(
    v => !revokedIds.has(v.id) && v.domain === domain
  );

  if (relevantVerifications.length === 0) {
    return {
      agent,
      domain,
      score: 0.5, // Neutral score for no verifications
      verificationCount: 0,
      lastVerified: 0,
      topVerifiers: [],
    };
  }

  // Compute weighted sum
  let totalWeight = 0;
  let weightedSum = 0;
  const verifierScores = new Map<string, number>();

  for (const v of relevantVerifications) {
    const deltaTime = currentTime - v.timestamp;
    const decayWeight = decay(deltaTime);
    const verdictScore = verdictToScore(v.verdict);
    const weight = v.confidence * decayWeight;

    weightedSum += verdictScore * weight;
    totalWeight += weight;

    // Track verifier contributions for top verifiers list
    const currentScore = verifierScores.get(v.verifier) || 0;
    verifierScores.set(v.verifier, currentScore + Math.abs(weight));
  }

  // Normalize to 0-1 range
  // Raw score is in range [-1, 1], so we map it to [0, 1]
  const rawScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const normalizedScore = (rawScore + 1) / 2; // Map [-1, 1] to [0, 1]

  // Find most recent verification
  const lastVerified = Math.max(...relevantVerifications.map(v => v.timestamp));

  // Get top verifiers sorted by contribution
  const topVerifiers = Array.from(verifierScores.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verifier]) => verifier);

  return {
    agent,
    domain,
    score: normalizedScore,
    verificationCount: relevantVerifications.length,
    lastVerified,
    topVerifiers,
  };
}

/**
 * Compute trust scores for an agent across all domains.
 * @param agent - Public key of agent to score
 * @param verifications - All verification records
 * @param currentTime - Current timestamp (default: Date.now())
 * @param revokedIds - Set of revoked verification IDs to exclude
 * @returns Map of domain to TrustScore
 */
export function computeAllDomainScores(
  agent: string,
  verifications: VerificationRecord[],
  currentTime: number = Date.now(),
  revokedIds: Set<string> = new Set(),
): Map<string, TrustScore> {
  // Get all unique domains for this agent
  const domains = new Set(
    verifications
      .filter(v => !revokedIds.has(v.id))
      .map(v => v.domain)
  );

  const scores = new Map<string, TrustScore>();

  for (const domain of domains) {
    const score = computeTrustScore(agent, domain, verifications, currentTime, revokedIds);
    scores.set(domain, score);
  }

  return scores;
}

/**
 * Computes trust scores for an agent across all domains (alias for compatibility).
 * 
 * @param agent - Public key of agent being scored
 * @param verifications - All verification records
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Map of domain to trust score
 */
export function computeTrustScoresByDomain(
  agent: string,
  verifications: VerificationRecord[],
  currentTime?: number
): Map<string, TrustScore> {
  const now = currentTime ?? Date.now();
  return computeAllDomainScores(agent, verifications, now, new Set());
}
