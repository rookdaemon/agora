import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { ReputationStore } from '../../src/reputation/store.js';
import {
  createVerification,
  createRevocation,
} from '../../src/reputation/verification.js';
import {
  createCommit,
  createReveal,
} from '../../src/reputation/commit-reveal.js';

describe('ReputationStore', () => {
  const testStorePath = '/tmp/agora-test-reputation.jsonl';

  beforeEach(() => {
    // Clean up test file before each test
    if (existsSync(testStorePath)) {
      unlinkSync(testStorePath);
    }
    const dir = dirname(testStorePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });

  describe('constructor', () => {
    it('should create a new store with empty state', () => {
      const store = new ReputationStore(testStorePath);

      assert.strictEqual(store.getAllVerifications().length, 0);
      assert.strictEqual(store.getAllCommits().length, 0);
      assert.strictEqual(store.getAllReveals().length, 0);
      assert.strictEqual(store.getAllRevocations().length, 0);
    });

    it('should create directory if it does not exist', () => {
      const nestedPath = '/tmp/agora-test/nested/reputation.jsonl';
      const nestedDir = dirname(nestedPath);
      
      // Clean up if exists from previous runs
      if (existsSync(nestedPath)) {
        unlinkSync(nestedPath);
      }

      new ReputationStore(nestedPath);
      assert.ok(existsSync(nestedDir));

      // Clean up
      if (existsSync(nestedPath)) {
        unlinkSync(nestedPath);
      }
    });

    it('should load existing data from file', () => {
      const kp = generateKeyPair();
      const store1 = new ReputationStore(testStorePath);

      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      store1.addVerification(verification);

      // Create new store instance - should load from file
      const store2 = new ReputationStore(testStorePath);
      assert.strictEqual(store2.getAllVerifications().length, 1);
      assert.strictEqual(store2.getAllVerifications()[0].id, verification.id);
    });
  });

  describe('addVerification', () => {
    it('should add verification to store', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);

      store.addVerification(verification);

      const verifications = store.getAllVerifications();
      assert.strictEqual(verifications.length, 1);
      assert.strictEqual(verifications[0].id, verification.id);
    });

    it('should persist verification to file', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);

      store.addVerification(verification);

      // Verify file exists and contains data
      assert.ok(existsSync(testStorePath));
      const store2 = new ReputationStore(testStorePath);
      assert.strictEqual(store2.getAllVerifications().length, 1);
    });
  });

  describe('addCommit', () => {
    it('should add commit to store', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'weather', 'prediction');

      store.addCommit(commit);

      const commits = store.getAllCommits();
      assert.strictEqual(commits.length, 1);
      assert.strictEqual(commits[0].id, commit.id);
    });
  });

  describe('addReveal', () => {
    it('should add reveal to store', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'weather', 'prediction');
      const reveal = createReveal(kp.publicKey, kp.privateKey, commit.id, 'prediction', 'outcome');

      store.addReveal(reveal);

      const reveals = store.getAllReveals();
      assert.strictEqual(reveals.length, 1);
      assert.strictEqual(reveals[0].id, reveal.id);
    });
  });

  describe('addRevocation', () => {
    it('should add revocation to store', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      const revocation = createRevocation(kp.publicKey, kp.privateKey, verification.id, 'discovered_error');

      store.addRevocation(revocation);

      const revocations = store.getAllRevocations();
      assert.strictEqual(revocations.length, 1);
      assert.strictEqual(revocations[0].id, revocation.id);
    });

    it('should mark verification as revoked', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      
      store.addVerification(verification);
      assert.strictEqual(store.isRevoked(verification.id), false);

      const revocation = createRevocation(kp.publicKey, kp.privateKey, verification.id, 'discovered_error');
      store.addRevocation(revocation);

      assert.strictEqual(store.isRevoked(verification.id), true);
    });

    it('should exclude revoked verifications from queries', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const v1 = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      const v2 = createVerification(kp.publicKey, kp.privateKey, 't2', 'ocr', 'correct', 0.9);

      store.addVerification(v1);
      store.addVerification(v2);
      assert.strictEqual(store.getAllVerifications().length, 2);

      const revocation = createRevocation(kp.publicKey, kp.privateKey, v1.id, 'discovered_error');
      store.addRevocation(revocation);

      // Should only return non-revoked verification
      assert.strictEqual(store.getAllVerifications().length, 1);
      assert.strictEqual(store.getAllVerifications()[0].id, v2.id);
    });
  });

  describe('getVerificationsForTarget', () => {
    it('should return verifications for specific target', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const v1 = createVerification(kp.publicKey, kp.privateKey, 'target1', 'ocr', 'correct', 0.9);
      const v2 = createVerification(kp.publicKey, kp.privateKey, 'target2', 'ocr', 'correct', 0.8);
      const v3 = createVerification(kp.publicKey, kp.privateKey, 'target1', 'ocr', 'incorrect', 0.7);

      store.addVerification(v1);
      store.addVerification(v2);
      store.addVerification(v3);

      const verifications = store.getVerificationsForTarget('target1');
      assert.strictEqual(verifications.length, 2);
      assert.ok(verifications.some(v => v.id === v1.id));
      assert.ok(verifications.some(v => v.id === v3.id));
    });
  });

  describe('getVerificationsByVerifier', () => {
    it('should return verifications by specific verifier', () => {
      const store = new ReputationStore(testStorePath);
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', 'ocr', 'correct', 0.9);
      const v2 = createVerification(kp2.publicKey, kp2.privateKey, 't2', 'ocr', 'correct', 0.8);
      const v3 = createVerification(kp1.publicKey, kp1.privateKey, 't3', 'ocr', 'incorrect', 0.7);

      store.addVerification(v1);
      store.addVerification(v2);
      store.addVerification(v3);

      const verifications = store.getVerificationsByVerifier(kp1.publicKey);
      assert.strictEqual(verifications.length, 2);
      assert.ok(verifications.some(v => v.id === v1.id));
      assert.ok(verifications.some(v => v.id === v3.id));
    });
  });

  describe('getVerificationsByDomain', () => {
    it('should return verifications in specific domain', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const v1 = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      const v2 = createVerification(kp.publicKey, kp.privateKey, 't2', 'summarization', 'correct', 0.8);
      const v3 = createVerification(kp.publicKey, kp.privateKey, 't3', 'ocr', 'incorrect', 0.7);

      store.addVerification(v1);
      store.addVerification(v2);
      store.addVerification(v3);

      const verifications = store.getVerificationsByDomain('ocr');
      assert.strictEqual(verifications.length, 2);
      assert.ok(verifications.some(v => v.id === v1.id));
      assert.ok(verifications.some(v => v.id === v3.id));
    });
  });

  describe('getCommit', () => {
    it('should retrieve commit by ID', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'weather', 'prediction');

      store.addCommit(commit);

      const retrieved = store.getCommit(commit.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, commit.id);
    });

    it('should return undefined for non-existent commit', () => {
      const store = new ReputationStore(testStorePath);
      const retrieved = store.getCommit('non-existent-id');
      assert.strictEqual(retrieved, undefined);
    });
  });

  describe('getCommitsByAgent', () => {
    it('should return all commits by an agent', () => {
      const store = new ReputationStore(testStorePath);
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const c1 = createCommit(kp1.publicKey, kp1.privateKey, 'weather', 'prediction1');
      const c2 = createCommit(kp2.publicKey, kp2.privateKey, 'weather', 'prediction2');
      const c3 = createCommit(kp1.publicKey, kp1.privateKey, 'market', 'prediction3');

      store.addCommit(c1);
      store.addCommit(c2);
      store.addCommit(c3);

      const commits = store.getCommitsByAgent(kp1.publicKey);
      assert.strictEqual(commits.length, 2);
      assert.ok(commits.some(c => c.id === c1.id));
      assert.ok(commits.some(c => c.id === c3.id));
    });
  });

  describe('getRevealByCommitment', () => {
    it('should retrieve reveal by commitment ID', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'weather', 'prediction');
      const reveal = createReveal(kp.publicKey, kp.privateKey, commit.id, 'prediction', 'outcome');

      store.addReveal(reveal);

      const retrieved = store.getRevealByCommitment(commit.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.commitmentId, commit.id);
    });
  });

  describe('getRevealsByAgent', () => {
    it('should return all reveals by an agent', () => {
      const store = new ReputationStore(testStorePath);
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const r1 = createReveal(kp1.publicKey, kp1.privateKey, 'c1', 'p1', 'o1');
      const r2 = createReveal(kp2.publicKey, kp2.privateKey, 'c2', 'p2', 'o2');
      const r3 = createReveal(kp1.publicKey, kp1.privateKey, 'c3', 'p3', 'o3');

      store.addReveal(r1);
      store.addReveal(r2);
      store.addReveal(r3);

      const reveals = store.getRevealsByAgent(kp1.publicKey);
      assert.strictEqual(reveals.length, 2);
      assert.ok(reveals.some(r => r.id === r1.id));
      assert.ok(reveals.some(r => r.id === r3.id));
    });
  });

  describe('computeTrustScore', () => {
    it('should compute trust score for agent in domain', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();
      const agent = 'test-agent-key';
      const v1 = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);

      store.addVerification(v1);

      const score = store.computeTrustScore(agent, 'ocr');
      assert.ok(score);
      assert.strictEqual(score.agent, agent);
      assert.strictEqual(score.domain, 'ocr');
      assert.ok(score.score >= 0 && score.score <= 1);
    });
  });

  describe('persistence', () => {
    it('should persist multiple entries to JSONL', () => {
      const store = new ReputationStore(testStorePath);
      const kp = generateKeyPair();

      const verification = createVerification(kp.publicKey, kp.privateKey, 't1', 'ocr', 'correct', 0.9);
      const commit = createCommit(kp.publicKey, kp.privateKey, 'weather', 'prediction');
      const reveal = createReveal(kp.publicKey, kp.privateKey, commit.id, 'prediction', 'outcome');
      const revocation = createRevocation(kp.publicKey, kp.privateKey, verification.id, 'discovered_error');

      store.addVerification(verification);
      store.addCommit(commit);
      store.addReveal(reveal);
      store.addRevocation(revocation);

      // Load in new store instance
      const store2 = new ReputationStore(testStorePath);
      assert.strictEqual(store2.getAllVerifications().length, 0); // Revoked
      assert.strictEqual(store2.getAllCommits().length, 1);
      assert.strictEqual(store2.getAllReveals().length, 1);
      assert.strictEqual(store2.getAllRevocations().length, 1);
      assert.strictEqual(store2.isRevoked(verification.id), true);
    });
  });
});
