/**
 * Tests for the reputation network query handler.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification } from '../../src/reputation/verification';
import { handleReputationQuery } from '../../src/reputation/network';
import { ReputationStore } from '../../src/reputation/store';

function createTempStore(): { store: ReputationStore; cleanup: () => void } {
  const tempDir = mkdtempSync(join(tmpdir(), 'agora-network-test-'));
  const filePath = join(tempDir, 'reputation.jsonl');
  const store = new ReputationStore(filePath);
  return {
    store,
    cleanup: () => rmSync(tempDir, { recursive: true, force: true }),
  };
}

describe('handleReputationQuery', () => {
  it('should return empty response for unknown agent', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const response = await handleReputationQuery(
        { agent: 'unknown-agent' },
        store,
        1000000000
      );

      assert.strictEqual(response.agent, 'unknown-agent');
      assert.strictEqual(response.verifications.length, 0);
      assert.deepStrictEqual(response.scores, {});
    } finally {
      cleanup();
    }
  });

  it('should return verifications for a known agent', async () => {
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
      await store.addVerification(v);

      const response = await handleReputationQuery(
        { agent: agent.publicKey },
        store,
        currentTime
      );

      assert.strictEqual(response.agent, agent.publicKey);
      assert.strictEqual(response.verifications.length, 1);
      assert.strictEqual(response.verifications[0].id, v.id);
      assert.ok('ocr' in response.scores);
      assert.ok(response.scores['ocr'].score > 0.5);
    } finally {
      cleanup();
    }
  });

  it('should filter by domain when specified', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const ocrV = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );
      const summaryV = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'summarization',
        'correct',
        0.8,
        currentTime
      );
      await store.addVerification(ocrV);
      await store.addVerification(summaryV);

      // Query only for 'ocr'
      const response = await handleReputationQuery(
        { agent: agent.publicKey, domain: 'ocr' },
        store,
        currentTime
      );

      assert.strictEqual(response.domain, 'ocr');
      assert.strictEqual(response.verifications.length, 1);
      assert.strictEqual(response.verifications[0].domain, 'ocr');
      // Scores should only include 'ocr'
      assert.ok('ocr' in response.scores);
    } finally {
      cleanup();
    }
  });

  it('should filter by after timestamp when specified', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const oldTime = 1000000000;
      const newTime = 1000100000;

      const oldV = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        oldTime
      );
      const newV = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.9,
        newTime
      );
      await store.addVerification(oldV);
      await store.addVerification(newV);

      // Only return verifications after oldTime
      const response = await handleReputationQuery(
        { agent: agent.publicKey, after: oldTime },
        store,
        newTime
      );

      assert.strictEqual(response.verifications.length, 1);
      assert.strictEqual(response.verifications[0].id, newV.id);
    } finally {
      cleanup();
    }
  });

  it('should limit response to 50 most recent verifications', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const agent = generateKeyPair();
      const baseTime = 1000000000;

      // Add 60 verifications
      for (let i = 0; i < 60; i++) {
        const verifier = generateKeyPair();
        const v = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9,
          baseTime + i * 1000
        );
        await store.addVerification(v);
      }

      const response = await handleReputationQuery(
        { agent: agent.publicKey },
        store,
        baseTime + 60000
      );

      // Should be capped at 50
      assert.ok(response.verifications.length <= 50);
    } finally {
      cleanup();
    }
  });

  it('should return most recent verifications when capping', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const agent = generateKeyPair();
      const baseTime = 1000000000;

      // Add 55 verifications with sequential timestamps
      const verifications = [];
      for (let i = 0; i < 55; i++) {
        const verifier = generateKeyPair();
        const v = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9,
          baseTime + i * 1000
        );
        await store.addVerification(v);
        verifications.push(v);
      }

      const response = await handleReputationQuery(
        { agent: agent.publicKey },
        store,
        baseTime + 60000
      );

      assert.strictEqual(response.verifications.length, 50);
      // Most recent verification should be first
      const mostRecentTimestamp = baseTime + 54 * 1000;
      assert.strictEqual(response.verifications[0].timestamp, mostRecentTimestamp);
    } finally {
      cleanup();
    }
  });

  it('should include scores for all domains when no domain filter', async () => {
    const { store, cleanup } = createTempStore();
    try {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      await store.addVerification(
        createVerification(verifier.publicKey, verifier.privateKey, agent.publicKey, 'ocr', 'correct', 0.9, currentTime)
      );
      await store.addVerification(
        createVerification(verifier.publicKey, verifier.privateKey, agent.publicKey, 'summarization', 'correct', 0.8, currentTime)
      );

      const response = await handleReputationQuery(
        { agent: agent.publicKey },
        store,
        currentTime
      );

      assert.ok('ocr' in response.scores);
      assert.ok('summarization' in response.scores);
      assert.strictEqual(response.domain, undefined);
    } finally {
      cleanup();
    }
  });
});
