import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { decay, computeTrustScore, computeAllScores } from '../../src/reputation/scoring.js';
import type { VerificationRecord, RevocationRecord } from '../../src/reputation/types.js';

describe('Scoring', () => {
  describe('decay', () => {
    it('should return 1 for zero time delta', () => {
      const weight = decay(0);
      assert.strictEqual(weight, 1);
    });
    
    it('should return ~0.93 for 7 days', () => {
      const sevenDays = 7 * 24 * 60 * 60 * 1000; // 7 days in ms
      const weight = decay(sevenDays);
      assert.ok(weight > 0.92 && weight < 0.94);
    });
    
    it('should return ~0.5 for 70 days (half-life)', () => {
      const seventyDays = 70 * 24 * 60 * 60 * 1000; // 70 days in ms
      const weight = decay(seventyDays);
      assert.ok(weight > 0.49 && weight < 0.51);
    });
    
    it('should return ~0.025 for 1 year', () => {
      const oneYear = 365 * 24 * 60 * 60 * 1000; // 1 year in ms
      const weight = decay(oneYear);
      assert.ok(weight > 0.02 && weight < 0.03);
    });
    
    it('should decrease monotonically', () => {
      const w1 = decay(1000);
      const w2 = decay(2000);
      const w3 = decay(3000);
      
      assert.ok(w1 > w2);
      assert.ok(w2 > w3);
    });
  });
  
  describe('computeTrustScore', () => {
    it('should return null for agent with no verifications', () => {
      const agent = generateKeyPair();
      const verifications: VerificationRecord[] = [];
      
      const score = computeTrustScore(agent.publicKey, 'ocr', verifications);
      assert.strictEqual(score, null);
    });
    
    it('should compute score for agent with one correct verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        1.0,
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        [],
        verification.timestamp, // No time decay
      );
      
      assert.ok(score !== null);
      assert.strictEqual(score.agent, agent.publicKey);
      assert.strictEqual(score.domain, 'ocr');
      assert.strictEqual(score.verificationCount, 1);
      // Score should be 1.0 (perfect correct verification, no decay)
      assert.ok(score.score === 1.0);
    });
    
    it('should compute score for agent with one incorrect verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'incorrect',
        1.0,
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        [],
        verification.timestamp,
      );
      
      assert.ok(score !== null);
      // Score should be 0.0 (perfect incorrect verification)
      assert.strictEqual(score.score, 0.0);
    });
    
    it('should compute score for agent with disputed verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'disputed',
        1.0,
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        [],
        verification.timestamp,
      );
      
      assert.ok(score !== null);
      // Score should be 0.5 (disputed = neutral)
      assert.strictEqual(score.score, 0.5);
    });
    
    it('should compute average score for multiple verifications', () => {
      const agent = generateKeyPair();
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-1',
        'ocr',
        'correct',
        1.0,
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        'target-2',
        'ocr',
        'incorrect',
        1.0,
      );
      
      const currentTime = Math.max(v1.timestamp, v2.timestamp);
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [v1, v2],
        [],
        currentTime,
      );
      
      assert.ok(score !== null);
      assert.strictEqual(score.verificationCount, 2);
      // Average of correct (1.0) and incorrect (0.0) = 0.5
      // Allow for small floating point differences
      assert.ok(Math.abs(score.score - 0.5) < 0.001);
    });
    
    it('should apply time decay to old verifications', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        1.0,
      );
      
      // Compute score 70 days later (half-life)
      const seventyDaysLater = verification.timestamp + (70 * 24 * 60 * 60 * 1000);
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        [],
        seventyDaysLater,
      );
      
      assert.ok(score !== null);
      // Score should be less than 1.0 due to decay (around 0.75 after transformation)
      assert.ok(score.score < 1.0);
      assert.ok(score.score > 0.7); // Should still be relatively high
    });
    
    it('should weight verifications by confidence', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const lowConfidence = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-1',
        'ocr',
        'correct',
        0.1, // Low confidence
      );
      
      const highConfidence = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-2',
        'ocr',
        'correct',
        1.0, // High confidence
      );
      
      const currentTime = Math.max(lowConfidence.timestamp, highConfidence.timestamp);
      
      const scoreLow = computeTrustScore(
        agent.publicKey,
        'ocr',
        [lowConfidence],
        [],
        currentTime,
      );
      
      const scoreHigh = computeTrustScore(
        agent.publicKey,
        'ocr',
        [highConfidence],
        [],
        currentTime,
      );
      
      assert.ok(scoreLow !== null && scoreHigh !== null);
      // High confidence should result in higher score
      assert.ok(scoreHigh.score > scoreLow.score);
    });
    
    it('should filter verifications by domain', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const ocrVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-1',
        'ocr',
        'correct',
        1.0,
      );
      
      const codeReviewVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-2',
        'code_review',
        'correct',
        1.0,
      );
      
      const currentTime = Date.now();
      
      const ocrScore = computeTrustScore(
        agent.publicKey,
        'ocr',
        [ocrVerification, codeReviewVerification],
        [],
        currentTime,
      );
      
      assert.ok(ocrScore !== null);
      // Only OCR verification should be counted
      assert.strictEqual(ocrScore.verificationCount, 1);
      assert.strictEqual(ocrScore.domain, 'ocr');
    });
    
    it('should exclude revoked verifications', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        1.0,
      );
      
      const revocation: RevocationRecord = {
        id: 'revocation-123',
        verifier: verifier.publicKey,
        verificationId: verification.id,
        reason: 'discovered_error',
        timestamp: Date.now(),
        signature: 'sig',
      };
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        [revocation],
        Date.now(),
      );
      
      // Should return null because only verification is revoked
      assert.strictEqual(score, null);
    });
    
    it('should track top verifiers', () => {
      const agent = generateKeyPair();
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      const verifier3 = generateKeyPair();
      
      // verifier1 makes 3 verifications
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-1',
        'ocr',
        'correct',
        1.0,
      );
      const v2 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-2',
        'ocr',
        'correct',
        1.0,
      );
      const v3 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-3',
        'ocr',
        'correct',
        1.0,
      );
      
      // verifier2 makes 1 verification
      const v4 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        'target-4',
        'ocr',
        'correct',
        1.0,
      );
      
      const currentTime = Date.now();
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [v1, v2, v3, v4],
        [],
        currentTime,
      );
      
      assert.ok(score !== null);
      // verifier1 should be first (most verifications)
      assert.strictEqual(score.topVerifiers[0], verifier1.publicKey);
    });
  });
  
  describe('computeAllScores', () => {
    it('should compute scores for multiple domains', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const ocrVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-1',
        'ocr',
        'correct',
        1.0,
      );
      
      const codeReviewVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-2',
        'code_review',
        'correct',
        1.0,
      );
      
      const scores = computeAllScores(
        agent.publicKey,
        [ocrVerification, codeReviewVerification],
        [],
        Date.now(),
      );
      
      assert.strictEqual(scores.size, 2);
      assert.ok(scores.has('ocr'));
      assert.ok(scores.has('code_review'));
    });
    
    it('should return empty map for agent with no verifications', () => {
      const agent = generateKeyPair();
      const scores = computeAllScores(agent.publicKey, [], [], Date.now());
      
      assert.strictEqual(scores.size, 0);
    });
  });
});
