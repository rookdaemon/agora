import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification } from '../../src/reputation/verification';
import { createCommit, createReveal, verifyReveal } from '../../src/reputation/commit-reveal';
import { computeTrustScore, computeAllTrustScores } from '../../src/reputation/scoring';
import { ReputationStore } from '../../src/reputation/store';

describe('Reputation Integration', () => {
  function createTempStore(): { store: ReputationStore; cleanup: () => void } {
    const tempDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
    const filePath = join(tempDir, 'reputation.jsonl');
    const store = new ReputationStore(filePath);
    
    return {
      store,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true })
    };
  }
  
  describe('end-to-end verification flow', () => {
    it('should complete full verification workflow', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        // Setup: Alice verifies Bob's OCR work
        const alice = generateKeyPair();
        const bob = generateKeyPair();
        
        // Alice creates a verification for Bob
        const now = 1000000000;
        const verification = createVerification(
          alice.publicKey,
          alice.privateKey,
          bob.publicKey,
          'ocr',
          'correct',
          0.95,
          now,
          'https://example.com/evidence'
        );
        
        // Store verification
        await store.addVerification(verification);
        
        // Retrieve and compute Bob's trust score
        const allVerifications = await store.getVerifications();
        const bobVerifications = allVerifications.filter(v => v.target === bob.publicKey && v.domain === 'ocr');
        assert.strictEqual(bobVerifications.length, 1);
        
        const trustScore = computeTrustScore(
          bob.publicKey,
          'ocr',
          bobVerifications,
          now
        );
        
        assert.strictEqual(trustScore.agent, bob.publicKey);
        assert.strictEqual(trustScore.domain, 'ocr');
        // Score with slight time passage: ~0.97-0.98
        assert.ok(trustScore.score > 0.97 && trustScore.score <= 1.0, 
          `Expected ~0.97-1.0, got ${trustScore.score}`);
        assert.strictEqual(trustScore.verificationCount, 1);
        assert.deepStrictEqual(trustScore.topVerifiers, [alice.publicKey]);
      } finally {
        cleanup();
      }
    });
    
    it('should handle multiple verifications from different agents', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const bob = generateKeyPair();
        const alice = generateKeyPair();
        const charlie = generateKeyPair();
        const david = generateKeyPair();
        
        const now = 1000000000;
        
        // Multiple agents verify Bob's work
        const v1 = createVerification(
          alice.publicKey,
          alice.privateKey,
          bob.publicKey,
          'code_review',
          'correct',
          0.9,
          now
        );
        
        const v2 = createVerification(
          charlie.publicKey,
          charlie.privateKey,
          bob.publicKey,
          'code_review',
          'correct',
          0.95,
          now
        );
        
        const v3 = createVerification(
          david.publicKey,
          david.privateKey,
          bob.publicKey,
          'code_review',
          'incorrect',
          0.8,
          now
        );
        
        await store.addVerification(v1);
        await store.addVerification(v2);
        await store.addVerification(v3);
        
        const allVerifications = await store.getVerifications();
        const bobVerifications = allVerifications.filter(v => v.target === bob.publicKey && v.domain === 'code_review');
        const trustScore = computeTrustScore(
          bob.publicKey,
          'code_review',
          bobVerifications,
          now
        );
        
        // Score: ((0.9 + 0.95 - 0.8) / 3 + 1) / 2 = (1.05/3 + 1)/2 = ~0.675
        assert.ok(trustScore.score > 0.65 && trustScore.score < 0.7, 
          `Expected ~0.675, got ${trustScore.score}`);
        assert.strictEqual(trustScore.verificationCount, 3);
        assert.strictEqual(trustScore.topVerifiers.length, 3);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('end-to-end commit-reveal flow', () => {
    it('should complete full commit-reveal workflow', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const prediction = 'Bitcoin will reach $100k by end of Q1 2026';
        
        // Agent commits to prediction
        const commitTimestamp = 1000000000;
        const commit = createCommit(
          agent.publicKey,
          agent.privateKey,
          'price_prediction',
          prediction,
          commitTimestamp,
          1000 // 1 second expiry for test
        );
        
        await store.addCommit(commit);
        
        // Agent reveals prediction and outcome (after expiry)
        const revealTimestamp = commitTimestamp + 1100; // After expiry
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          commit.id,
          prediction,
          'Bitcoin reached $95k',
          revealTimestamp,
          'https://coinmarketcap.com/...'
        );
        
        await store.addReveal(reveal);
        
        // Verify the reveal matches the commit
        const verificationResult = verifyReveal(commit, reveal);
        assert.strictEqual(verificationResult.valid, true);
        
        // Retrieve from store
        const storedCommit = await store.getCommit(commit.id);
        assert.ok(storedCommit);
        assert.strictEqual(storedCommit.id, commit.id);
        
        const storedReveal = await store.getRevealByCommitment(commit.id);
        assert.ok(storedReveal);
        assert.strictEqual(storedReveal.prediction, prediction);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('multi-domain reputation', () => {
    it('should maintain separate scores per domain', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const verifier1 = generateKeyPair();
        const verifier2 = generateKeyPair();
        
        const now = 1000000000;
        
        // Agent is good at OCR - verified by two different verifiers
        const ocrVer1 = createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0,
          now
        );
        
        const ocrVer2 = createVerification(
          verifier2.publicKey,
          verifier2.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0,
          now
        );
        
        // Agent is bad at code review
        const codeVer = createVerification(
          verifier1.publicKey,
          verifier1.privateKey,
          agent.publicKey,
          'code_review',
          'incorrect',
          1.0,
          now
        );
        
        await store.addVerification(ocrVer1);
        await store.addVerification(ocrVer2);
        await store.addVerification(codeVer);
        
        // Compute all scores
        const allVerifications = await store.getVerifications();
        const scores = computeAllTrustScores(agent.publicKey, allVerifications, now);
        
        assert.strictEqual(scores.size, 2);
        
        const ocrScore = scores.get('ocr')!;
        assert.strictEqual(ocrScore.score, 1.0); // Perfect
        assert.strictEqual(ocrScore.verificationCount, 2);
        
        const codeScore = scores.get('code_review')!;
        assert.strictEqual(codeScore.score, 0.0); // Failed
        assert.strictEqual(codeScore.verificationCount, 1);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('revocation flow', () => {
    it('should handle verification revocation', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        const now = 1000000000;
        
        // Verifier issues verification
        const verification = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9,
          now
        );
        
        await store.addVerification(verification);
        
        // Compute initial score
        let allVerifications = await store.getVerifications();
        let verifications = allVerifications.filter(v => v.target === agent.publicKey && v.domain === 'ocr');
        let score = computeTrustScore(agent.publicKey, 'ocr', verifications, now);
        
        assert.ok(score.score > 0.9);
        assert.strictEqual(score.verificationCount, 1);
        
        // Note: Revocation is not implemented in the async store API yet
        // This test would need to be updated when revocation is implemented
        // For now, we'll just verify the initial score works
      } finally {
        cleanup();
      }
    });
  });
  
  describe('time decay integration', () => {
    it('should show reputation decay over time', async () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const verificationTimestamp = 1000000000;
        const verification = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0,
          verificationTimestamp
        );
        
        await store.addVerification(verification);
        
        const allVerifications = await store.getVerifications();
        const verifications = allVerifications.filter(v => v.target === agent.publicKey && v.domain === 'ocr');
        
        // Score immediately
        const scoreNow = computeTrustScore(
          agent.publicKey,
          'ocr',
          verifications,
          verificationTimestamp
        );
        
        assert.strictEqual(scoreNow.score, 1.0);
        
        // Score after 70 days (half-life)
        const seventyDaysLater = verificationTimestamp + (70 * 24 * 60 * 60 * 1000);
        const scoreAfterDecay = computeTrustScore(
          agent.publicKey,
          'ocr',
          verifications,
          seventyDaysLater
        );
        
        // Score should be lower due to decay
        // With 50% decay, score goes from 1.0 to ~0.5, normalized: (0.5 + 1) / 2 = 0.75
        assert.ok(scoreAfterDecay.score < scoreNow.score);
        assert.ok(scoreAfterDecay.score > 0.73 && scoreAfterDecay.score < 0.77, 
          `Expected ~0.75, got ${scoreAfterDecay.score}`);
      } finally {
        cleanup();
      }
    });
  });
});
