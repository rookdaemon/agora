import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createCommit,
  createReveal,
  verifyReveal,
  hashPrediction,
  isCommitmentExpired,
} from '../../src/reputation/commit-reveal.js';

describe('Commit-Reveal Pattern', () => {
  describe('hashPrediction', () => {
    it('should generate deterministic hash for same prediction', () => {
      const prediction = 'It will rain in Stockholm on 2026-02-17';
      const hash1 = hashPrediction(prediction);
      const hash2 = hashPrediction(prediction);
      assert.strictEqual(hash1, hash2);
    });

    it('should generate different hashes for different predictions', () => {
      const hash1 = hashPrediction('prediction A');
      const hash2 = hashPrediction('prediction B');
      assert.notStrictEqual(hash1, hash2);
    });

    it('should return 64-character hex string', () => {
      const hash = hashPrediction('test');
      assert.strictEqual(hash.length, 64);
      assert.ok(/^[0-9a-f]+$/.test(hash));
    });
  });

  describe('createCommit', () => {
    it('should create a valid commit record', () => {
      const kp = generateKeyPair();
      const prediction = 'Test prediction';
      const domain = 'weather_forecast';

      const commit = createCommit(kp.publicKey, kp.privateKey, domain, prediction);

      assert.strictEqual(commit.agent, kp.publicKey);
      assert.strictEqual(commit.domain, domain);
      assert.ok(commit.id);
      assert.ok(commit.commitment);
      assert.ok(commit.signature);
      assert.ok(commit.timestamp > 0);
      assert.ok(commit.expiry > commit.timestamp);
    });

    it('should generate correct commitment hash', () => {
      const kp = generateKeyPair();
      const prediction = 'Test prediction';
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', prediction);

      const expectedHash = hashPrediction(prediction);
      assert.strictEqual(commit.commitment, expectedHash);
    });

    it('should respect custom expiry time', () => {
      const kp = generateKeyPair();
      const prediction = 'Test';
      const expiryMs = 1000; // 1 second

      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', prediction, expiryMs);

      assert.strictEqual(commit.expiry - commit.timestamp, expiryMs);
    });
  });

  describe('createReveal', () => {
    it('should create a valid reveal record', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction');
      
      const reveal = createReveal(
        kp.publicKey,
        kp.privateKey,
        commit.id,
        'prediction',
        'outcome observed',
      );

      assert.strictEqual(reveal.agent, kp.publicKey);
      assert.strictEqual(reveal.commitmentId, commit.id);
      assert.strictEqual(reveal.prediction, 'prediction');
      assert.strictEqual(reveal.outcome, 'outcome observed');
      assert.ok(reveal.id);
      assert.ok(reveal.signature);
      assert.ok(reveal.timestamp > 0);
    });

    it('should include evidence when provided', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction');
      
      const reveal = createReveal(
        kp.publicKey,
        kp.privateKey,
        commit.id,
        'prediction',
        'outcome',
        'https://evidence.com/proof',
      );

      assert.strictEqual(reveal.evidence, 'https://evidence.com/proof');
    });

    it('should not include evidence field when not provided', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction');
      
      const reveal = createReveal(
        kp.publicKey,
        kp.privateKey,
        commit.id,
        'prediction',
        'outcome',
      );

      assert.strictEqual(reveal.evidence, undefined);
      assert.ok(!('evidence' in reveal) || reveal.evidence === undefined);
    });
  });

  describe('verifyReveal', () => {
    it('should verify a valid reveal', () => {
      const kp = generateKeyPair();
      const prediction = 'Test prediction';
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', prediction);
      const reveal = createReveal(kp.publicKey, kp.privateKey, commit.id, prediction, 'outcome');

      const result = verifyReveal(commit, reveal);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('should reject reveal with wrong commitment ID', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction');
      const reveal = createReveal(kp.publicKey, kp.privateKey, 'wrong-id', 'prediction', 'outcome');

      const result = verifyReveal(commit, reveal);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'commitment_id_mismatch');
    });

    it('should reject reveal with wrong agent', () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const commit = createCommit(kp1.publicKey, kp1.privateKey, 'test', 'prediction');
      const reveal = createReveal(kp2.publicKey, kp2.privateKey, commit.id, 'prediction', 'outcome');

      const result = verifyReveal(commit, reveal);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'agent_mismatch');
    });

    it('should reject reveal with wrong prediction', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'original prediction');
      const reveal = createReveal(kp.publicKey, kp.privateKey, commit.id, 'different prediction', 'outcome');

      const result = verifyReveal(commit, reveal);

      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'prediction_hash_mismatch');
    });
  });

  describe('isCommitmentExpired', () => {
    it('should return false for non-expired commitment', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction', 1000000);

      assert.strictEqual(isCommitmentExpired(commit), false);
    });

    it('should return true for expired commitment', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction', -1000);
      
      // Wait a bit to ensure expiry
      const futureTime = Date.now() + 1000;
      assert.strictEqual(isCommitmentExpired(commit, futureTime), true);
    });

    it('should use custom current time parameter', () => {
      const kp = generateKeyPair();
      const commit = createCommit(kp.publicKey, kp.privateKey, 'test', 'prediction', 1000);
      
      const pastTime = commit.timestamp - 1000;
      assert.strictEqual(isCommitmentExpired(commit, pastTime), false);
      
      const futureTime = commit.expiry + 1000;
      assert.strictEqual(isCommitmentExpired(commit, futureTime), true);
    });
  });
});
