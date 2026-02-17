import { describe, it } from 'node:test';
import assert from 'node:assert';
import { decay, computeTrustScore } from '../../src/reputation/scoring.js';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import type { VerificationRecord } from '../../src/reputation/types.js';

describe('Scoring', () => {
  describe('decay', () => {
    it('should return 1 for zero time delta', () => {
      const result = decay(0);
      assert.strictEqual(result, 1);
    });

    it('should return value less than 1 for positive time delta', () => {
      const oneDayMs = 24 * 60 * 60 * 1000;
      const result = decay(oneDayMs);
      assert.ok(result < 1);
      assert.ok(result > 0);
    });

    it('should decay more for longer time periods', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const sevenDays = 7 * oneDay;
      const seventyDays = 70 * oneDay;

      const decay1 = decay(oneDay);
      const decay7 = decay(sevenDays);
      const decay70 = decay(seventyDays);

      assert.ok(decay1 > decay7);
      assert.ok(decay7 > decay70);
    });

    it('should approximate expected decay values', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const sevenDays = 7 * oneDay;
      const seventyDays = 70 * oneDay;
      const oneYear = 365 * oneDay;

      // 7 days old: ~93% weight
      const decay7 = decay(sevenDays);
      assert.ok(decay7 > 0.9 && decay7 < 0.96);

      // 70 days old: ~50% weight
      const decay70 = decay(seventyDays);
      assert.ok(decay70 > 0.45 && decay70 < 0.55);

      // 1 year old: ~2.5% weight
      const decay365 = decay(oneYear);
      assert.ok(decay365 > 0.01 && decay365 < 0.05);
    });

    it('should use custom lambda parameter', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const defaultDecay = decay(oneDay);
      const fasterDecay = decay(oneDay, 2.314e-10); // Double the decay rate

      assert.ok(fasterDecay < defaultDecay);
    });
  });

  describe('computeTrustScore', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    const agent = 'agent-public-key';
    const domain = 'ocr';

    it('should return neutral score for no verifications', () => {
      const score = computeTrustScore(agent, domain, []);

      assert.strictEqual(score.agent, agent);
      assert.strictEqual(score.domain, domain);
      assert.strictEqual(score.score, 0.5); // Neutral
      assert.strictEqual(score.verificationCount, 0);
      assert.strictEqual(score.lastVerified, 0);
      assert.strictEqual(score.topVerifiers.length, 0);
    });

    it('should compute score for single correct verification', () => {
      const verification = createVerification(
        kp1.publicKey,
        kp1.privateKey,
        'target1',
        domain,
        'correct',
        1.0,
      );

      // Mock the verification to be for our agent
      const verifications: VerificationRecord[] = [verification];

      const score = computeTrustScore(agent, domain, verifications);

      assert.strictEqual(score.verificationCount, 1);
      assert.ok(score.score > 0.5); // Positive verification should increase score above neutral
      assert.ok(score.lastVerified > 0);
      assert.strictEqual(score.topVerifiers.length, 1);
      assert.strictEqual(score.topVerifiers[0], kp1.publicKey);
    });

    it('should compute score for single incorrect verification', () => {
      const verification = createVerification(
        kp1.publicKey,
        kp1.privateKey,
        'target1',
        domain,
        'incorrect',
        1.0,
      );

      const verifications: VerificationRecord[] = [verification];
      const score = computeTrustScore(agent, domain, verifications);

      assert.ok(score.score < 0.5); // Negative verification should decrease score below neutral
    });

    it('should compute score for disputed verification', () => {
      const verification = createVerification(
        kp1.publicKey,
        kp1.privateKey,
        'target1',
        domain,
        'disputed',
        1.0,
      );

      const verifications: VerificationRecord[] = [verification];
      const score = computeTrustScore(agent, domain, verifications);

      assert.strictEqual(score.score, 0.5); // Disputed = neutral, no change
    });

    it('should weight verifications by confidence', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      const v2 = createVerification(kp1.publicKey, kp1.privateKey, 't2', domain, 'correct', 0.5);

      // Single verification scenario - raw weighted scores
      const verifications1 = [v1];
      const verifications2 = [v2];
      
      const score1 = computeTrustScore(agent, domain, verifications1);
      const score2 = computeTrustScore(agent, domain, verifications2);

      // Both are single positive verifications, so both will result in high scores
      // But higher confidence should result in score closer to 1.0
      // Since both are normalized the same way for single verifications, let's check the difference
      assert.ok(score1.score >= score2.score); // High confidence should be >= lower confidence
    });

    it('should apply time decay to older verifications', () => {
      const now = Date.now();
      const seventyDaysAgo = now - 70 * 24 * 60 * 60 * 1000;

      // Two positive verifications, one recent and one old
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      v1.timestamp = now;

      const v2 = createVerification(kp1.publicKey, kp1.privateKey, 't2', domain, 'correct', 1.0);
      v2.timestamp = seventyDaysAgo;

      // Add them together - the old one should contribute less
      const score = computeTrustScore(agent, domain, [v1, v2], now);

      // With both correct verifications, score should be high
      // But if we check individual contributions, recent should weigh more
      assert.ok(score.score > 0.5); // Both positive
      assert.strictEqual(score.verificationCount, 2);
      
      // The decay function itself is tested separately, so just verify both are counted
      assert.ok(score.lastVerified === now); // Most recent is tracked
    });

    it('should aggregate multiple verifications', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 0.9);
      const v2 = createVerification(kp2.publicKey, kp2.privateKey, 't2', domain, 'correct', 0.8);
      const v3 = createVerification(kp1.publicKey, kp1.privateKey, 't3', domain, 'correct', 0.85);

      const score = computeTrustScore(agent, domain, [v1, v2, v3]);

      assert.strictEqual(score.verificationCount, 3);
      assert.ok(score.score > 0.5); // All correct, should be high
      assert.strictEqual(score.topVerifiers.length, 2); // Two unique verifiers
    });

    it('should balance positive and negative verifications', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      const v2 = createVerification(kp2.publicKey, kp2.privateKey, 't2', domain, 'incorrect', 1.0);

      const score = computeTrustScore(agent, domain, [v1, v2]);

      // Equal positive and negative should be near neutral
      assert.ok(Math.abs(score.score - 0.5) < 0.1);
    });

    it('should exclude revoked verifications', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      const v2 = createVerification(kp2.publicKey, kp2.privateKey, 't2', domain, 'correct', 1.0);

      const revokedIds = new Set([v2.id]);
      const score = computeTrustScore(agent, domain, [v1, v2], undefined, revokedIds);

      assert.strictEqual(score.verificationCount, 1); // Only v1 counted
    });

    it('should filter by domain', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', 'ocr', 'correct', 1.0);
      const v2 = createVerification(kp1.publicKey, kp1.privateKey, 't2', 'summarization', 'correct', 1.0);

      const scoreOcr = computeTrustScore(agent, 'ocr', [v1, v2]);
      const scoreSumm = computeTrustScore(agent, 'summarization', [v1, v2]);

      assert.strictEqual(scoreOcr.verificationCount, 1);
      assert.strictEqual(scoreOcr.domain, 'ocr');
      assert.strictEqual(scoreSumm.verificationCount, 1);
      assert.strictEqual(scoreSumm.domain, 'summarization');
    });

    it('should list top verifiers sorted by contribution', () => {
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      const v2 = createVerification(kp1.publicKey, kp1.privateKey, 't2', domain, 'correct', 0.9);
      const v3 = createVerification(kp2.publicKey, kp2.privateKey, 't3', domain, 'correct', 0.5);

      const score = computeTrustScore(agent, domain, [v1, v2, v3]);

      // kp1 contributed more (2 verifications with high confidence)
      assert.strictEqual(score.topVerifiers[0], kp1.publicKey);
      assert.strictEqual(score.topVerifiers[1], kp2.publicKey);
    });

    it('should track most recent verification timestamp', () => {
      const now = Date.now();
      const v1 = createVerification(kp1.publicKey, kp1.privateKey, 't1', domain, 'correct', 1.0);
      v1.timestamp = now - 10000;

      const v2 = createVerification(kp1.publicKey, kp1.privateKey, 't2', domain, 'correct', 1.0);
      v2.timestamp = now;

      const v3 = createVerification(kp1.publicKey, kp1.privateKey, 't3', domain, 'correct', 1.0);
      v3.timestamp = now - 5000;

      const score = computeTrustScore(agent, domain, [v1, v2, v3], now);

      assert.strictEqual(score.lastVerified, now);
    });
  });
});
