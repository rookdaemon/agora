/**
 * Trust score computation with time-based decay.
 * 
 * Computes reputation scores from verification history with exponential decay.
 */

import type { TrustScore, VerificationRecord } from './types.js';

/**
 * Default decay rate: 0.01/day = ~70-day half-life
 * Expressed as rate per millisecond for computation
 */
const DEFAULT_LAMBDA = 0.01 / (1000 * 60 * 60 * 24); // 1.157e-7/ms

/**
 * Exponential decay function for time-based reputation degradation.
 * 
 * @param deltaTimeMs - Time since verification (milliseconds)
 * @param lambda - Decay rate (default: 1.157e-7/ms for ~70-day half-life)
 * @returns Weight multiplier (0-1)
 */
export function decay(deltaTimeMs: number, lambda: number = DEFAULT_LAMBDA): number {
  if (deltaTimeMs < 0) {
    return 1.0; // Future verifications have full weight (shouldn't happen)
  }
  return Math.exp(-lambda * deltaTimeMs);
}

/**
 * Computes trust score for an agent in a specific domain.
 * 
 * Formula: TrustScore = Σ (verdict × confidence × decay) / max(count, 1)
 * 
 * Where:
 * - verdict = +1 for 'correct', -1 for 'incorrect', 0 for 'disputed'
 * - confidence = verifier's confidence (0-1)
 * - decay = exponential decay based on age
 * 
 * @param agent - Public key of agent being scored
 * @param domain - Capability domain
 * @param verifications - Verification records for this agent/domain
 * @param currentTime - Current timestamp (defaults to Date.now())
 * @returns Trust score object
 */
export function computeTrustScore(
  agent: string,
  domain: string,
  verifications: VerificationRecord[],
  currentTime?: number
): TrustScore {
  const now = currentTime ?? Date.now();
  
  // Filter verifications for this agent and domain
  const relevantVerifications = verifications.filter(
    v => v.target === agent || isVerificationForAgent(v, agent) && v.domain === domain
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
  
  // Compute weighted sum
  let weightedSum = 0;
  const verifierWeights = new Map<string, number>();
  let mostRecent = 0;
  
  for (const verification of relevantVerifications) {
    // Convert verdict to numeric weight
    let verdictWeight = 0;
    if (verification.verdict === 'correct') {
      verdictWeight = 1;
    } else if (verification.verdict === 'incorrect') {
      verdictWeight = -1;
    } else {
      verdictWeight = 0; // disputed
    }
    
    // Apply decay based on age
    const age = now - verification.timestamp;
    const decayWeight = decay(age);
    
    // Compute contribution
    const contribution = verdictWeight * verification.confidence * decayWeight;
    weightedSum += contribution;
    
    // Track verifier contributions
    const currentWeight = verifierWeights.get(verification.verifier) ?? 0;
    verifierWeights.set(verification.verifier, currentWeight + Math.abs(contribution));
    
    // Track most recent verification
    if (verification.timestamp > mostRecent) {
      mostRecent = verification.timestamp;
    }
  }
  
  // Normalize by count (prevent single verification from dominating)
  const score = weightedSum / Math.max(relevantVerifications.length, 1);
  
  // Clamp to [0, 1] range
  const clampedScore = Math.max(0, Math.min(1, score));
  
  // Get top verifiers by weight
  const topVerifiers = Array.from(verifierWeights.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([verifier]) => verifier);
  
  return {
    agent,
    domain,
    score: clampedScore,
    verificationCount: relevantVerifications.length,
    lastVerified: mostRecent,
    topVerifiers,
  };
}

/**
 * Helper to check if a verification is for a specific agent.
 * This checks the target field which should contain the agent's public key
 * or a message ID from that agent.
 * 
 * @param verification - Verification record
 * @param agent - Agent public key
 * @returns true if verification is for this agent
 */
function isVerificationForAgent(verification: VerificationRecord, agent: string): boolean {
  // In Phase 1, we assume target is either the agent's public key
  // or a message ID that we need to look up separately
  // For simplicity, we'll check if target matches agent
  return verification.target === agent;
}

/**
 * Computes trust scores for an agent across all domains.
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
  const scores = new Map<string, TrustScore>();
  
  // Group verifications by domain
  const domains = new Set(verifications.map(v => v.domain));
  
  for (const domain of domains) {
    const score = computeTrustScore(agent, domain, verifications, now);
    if (score.verificationCount > 0) {
      scores.set(domain, score);
    }
  }
  
  return scores;
}
