/**
 * Trust score computation with exponential time decay.
 * Domain-specific reputation scoring from verification history.
 */

import type { VerificationRecord, TrustScore } from './types';

/**
 * Exponential decay function for time-based reputation degradation.
 * @param deltaTimeMs - Time since verification (milliseconds)
 * @param lambda - Decay rate (default: ln(2)/70 ≈ 0.0099, giving 70-day half-life)
 * @returns Weight multiplier (0-1)
 */
export function decay(deltaTimeMs: number, lambda = Math.log(2) / 70): number {
  const deltaDays = deltaTimeMs / (1000 * 60 * 60 * 24);
  return Math.exp(-lambda * deltaDays);
}

/**
 * Compute verdict weight
 * @param verdict - Verification verdict
 * @returns Weight value (+1 for correct, -1 for incorrect, 0 for disputed)
 */
function verdictWeight(verdict: 'correct' | 'incorrect' | 'disputed'): number {
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
 * Compute trust score for an agent in a specific domain
 * @param agent - Public key of the agent being scored
 * @param domain - Capability domain
 * @param verifications - All verification records (will be filtered by target and domain)
 * @param currentTime - Current timestamp (ms)
 * @returns TrustScore object with computed reputation
 */
export function computeTrustScore(
  agent: string,
  domain: string,
  verifications: VerificationRecord[],
  currentTime: number
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
  
  // Compute weighted score with time decay
  let totalWeight = 0;
  const verifierWeights = new Map<string, number>();
  
  for (const verification of relevantVerifications) {
    const deltaTime = currentTime - verification.timestamp;
    const decayFactor = decay(deltaTime);
    const verdict = verdictWeight(verification.verdict);
    const weight = verdict * verification.confidence * decayFactor;
    
    totalWeight += weight;
    
    // Track verifier contributions
    const currentVerifierWeight = verifierWeights.get(verification.verifier) || 0;
    verifierWeights.set(verification.verifier, currentVerifierWeight + Math.abs(weight));
  }
  
  // Normalize score to 0-1 range
  // Positive verifications push toward 1, negative push toward 0
  const rawScore = totalWeight / Math.max(relevantVerifications.length, 1);
  const normalizedScore = Math.max(0, Math.min(1, (rawScore + 1) / 2));
  
  // Find most recent verification
  const lastVerified = Math.max(...relevantVerifications.map(v => v.timestamp));
  
  // Get top verifiers by absolute weight
  const topVerifiers = Array.from(verifierWeights.entries())
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
 * Compute trust scores for an agent across multiple domains
 * @param agent - Public key of the agent being scored
 * @param verifications - All verification records
 * @param currentTime - Current timestamp (ms)
 * @returns Map of domain to TrustScore
 */
export function computeTrustScores(
  agent: string,
  verifications: VerificationRecord[],
  currentTime: number
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

// Alias for backward compatibility
export const computeAllTrustScores = computeTrustScores;
