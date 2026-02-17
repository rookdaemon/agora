import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { decay, computeTrustScore, computeAllTrustScores } from '../../src/reputation/scoring.js';

describe('Scoring', () => {
  describe('decay', () => {
    it('should return 1 for zero time delta', () => {
      const result = decay(0);
      assert.strictEqual(result, 1);
    });
    
    it('should return value close to 0.93 for 7 days', () => {
      const sevenDays = 7 * 24 * 60 * 60 * 1000;
      const result = decay(sevenDays);
      assert.ok(result > 0.92 && result < 0.94, `Expected ~0.93, got ${result}`);
    });
    
    it('should return value close to 0.5 for 70 days (half-life)', () => {
      const seventyDays = 70 * 24 * 60 * 60 * 1000;
      const result = decay(seventyDays);
      assert.ok(result > 0.48 && result < 0.52, `Expected ~0.50, got ${result}`);
    });
    
    it('should return value close to 0.025 for 1 year', () => {
      const oneYear = 365 * 24 * 60 * 60 * 1000;
      const result = decay(oneYear);
      assert.ok(result > 0.01 && result < 0.05, `Expected ~0.025, got ${result}`);
    });
    
    it('should decay monotonically', () => {
      const results = [0, 1, 7, 30, 70, 365].map(days => 
        decay(days * 24 * 60 * 60 * 1000)
      );
      
      for (let i = 1; i < results.length; i++) {
        assert.ok(results[i] < results[i - 1], 
          `Decay not monotonic: ${results[i]} >= ${results[i - 1]}`);
      }
    });
  });
  
  describe('computeTrustScore', () => {
    it('should return zero score for no verifications', () => {
      const agent = generateKeyPair();
      const score = computeTrustScore(agent.publicKey, 'ocr', []);
      
      assert.strictEqual(score.agent, agent.publicKey);
      assert.strictEqual(score.domain, 'ocr');
      assert.strictEqual(score.score, 0);
      assert.strictEqual(score.verificationCount, 0);
      assert.strictEqual(score.lastVerified, 0);
      assert.deepStrictEqual(score.topVerifiers, []);
    });
    
    it('should compute score for single correct verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        verification.timestamp // No decay
      );
      
      // Score formula: (verdict * confidence * decay) / count
      // = (1 * 1.0 * 1.0) / 1 = 1.0
      // Normalized to [0,1]: (1 + 1) / 2 = 1.0
      assert.strictEqual(score.score, 1.0);
      assert.strictEqual(score.verificationCount, 1);
      assert.strictEqual(score.lastVerified, verification.timestamp);
      assert.deepStrictEqual(score.topVerifiers, [verifier.publicKey]);
    });
    
    it('should compute score for single incorrect verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'incorrect',
        1.0
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        verification.timestamp
      );
      
      // Score: (-1 * 1.0 * 1.0) / 1 = -1.0
      // Normalized: (-1 + 1) / 2 = 0.0
      assert.strictEqual(score.score, 0.0);
      assert.strictEqual(score.verificationCount, 1);
    });
    
    it('should compute score for disputed verification', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'disputed',
        1.0
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        verification.timestamp
      );
      
      // Score: (0 * 1.0 * 1.0) / 1 = 0.0
      // Normalized: (0 + 1) / 2 = 0.5
      assert.strictEqual(score.score, 0.5);
      assert.strictEqual(score.verificationCount, 1);
    });
    
    it('should average multiple verifications', () => {
      const agent = generateKeyPair();
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const now = Date.now();
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      v1.timestamp = now;
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      v2.timestamp = now;
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [v1, v2],
        now
      );
      
      // Average: (1 + 1) / 2 = 1.0
      // Normalized: (1 + 1) / 2 = 1.0
      assert.strictEqual(score.score, 1.0);
      assert.strictEqual(score.verificationCount, 2);
      assert.strictEqual(score.topVerifiers.length, 2);
    });
    
    it('should apply time decay', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      
      // Compute score 70 days later (half-life)
      const seventyDaysLater = verification.timestamp + (70 * 24 * 60 * 60 * 1000);
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        seventyDaysLater
      );
      
      // Score with decay: (1 * 1.0 * ~0.5) / 1 = ~0.5
      // Normalized: (~0.5 + 1) / 2 = ~0.75
      assert.ok(score.score > 0.7 && score.score < 0.8, 
        `Expected ~0.75, got ${score.score}`);
    });
    
    it('should weight by confidence', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        0.5 // Half confidence
      );
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        [verification],
        verification.timestamp
      );
      
      // Score: (1 * 0.5 * 1.0) / 1 = 0.5
      // Normalized: (0.5 + 1) / 2 = 0.75
      assert.strictEqual(score.score, 0.75);
    });
    
    it('should filter by domain', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const ocrVer = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      
      const codeVer = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'code_review',
        'correct',
        1.0
      );
      
      const ocrScore = computeTrustScore(
        agent.publicKey,
        'ocr',
        [ocrVer, codeVer]
      );
      
      assert.strictEqual(ocrScore.verificationCount, 1);
      assert.strictEqual(ocrScore.domain, 'ocr');
    });
    
    it('should track top verifiers', () => {
      const agent = generateKeyPair();
      const verifiers = [
        generateKeyPair(),
        generateKeyPair(),
        generateKeyPair(),
      ];
      
      const now = Date.now();
      const verifications = verifiers.map(v => {
        const ver = createVerification(
          v.publicKey,
          v.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0
        );
        ver.timestamp = now;
        return ver;
      });
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        verifications,
        now
      );
      
      assert.strictEqual(score.topVerifiers.length, 3);
      assert.ok(score.topVerifiers.includes(verifiers[0].publicKey));
      assert.ok(score.topVerifiers.includes(verifiers[1].publicKey));
      assert.ok(score.topVerifiers.includes(verifiers[2].publicKey));
    });
    
    it('should limit top verifiers to 5', () => {
      const agent = generateKeyPair();
      const verifiers = Array.from({ length: 10 }, () => generateKeyPair());
      
      const now = Date.now();
      const verifications = verifiers.map(v => {
        const ver = createVerification(
          v.publicKey,
          v.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0
        );
        ver.timestamp = now;
        return ver;
      });
      
      const score = computeTrustScore(
        agent.publicKey,
        'ocr',
        verifications,
        now
      );
      
      assert.strictEqual(score.topVerifiers.length, 5);
    });
  });
  
  describe('computeAllTrustScores', () => {
    it('should compute scores for multiple domains', () => {
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const now = Date.now();
      
      const ocrVer = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0
      );
      ocrVer.timestamp = now;
      
      const codeVer = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'code_review',
        'correct',
        1.0
      );
      codeVer.timestamp = now;
      
      const scores = computeAllTrustScores(
        agent.publicKey,
        [ocrVer, codeVer],
        now
      );
      
      assert.strictEqual(scores.size, 2);
      assert.ok(scores.has('ocr'));
      assert.ok(scores.has('code_review'));
      
      const ocrScore = scores.get('ocr')!;
      assert.strictEqual(ocrScore.score, 1.0);
      assert.strictEqual(ocrScore.verificationCount, 1);
      
      const codeScore = scores.get('code_review')!;
      assert.strictEqual(codeScore.score, 1.0);
      assert.strictEqual(codeScore.verificationCount, 1);
    });
    
    it('should return empty map for no verifications', () => {
      const agent = generateKeyPair();
      const scores = computeAllTrustScores(agent.publicKey, []);
      
      assert.strictEqual(scores.size, 0);
    });
    
    it('should filter by agent', () => {
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      const verifier = generateKeyPair();
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent1.publicKey,
        'ocr',
        'correct',
        1.0
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent2.publicKey,
        'ocr',
        'correct',
        1.0
      );
      
      const scores = computeAllTrustScores(agent1.publicKey, [v1, v2]);
      
      assert.strictEqual(scores.size, 1);
      assert.ok(scores.has('ocr'));
      assert.strictEqual(scores.get('ocr')!.agent, agent1.publicKey);
    });
  });
});
