/**
 * Network reputation query handler.
 * Handles incoming reputation_query messages and returns reputation_response.
 */

import type { ReputationQuery, ReputationResponse, TrustScore } from './types.js';
import { computeTrustScore, computeTrustScores } from './scoring.js';
import type { ReputationStore } from './store.js';

/** Maximum number of verification records to include in a response */
const MAX_VERIFICATIONS_IN_RESPONSE = 50;

/**
 * Handle an incoming reputation query by reading from the local store,
 * computing trust scores, and returning a response.
 *
 * @param query - The reputation query (agent, optional domain, optional after timestamp)
 * @param store - Local reputation store to read from
 * @param currentTime - Current timestamp (ms) for score computation
 * @returns Reputation response with computed scores and verification records
 */
export async function handleReputationQuery(
  query: ReputationQuery,
  store: ReputationStore,
  currentTime: number
): Promise<ReputationResponse> {
  // Get all verifications from the store for score computation
  const allVerifications = await store.getVerifications();

  // Filter to verifications targeting the queried agent
  let relevantVerifications = allVerifications.filter(v => v.target === query.agent);

  // Apply domain filter if specified
  if (query.domain !== undefined) {
    relevantVerifications = relevantVerifications.filter(v => v.domain === query.domain);
  }

  // Apply after-timestamp filter if specified
  if (query.after !== undefined) {
    const after = query.after;
    relevantVerifications = relevantVerifications.filter(v => v.timestamp > after);
  }

  // Compute trust scores
  let scores: Record<string, TrustScore>;

  if (query.domain !== undefined) {
    const score = computeTrustScore(query.agent, query.domain, allVerifications, currentTime);
    scores = { [query.domain]: score };
  } else {
    const scoreMap = computeTrustScores(query.agent, allVerifications, currentTime);
    scores = {};
    for (const [domain, score] of scoreMap.entries()) {
      scores[domain] = score;
    }
  }

  // Size-limit verifications to most recent MAX_VERIFICATIONS_IN_RESPONSE
  const limitedVerifications = relevantVerifications
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, MAX_VERIFICATIONS_IN_RESPONSE);

  const response: ReputationResponse = {
    agent: query.agent,
    verifications: limitedVerifications,
    scores,
  };

  if (query.domain !== undefined) {
    response.domain = query.domain;
  }

  return response;
}
