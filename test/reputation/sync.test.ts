/**
 * Tests for cross-peer reputation synchronization.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification } from '../../src/reputation/verification';
import { syncReputationFromPeer } from '../../src/reputation/sync';
import { ReputationStore } from '../../src/reputation/store';
import type { ReputationResponse, ReputationQuery } from '../../src/reputation/types';

function createTempStore(): { store: ReputationStore; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), 'agora-sync-test-'));
  const filePath = join(tempDir, 'reputation.jsonl');
  const store = new ReputationStore(filePath);
  return {
    store,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe('syncReputationFromPeer', () => {
  it('should add new verification records from peer response', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [v],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.skipped, 0);

      const stored = await store.getVerifications();
      assert.strictEqual(stored.length, 1);
      assert.strictEqual(stored[0].id, v.id);
    } finally {
      cleanup();
    }
  });

  it('should skip duplicate records (by ID)', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );

      // Pre-populate store with the same verification
      await store.addVerification(v);

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [v],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);

      // Store should still have exactly 1 record
      const stored = await store.getVerifications();
      assert.strictEqual(stored.length, 1);
    } finally {
      cleanup();
    }
  });

  it('should skip records with invalid signatures', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );

      // Tamper with the signature
      const tampered = { ...v, signature: 'deadbeef'.repeat(16) };

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [tampered],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);

      const stored = await store.getVerifications();
      assert.strictEqual(stored.length, 0);
    } finally {
      cleanup();
    }
  });

  it('should skip records with mismatched domain', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'summarization',  // Different domain
        'correct',
        0.9,
        currentTime
      );

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [v],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',  // Queried for 'ocr'
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 1);

      const stored = await store.getVerifications();
      assert.strictEqual(stored.length, 0);
    } finally {
      cleanup();
    }
  });

  it('should handle mixed valid and invalid records', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const validV = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );

      const tamperedV = { ...validV, signature: 'bad'.repeat(42), id: 'different-id' };

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [validV, tamperedV],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.skipped, 1);
    } finally {
      cleanup();
    }
  });

  it('should deduplicate within a single batch', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );

      // Return the same verification twice in one response
      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        domain: 'ocr',
        verifications: [v, v],
        scores: {},
      });

      const result = await syncReputationFromPeer(
        agent.publicKey,
        'ocr',
        store,
        mockSendMessage
      );

      assert.strictEqual(result.added, 1);
      assert.strictEqual(result.skipped, 1);

      const stored = await store.getVerifications();
      assert.strictEqual(stored.length, 1);
    } finally {
      cleanup();
    }
  });

  it('should send reputation_query with correct agent and domain', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const agent = generateKeyPair();

      let capturedType = '';
      let capturedPayload: ReputationQuery | null = null;

      const mockSendMessage = async (type: string, payload: ReputationQuery): Promise<ReputationResponse> => {
        capturedType = type;
        capturedPayload = payload;
        return { agent: agent.publicKey, domain: 'ocr', verifications: [], scores: {} };
      };

      await syncReputationFromPeer(agent.publicKey, 'ocr', store, mockSendMessage);

      assert.strictEqual(capturedType, 'reputation_query');
      assert.ok(capturedPayload);
      assert.strictEqual(capturedPayload.agent, agent.publicKey);
      assert.strictEqual(capturedPayload.domain, 'ocr');
    } finally {
      cleanup();
    }
  });

  it('should return zeros for empty peer response', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const agent = generateKeyPair();

      const mockSendMessage = async (_type: string, _payload: ReputationQuery): Promise<ReputationResponse> => ({
        agent: agent.publicKey,
        verifications: [],
        scores: {},
      });

      const result = await syncReputationFromPeer(agent.publicKey, 'ocr', store, mockSendMessage);

      assert.strictEqual(result.added, 0);
      assert.strictEqual(result.skipped, 0);
    } finally {
      cleanup();
    }
  });
});
