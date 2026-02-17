import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import {
  decay,
  computeTrustScore,
  computeTrustScoresByDomain,
} from '../../src/reputation/scoring.js';

describe('Scoring', () => {
  describe('decay', () => {
    it('should return 1.0 for zero time delta', () => {
      const weight = decay(0);
      assert.strictEqual(weight, 1.0);
    });
    
    it('should return values between 0 and 1', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const weight1 = decay(oneDay);
      const weight7 = decay(7 * oneDay);
      const weight70 = decay(70 * oneDay);
      
      assert.ok(weight1 > 0 && weight1 < 1);
      assert.ok(weight7 > 0 && weight7 < 1);
      assert.ok(weight70 > 0 && weight70 < 1);
    });
    
    it('should decay exponentially over time', () => {
      const oneDay = 24 * 60 * 60 * 1000;
      const weight1 = decay(oneDay);
      const weight7 = decay(7 * oneDay);
      const weight70 = decay(70 * oneDay);
      
      // Older verifications should have lower weight
      assert.ok(weight1 > weight7);
      assert.ok(weight7 > weight70);
    });
    
    it('should have ~50% weight at 70 days (half-life)', () => {
      const seventyDays = 70 * 24 * 60 * 60 * 1000;
      const weight = decay(seventyDays);
      
      // Should be approximately 0.5 (within 10% tolerance)
      assert.ok(weight > 0.45 && weight < 0.55);
    });
    
    it('should handle future timestamps', () => {
      // Future timestamps should have full weight
      const weight = decay(-1000);
      assert.strictEqual(weight, 1.0);
    });
  });
  
  describe('computeTrustScore', () => {
    it('should return zero score for no verifications', () => {
      const agent = 'agent-pubkey';
      const domain = 'code_review';
      const verifications: never[] = [];
      
      const score = computeTrustScore(agent, domain, verifications);
      
      assert.strictEqual(score.agent, agent);
      assert.strictEqual(score.domain, domain);
      assert.strictEqual(score.score, 0);
      assert.strictEqual(score.verificationCount, 0);
      assert.strictEqual(score.lastVerified, 0);
      assert.strictEqual(score.topVerifiers.length, 0);
    });
    
    it('should compute positive score for correct verifications', () => {
      const agent = 'agent-pubkey';
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent,
          'code_review',
          'correct',
          0.9
        ),
        createVerification(
          verifier2.publicKey,
          verifier2.privateKey,
          agent,
          'code_review',
          'correct',
          0.95
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      assert.ok(score.score > 0);
      assert.ok(score.score <= 1);
      assert.strictEqual(score.verificationCount, 2);
      assert.ok(score.lastVerified > 0);
      assert.strictEqual(score.topVerifiers.length, 2);
    });
    
    it('should compute negative score for incorrect verifications', () => {
      const agent = 'agent-pubkey';
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent,
          'code_review',
          'incorrect',
          0.9
        ),
        createVerification(
          verifier2.publicKey,
          verifier2.privateKey,
          agent,
          'code_review',
          'incorrect',
          0.95
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      // Score should be clamped to 0 (negative values become 0)
      assert.strictEqual(score.score, 0);
      assert.strictEqual(score.verificationCount, 2);
    });
    
    it('should handle mixed verdicts', () => {
      const agent = 'agent-pubkey';
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      const verifier3 = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent,
          'code_review',
          'correct',
          1.0
        ),
        createVerification(
          verifier2.publicKey,
          verifier2.privateKey,
          agent,
          'code_review',
          'correct',
          1.0
        ),
        createVerification(
          verifier3.publicKey,
          verifier3.privateKey,
          agent,
          'code_review',
          'incorrect',
          1.0
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      // Should be positive but less than 1.0
      assert.ok(score.score > 0);
      assert.ok(score.score < 1);
      assert.strictEqual(score.verificationCount, 3);
    });
    
    it('should give zero weight to disputed verifications', () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'code_review',
          'disputed',
          1.0
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      // Disputed should contribute zero
      assert.strictEqual(score.score, 0);
    });
    
    it('should respect confidence values', () => {
      const agent = 'agent-pubkey';
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const highConfidence = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      
      const lowConfidence = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        agent,
        'code_review',
        'correct',
        0.1
      );
      
      const score = computeTrustScore(agent, 'code_review', [highConfidence, lowConfidence]);
      
      // Should be positive but affected by low confidence
      assert.ok(score.score > 0);
      assert.ok(score.score < 1);
    });
    
    it('should apply time decay', () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      const currentTime = Date.now();
      
      // Create old verification (70 days ago)
      const oldVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      oldVerification.timestamp = currentTime - (70 * 24 * 60 * 60 * 1000);
      
      const scoreOld = computeTrustScore(agent, 'code_review', [oldVerification], currentTime);
      
      // Create recent verification
      const recentVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      recentVerification.timestamp = currentTime - (1 * 24 * 60 * 60 * 1000);
      
      const scoreRecent = computeTrustScore(agent, 'code_review', [recentVerification], currentTime);
      
      // Recent score should be higher
      assert.ok(scoreRecent.score > scoreOld.score);
    });
    
    it('should filter by domain', () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'code_review',
          'correct',
          1.0
        ),
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'ocr',
          'correct',
          1.0
        ),
      ];
      
      const codeReviewScore = computeTrustScore(agent, 'code_review', verifications);
      const ocrScore = computeTrustScore(agent, 'ocr', verifications);
      
      // Each domain should only count its own verifications
      assert.strictEqual(codeReviewScore.verificationCount, 1);
      assert.strictEqual(ocrScore.verificationCount, 1);
    });
    
    it('should track top verifiers', () => {
      const agent = 'agent-pubkey';
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      const verifier3 = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent,
          'code_review',
          'correct',
          1.0
        ),
        createVerification(
          verifier2.publicKey,
          verifier2.privateKey,
          agent,
          'code_review',
          'correct',
          0.8
        ),
        createVerification(
          verifier3.publicKey,
          verifier3.privateKey,
          agent,
          'code_review',
          'correct',
          0.5
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      assert.strictEqual(score.topVerifiers.length, 3);
      // First verifier should be highest contributor
      assert.strictEqual(score.topVerifiers[0], verifier1.publicKey);
    });
    
    it('should clamp score to [0, 1] range', () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      
      // All incorrect verifications
      const verifications = [
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'code_review',
          'incorrect',
          1.0
        ),
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'code_review',
          'incorrect',
          1.0
        ),
      ];
      
      const score = computeTrustScore(agent, 'code_review', verifications);
      
      // Should be clamped to 0
      assert.strictEqual(score.score, 0);
    });
  });
  
  describe('computeTrustScoresByDomain', () => {
    it('should compute scores for multiple domains', () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      
      const verifications = [
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'code_review',
          'correct',
          1.0
        ),
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'ocr',
          'correct',
          0.9
        ),
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent,
          'translation',
          'correct',
          0.8
        ),
      ];
      
      const scores = computeTrustScoresByDomain(agent, verifications);
      
      assert.strictEqual(scores.size, 3);
      assert.ok(scores.has('code_review'));
      assert.ok(scores.has('ocr'));
      assert.ok(scores.has('translation'));
    });
    
    it('should return empty map for no verifications', () => {
      const agent = 'agent-pubkey';
      const verifications: never[] = [];
      
      const scores = computeTrustScoresByDomain(agent, verifications);
      
      assert.strictEqual(scores.size, 0);
    });
  });
});
