/**
 * Cross-peer reputation synchronization.
 * Pull and merge verification records from trusted peers.
 */

import type { ReputationQuery, ReputationResponse } from './types.js';
import { verifyVerificationSignature } from './verification.js';
import type { ReputationStore } from './store.js';

/**
 * Pull reputation data from a peer and merge it into the local store.
 *
 * Flow:
 * 1. Send `reputation_query` to peer via sendMessage
 * 2. Receive `reputation_response` with verification records
 * 3. For each record: verify signature, check domain matches, check not duplicate
 * 4. Append new records to local store
 * 5. Return count of added/skipped
 *
 * @param agentPublicKey - Public key of the agent whose reputation to sync
 * @param domain - Domain to sync reputation for
 * @param store - Local reputation store to merge records into
 * @param sendMessage - Function that sends a reputation_query and returns the response
 * @returns Counts of records added and skipped
 */
export async function syncReputationFromPeer(
  agentPublicKey: string,
  domain: string,
  store: ReputationStore,
  sendMessage: (type: string, payload: ReputationQuery) => Promise<ReputationResponse>
): Promise<{ added: number; skipped: number }> {
  // Build and send the query
  const query: ReputationQuery = {
    agent: agentPublicKey,
    domain,
  };

  const response = await sendMessage('reputation_query', query);

  // Build set of existing record IDs for fast deduplication
  const existing = await store.getVerifications();
  const existingIds = new Set(existing.map(v => v.id));

  let added = 0;
  let skipped = 0;

  for (const record of response.verifications) {
    // Skip duplicate records (content-addressed by ID)
    if (existingIds.has(record.id)) {
      skipped++;
      continue;
    }

    // Verify cryptographic signature before accepting
    const sigResult = verifyVerificationSignature(record);
    if (!sigResult.valid) {
      skipped++;
      continue;
    }

    // Ensure the record's domain matches what we requested
    if (record.domain !== domain) {
      skipped++;
      continue;
    }

    // Add to local store and track for deduplication within this batch
    await store.addVerification(record);
    existingIds.add(record.id);
    added++;
  }

  return { added, skipped };
}
