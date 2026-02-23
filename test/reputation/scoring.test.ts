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

  describe('recursive trust scoring', () => {
    it('should use flat weighting (1.0) when no getVerifierScore is provided', () => {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      const flatScore = computeTrustScore(agent.publicKey, 'ocr', [verification], currentTime);
      const recursiveScore = computeTrustScore(agent.publicKey, 'ocr', [verification], currentTime, {});

      // Both should produce the same result
      assert.strictEqual(flatScore.score, recursiveScore.score);
    });

    it('should weight verifications by verifier trust score', () => {
      const highTrustVerifier = generateKeyPair();
      const lowTrustVerifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const v1 = createVerification(
        highTrustVerifier.publicKey,
        highTrustVerifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      const v2 = createVerification(
        lowTrustVerifier.publicKey,
        lowTrustVerifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      // Flat weighting (both verifiers count equally)
      const flatScore = computeTrustScore(agent.publicKey, 'ocr', [v1, v2], currentTime);

      // High-trust verifier gets 1.0, low-trust verifier gets 0.1
      const weightedScore = computeTrustScore(agent.publicKey, 'ocr', [v1, v2], currentTime, {
        getVerifierScore: (verifier) => {
          if (verifier === highTrustVerifier.publicKey) return 1.0;
          return 0.1;
        },
      });

      // Weighted score should differ from flat score
      assert.notStrictEqual(weightedScore.score, flatScore.score);
      // Both should still be in valid range
      assert.ok(weightedScore.score >= 0 && weightedScore.score <= 1);
    });

    it('should detect and break cycles (A verifies B, B verifies A)', () => {
      const agentA = generateKeyPair();
      const agentB = generateKeyPair();
      const currentTime = 1000000000;

      // A verifies B
      const vAtoB = createVerification(
        agentA.publicKey,
        agentA.privateKey,
        agentB.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      // B verifies A
      const vBtoA = createVerification(
        agentB.publicKey,
        agentB.privateKey,
        agentA.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      const allVerifications = [vAtoB, vBtoA];

      // Shared visitedAgents set for cycle detection
      const visitedAgents = new Set<string>();

      // Create recursive getVerifierScore that shares visitedAgents
      const getVerifierScore = (verifier: string, domain: string): number => {
        const score = computeTrustScore(verifier, domain, allVerifications, currentTime, {
          getVerifierScore,
          visitedAgents,
        });
        return score.verificationCount === 0 ? 0.5 : score.score;
      };

      // Should not throw / infinite loop
      const scoreA = computeTrustScore(agentA.publicKey, 'ocr', allVerifications, currentTime, {
        getVerifierScore,
        visitedAgents,
      });

      assert.ok(scoreA.score >= 0 && scoreA.score <= 1);
      assert.strictEqual(scoreA.verificationCount, 1);
    });

    it('should use neutral weight (0.5) for cycle participants', () => {
      const agentA = generateKeyPair();
      const agentB = generateKeyPair();
      const currentTime = 1000000000;

      // A verifies B, B verifies A (mutual verification cycle)
      const vAtoB = createVerification(
        agentA.publicKey,
        agentA.privateKey,
        agentB.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      const vBtoA = createVerification(
        agentB.publicKey,
        agentB.privateKey,
        agentA.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      const allVerifications = [vAtoB, vBtoA];
      const visitedAgents = new Set<string>();

      const getVerifierScore = (verifier: string, domain: string): number => {
        const score = computeTrustScore(verifier, domain, allVerifications, currentTime, {
          getVerifierScore,
          visitedAgents,
        });
        return score.verificationCount === 0 ? 0.5 : score.score;
      };

      const scoreA = computeTrustScore(agentA.publicKey, 'ocr', allVerifications, currentTime, {
        getVerifierScore,
        visitedAgents,
      });

      // When computing A's score, B is the verifier.
      // When computing B's score (for weight), A is already in visitedAgents → weight 0.5.
      // So B's score = normalized((1.0 * 1.0 * decay(0) * 0.5) / 1) = (0.5 + 1) / 2 = 0.75
      // Then A's score = normalized((1.0 * 1.0 * decay(0) * 0.75) / 1) = (0.75 + 1) / 2 = 0.875
      assert.ok(scoreA.score > 0.5 && scoreA.score <= 1.0);
    });

    it('should use flat weight (1.0) when maxDepth is 0', () => {
      const verifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      let getVerifierScoreCalled = false;
      const getVerifierScore = (_verifier: string, _domain: string): number => {
        getVerifierScoreCalled = true;
        return 0.1; // low trust — should not be used at depth 0
      };

      computeTrustScore(agent.publicKey, 'ocr', [verification], currentTime, {
        getVerifierScore,
        maxDepth: 0,
      });

      // getVerifierScore should NOT be called when maxDepth is 0
      assert.strictEqual(getVerifierScoreCalled, false);
    });

    it('should use bootstrapping weight (0.5) for verifiers with no score', () => {
      const newVerifier = generateKeyPair();
      const agent = generateKeyPair();
      const currentTime = 1000000000;

      const verification = createVerification(
        newVerifier.publicKey,
        newVerifier.privateKey,
        agent.publicKey,
        'ocr',
        'correct',
        1.0,
        currentTime
      );

      // getVerifierScore returns 0.5 for new agents with no track record
      const getVerifierScore = (_verifier: string, _domain: string): number => 0.5;

      const flatScore = computeTrustScore(agent.publicKey, 'ocr', [verification], currentTime);
      const weightedScore = computeTrustScore(agent.publicKey, 'ocr', [verification], currentTime, {
        getVerifierScore,
      });

      // Flat score: (1 + 1) / 2 = 1.0
      assert.strictEqual(flatScore.score, 1.0);
      // Weighted score with 0.5 verifier weight: ((1.0 * 1.0 * 1.0 * 0.5) + 1) / 2 = 0.75
      assert.ok(Math.abs(weightedScore.score - 0.75) < 0.001);
    });

    it('should handle deep recursion without stack overflow (depth limit)', () => {
      const keypairs = Array.from({ length: 5 }, () => generateKeyPair());
      const currentTime = 1000000000;

      // Create a chain: 0 verifies 1, 1 verifies 2, 2 verifies 3, 3 verifies 4
      const verifications = keypairs.slice(0, -1).map((kp, i) =>
        createVerification(
          kp.publicKey,
          kp.privateKey,
          keypairs[i + 1].publicKey,
          'ocr',
          'correct',
          1.0,
          currentTime
        )
      );

      const visitedAgents = new Set<string>();
      const getVerifierScore = (verifier: string, domain: string): number => {
        const score = computeTrustScore(verifier, domain, verifications, currentTime, {
          getVerifierScore,
          visitedAgents,
          maxDepth: 2, // low depth limit
        });
        return score.verificationCount === 0 ? 0.5 : score.score;
      };

      // Should complete without error
      const score = computeTrustScore(keypairs[4].publicKey, 'ocr', verifications, currentTime, {
        getVerifierScore,
        visitedAgents,
        maxDepth: 2,
      });

      assert.ok(score.score >= 0 && score.score <= 1);
    });
  });
});
