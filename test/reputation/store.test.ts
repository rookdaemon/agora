/**
 * Tests for reputation store with JSONL persistence
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification } from '../../src/reputation/verification';
import { createCommit, createReveal } from '../../src/reputation/commit-reveal';
import { ReputationStore } from '../../src/reputation/store';

const TEST_DIR = '/tmp/agora-test-reputation';

describe('ReputationStore', () => {
  afterEach(async () => {
    // Clean up test files
    try {
      await fs.rm(TEST_DIR, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('addVerification', () => {
    it('should add and retrieve verification', async () => {
      const storePath = join(TEST_DIR, 'test1.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      await store.addVerification(verification);
      
      const verifications = await store.getVerifications();
      assert.strictEqual(verifications.length, 1);
      assert.deepStrictEqual(verifications[0], verification);
    });

    it('should persist verification to disk', async () => {
      const storePath = join(TEST_DIR, 'test2.jsonl');
      const store1 = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      await store1.addVerification(verification);
      
      // Create new store instance and load
      const store2 = new ReputationStore(storePath);
      const verifications = await store2.getVerifications();
      
      assert.strictEqual(verifications.length, 1);
      assert.strictEqual(verifications[0].id, verification.id);
    });

    it('should handle multiple verifications', async () => {
      const storePath = join(TEST_DIR, 'test3.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const timestamp = 1000000000;
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target1',
        'ocr',
        'correct',
        0.9,
        timestamp
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target2',
        'summarization',
        'correct',
        0.95,
        timestamp
      );
      
      await store.addVerification(v1);
      await store.addVerification(v2);
      
      const verifications = await store.getVerifications();
      assert.strictEqual(verifications.length, 2);
    });
  });

  describe('addCommit', () => {
    it('should add and retrieve commit', async () => {
      const storePath = join(TEST_DIR, 'test4.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const timestamp = 1000000000;
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'It will rain tomorrow',
        timestamp,
        86400000
      );
      
      await store.addCommit(commit);
      
      const commits = await store.getCommits();
      assert.strictEqual(commits.length, 1);
      assert.deepStrictEqual(commits[0], commit);
    });

    it('should retrieve commit by ID', async () => {
      const storePath = join(TEST_DIR, 'test5.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const timestamp = 1000000000;
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'It will rain tomorrow',
        timestamp,
        86400000
      );
      
      await store.addCommit(commit);
      
      const retrieved = await store.getCommit(commit.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, commit.id);
    });

    it('should filter commits by agent', async () => {
      const storePath = join(TEST_DIR, 'test6.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      
      const commit1 = createCommit(
        agent1.publicKey,
        agent1.privateKey,
        'weather_forecast',
        'Prediction 1',
        86400000
      );
      
      const commit2 = createCommit(
        agent2.publicKey,
        agent2.privateKey,
        'weather_forecast',
        'Prediction 2',
        86400000
      );
      
      await store.addCommit(commit1);
      await store.addCommit(commit2);
      
      const agent1Commits = await store.getCommitsByAgent(agent1.publicKey);
      assert.strictEqual(agent1Commits.length, 1);
      assert.strictEqual(agent1Commits[0].agent, agent1.publicKey);
    });
  });

  describe('addReveal', () => {
    it('should add and retrieve reveal', async () => {
      const storePath = join(TEST_DIR, 'test7.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit123',
        'It will rain tomorrow',
        'rain observed',
        1000000000
      );
      
      await store.addReveal(reveal);
      
      const reveals = await store.getReveals();
      assert.strictEqual(reveals.length, 1);
      assert.deepStrictEqual(reveals[0], reveal);
    });

    it('should retrieve reveal by commitment ID', async () => {
      const storePath = join(TEST_DIR, 'test8.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const commitId = 'commit123';
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commitId,
        'It will rain tomorrow',
        'rain observed',
        1000000000
      );
      
      await store.addReveal(reveal);
      
      const retrieved = await store.getRevealByCommitment(commitId);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.commitmentId, commitId);
    });
  });

  describe('getVerificationsByTarget', () => {
    it('should filter verifications by target', async () => {
      const storePath = join(TEST_DIR, 'test9.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const timestamp = 1000000000;
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target1',
        'ocr',
        'correct',
        0.9,
        timestamp
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target2',
        'ocr',
        'correct',
        0.95,
        timestamp
      );
      
      await store.addVerification(v1);
      await store.addVerification(v2);
      
      const target1Verifications = await store.getVerificationsByTarget('target1');
      assert.strictEqual(target1Verifications.length, 1);
      assert.strictEqual(target1Verifications[0].target, 'target1');
    });
  });

  describe('getVerificationsByDomain', () => {
    it('should filter verifications by domain', async () => {
      const storePath = join(TEST_DIR, 'test10.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const timestamp = 1000000000;
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target1',
        'ocr',
        'correct',
        0.9,
        timestamp
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target2',
        'summarization',
        'correct',
        0.95,
        timestamp
      );
      
      await store.addVerification(v1);
      await store.addVerification(v2);
      
      const ocrVerifications = await store.getVerificationsByDomain('ocr');
      assert.strictEqual(ocrVerifications.length, 1);
      assert.strictEqual(ocrVerifications[0].domain, 'ocr');
    });
  });

  describe('mixed records', () => {
    it('should handle verification, commit, and reveal in same store', async () => {
      const storePath = join(TEST_DIR, 'test11.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const timestamp = 1000000000;
      
      const verification = createVerification(
        agent.publicKey,
        agent.privateKey,
        'target1',
        'ocr',
        'correct',
        0.9,
        timestamp
      );
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'Prediction',
        timestamp,
        86400000
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit123',
        'Prediction',
        'Outcome',
        timestamp
      );
      
      await store.addVerification(verification);
      await store.addCommit(commit);
      await store.addReveal(reveal);
      
      const verifications = await store.getVerifications();
      const commits = await store.getCommits();
      const reveals = await store.getReveals();
      
      assert.strictEqual(verifications.length, 1);
      assert.strictEqual(commits.length, 1);
      assert.strictEqual(reveals.length, 1);
    });
  });
});
