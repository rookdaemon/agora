/**
 * Trust score computation with time decay.
 * Implements basic reputation scoring for Phase 1.
 */

import type { VerificationRecord, TrustScore } from './types.js';

/**
 * Exponential decay function for time-based reputation degradation.
 * 
 * @param deltaTimeMs - Time since verification (milliseconds)
 * @param halfLifeDays - Half-life in days (default 70 days)
 * @returns Weight multiplier (0-1)
 * 
 * Examples:
 * - 7 days old: ~93% weight
 * - 70 days old: ~50% weight
 * - 1 year old: ~2.5% weight
 */
export function decay(deltaTimeMs: number, halfLifeDays = 70): number {
  const deltaDays = deltaTimeMs / (1000 * 60 * 60 * 24);
  // Decay rate lambda = ln(2) / half-life
  const lambda = Math.LN2 / halfLifeDays;
  return Math.exp(-lambda * deltaDays);
}

/**
 * Convert verdict to numeric score.
 * 
 * @param verdict - Verification verdict
 * @returns +1 for correct, -1 for incorrect, 0 for disputed
 */
function verdictScore(verdict: 'correct' | 'incorrect' | 'disputed'): number {
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
 * TrustScore = Σ (verdict(v) × confidence(v) × decay(currentTime - v.timestamp))
 *              / max(verificationCount, 1)
 * 
 * @param agent - Public key of agent being scored
 * @param domain - Capability domain
 * @param verifications - Array of verification records for this agent/domain
 * @param currentTime - Current timestamp (ms), defaults to Date.now()
 * @returns Trust score object
 */
export function computeTrustScore(
  agent: string,
  domain: string,
  verifications: VerificationRecord[],
  currentTime = Date.now()
): TrustScore {
  // Filter verifications for this agent and domain
  const relevantVerifications = verifications.filter(
    v => v.target === agent && v.domain === domain
  );
  
  if (relevantVerifications.length === 0) {
    return {
      agent,
      domain,
      score: 0,
      verificationCount: 0,
      lastVerified: 0,
      topVerifiers: [],
    };
  }
  
  // Compute weighted sum of verifications
  let sum = 0;
  const verifierWeights = new Map<string, number>();
  
  for (const v of relevantVerifications) {
    const deltaTime = currentTime - v.timestamp;
    const decayWeight = decay(deltaTime);
    const verdictWeight = verdictScore(v.verdict);
    const weight = verdictWeight * v.confidence * decayWeight;
    
    sum += weight;
    
    // Track weight per verifier
    const currentWeight = verifierWeights.get(v.verifier) || 0;
    verifierWeights.set(v.verifier, currentWeight + Math.abs(weight));
  }
  
  // Compute average score (normalize by count)
  const score = sum / Math.max(relevantVerifications.length, 1);
  
  // Normalize score to [0, 1] range (from [-1, 1])
  const normalizedScore = (score + 1) / 2;
  
  // Find most recent verification
  const lastVerified = Math.max(...relevantVerifications.map(v => v.timestamp));
  
  // Get top verifiers by weight
  const topVerifiers = Array.from(verifierWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verifier]) => verifier);
  
  return {
    agent,
    domain,
    score: Math.max(0, Math.min(1, normalizedScore)), // Clamp to [0, 1]
    verificationCount: relevantVerifications.length,
    lastVerified,
    topVerifiers,
  };
}

/**
 * Compute trust scores for an agent across all domains.
 * 
 * @param agent - Public key of agent being scored
 * @param verifications - Array of all verification records
 * @param currentTime - Current timestamp (ms), defaults to Date.now()
 * @returns Map of domain to trust score
 */
export function computeAllTrustScores(
  agent: string,
  verifications: VerificationRecord[],
  currentTime = Date.now()
): Map<string, TrustScore> {
  // Get unique domains for this agent
  const domains = new Set(
    verifications
      .filter(v => v.target === agent)
      .map(v => v.domain)
  );
  
  const scores = new Map<string, TrustScore>();
  
  for (const domain of domains) {
    const score = computeTrustScore(agent, domain, verifications, currentTime);
    scores.set(domain, score);
  }
  
  return scores;
}
