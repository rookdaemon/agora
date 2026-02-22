/**
 * Tests for trust score computation with decay
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification } from '../../src/reputation/verification';
import { decay, computeTrustScore, computeTrustScores } from '../../src/reputation/scoring';

describe('Scoring', () => {
  describe('decay', () => {
    it('should return 1.0 for zero time delta', () => {
      const weight = decay(0);
      assert.strictEqual(weight, 1.0);
    });

    it('should return value between 0 and 1 for positive time', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const weight = decay(oneDay);
      
      assert.ok(weight > 0);
      assert.ok(weight < 1);
      assert.ok(weight > 0.9); // Should be ~0.93 for 7 days with default lambda
    });

    it('should decay more for longer time periods', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const weight1Day = decay(oneDay);
      const weight7Days = decay(7 * oneDay);
      const weight70Days = decay(70 * oneDay);
      
      assert.ok(weight1Day > weight7Days);
      assert.ok(weight7Days > weight70Days);
      assert.ok(weight70Days > 0.4 && weight70Days < 0.6); // Should be ~0.5 at 70 days
    });
  });

  describe('computeTrustScore', () => {
    it('should return zero score for empty verifications', () => {
      const score = computeTrustScore('agent123', 'ocr', [], 1000000000);
      
      assert.strictEqual(score.agent, 'agent123');
      assert.strictEqual(score.domain, 'ocr');
      assert.strictEqual(score.score, 0);
      assert.strictEqual(score.verificationCount, 0);
      assert.strictEqual(score.lastVerified, 0);
      assert.strictEqual(score.topVerifiers.length, 0);
    });

    it('should compute score from single correct verification', () => {
      const verifierKeypair = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const verification = createVerification(
        verifierKeypair.publicKey,
        verifierKeypair.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );
      
      const score = computeTrustScore(agentKeypair.publicKey, 'ocr', [verification], currentTime);
      
      assert.strictEqual(score.verificationCount, 1);
      assert.ok(score.score > 0.5); // Correct verification should push score above 0.5
      assert.strictEqual(score.lastVerified, verification.timestamp);
      assert.strictEqual(score.topVerifiers.length, 1);
      assert.strictEqual(score.topVerifiers[0], verifierKeypair.publicKey);
    });

    it('should compute higher score for multiple correct verifications', () => {
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        0.9,
        currentTime
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        0.95,
        currentTime
      );
      
      const score = computeTrustScore(agentKeypair.publicKey, 'ocr', [v1, v2], currentTime);
      
      assert.strictEqual(score.verificationCount, 2);
      assert.ok(score.score > 0.5);
      assert.strictEqual(score.topVerifiers.length, 2);
    });

    it('should compute lower score for incorrect verifications', () => {
      const verifierKeypair = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const verification = createVerification(
        verifierKeypair.publicKey,
        verifierKeypair.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'incorrect',
        1.0,
        currentTime
      );
      
      const score = computeTrustScore(agentKeypair.publicKey, 'ocr', [verification], currentTime);
      
      assert.ok(score.score < 0.5); // Incorrect verification should push score below 0.5
    });

    it('should handle mixed verdicts', () => {
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      const verifier3 = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const correct = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );
      
      const incorrect = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'incorrect',
        1.0,
        currentTime
      );
      
      const disputed = createVerification(
        verifier3.publicKey,
        verifier3.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'disputed',
        0.5,
        currentTime
      );
      
      const score = computeTrustScore(agentKeypair.publicKey, 'ocr', [correct, incorrect, disputed], currentTime);
      
      assert.strictEqual(score.verificationCount, 3);
      assert.ok(score.score >= 0 && score.score <= 1);
    });

    it('should filter by domain', () => {
      const verifier = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const ocrVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );
      
      const summaryVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'summarization',
        'correct',
        1.0,
        currentTime
      );
      
      // Should only count OCR verification
      const ocrScore = computeTrustScore(agentKeypair.publicKey, 'ocr', [ocrVerification, summaryVerification], currentTime);
      assert.strictEqual(ocrScore.verificationCount, 1);
      
      // Should only count summarization verification
      const summaryScore = computeTrustScore(agentKeypair.publicKey, 'summarization', [ocrVerification, summaryVerification], currentTime);
      assert.strictEqual(summaryScore.verificationCount, 1);
    });

    it('should apply time decay to old verifications', () => {
      const verifier = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      const oldTime = currentTime - (70 * 24 * 60 * 60 * 1000); // 70 days ago
      
      const oldVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        oldTime
      );
      
      const recentVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );
      
      const scoreWithOld = computeTrustScore(agentKeypair.publicKey, 'ocr', [oldVerification], currentTime);
      const scoreWithRecent = computeTrustScore(agentKeypair.publicKey, 'ocr', [recentVerification], currentTime);
      
      // Recent verification should have higher score due to less decay
      assert.ok(scoreWithRecent.score > scoreWithOld.score);
    });
  });

  describe('computeTrustScores', () => {
    it('should compute scores across multiple domains', () => {
      const verifier = generateKeyPair();
      const agentKeypair = generateKeyPair();
      const currentTime = 1000000000;
      
      const ocrVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );
      
      const summaryVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agentKeypair.publicKey,
        'summarization',
        'correct',
        0.9,
        currentTime
      );
      
      const scores = computeTrustScores(agentKeypair.publicKey, [ocrVerification, summaryVerification], currentTime);
      
      assert.strictEqual(scores.size, 2);
      assert.ok(scores.has('ocr'));
      assert.ok(scores.has('summarization'));
      
      const ocrScore = scores.get('ocr');
      assert.ok(ocrScore);
      assert.strictEqual(ocrScore.domain, 'ocr');
      
      const summaryScore = scores.get('summarization');
      assert.ok(summaryScore);
      assert.strictEqual(summaryScore.domain, 'summarization');
    });

    it('should return empty map for no verifications', () => {
      const scores = computeTrustScores('agent123', [], 1000000000);
      assert.strictEqual(scores.size, 0);
    });
  });
});
