import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification, validateVerification } from '../../src/reputation/verification.js';
import { createCommit, createReveal, verifyReveal } from '../../src/reputation/commit-reveal.js';
import { computeTrustScore, computeAllTrustScores } from '../../src/reputation/scoring.js';
import { ReputationStore } from '../../src/reputation/store.js';

describe('Reputation Integration', () => {
  function createTempStore(): { store: ReputationStore; cleanup: () => void } {
    const tempDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
    const filePath = join(tempDir, 'reputation.jsonl');
    const store = new ReputationStore({ filePath });
    
    return {
      store,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true })
    };
  }
  
  describe('end-to-end verification flow', () => {
    it('should complete full verification workflow', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        // Setup: Alice verifies Bob's OCR work
        const alice = generateKeyPair();
        const bob = generateKeyPair();
        
        // Alice creates a verification for Bob
        const verification = createVerification(
          alice.publicKey,
          alice.privateKey,
          bob.publicKey,
          'ocr',
          'correct',
          0.95,
          'https://example.com/evidence'
        );
        
        // Validate verification
        const validationResult = validateVerification(verification);
        assert.strictEqual(validationResult.valid, true);
        
        // Store verification
        store.append({ type: 'verification', data: verification });
        
        // Retrieve and compute Bob's trust score
        const bobVerifications = store.getVerificationsForAgent(bob.publicKey, 'ocr');
        assert.strictEqual(bobVerifications.length, 1);
        
        const trustScore = computeTrustScore(
          bob.publicKey,
          'ocr',
          bobVerifications
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
    
    it('should handle multiple verifications from different agents', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const bob = generateKeyPair();
        const alice = generateKeyPair();
        const charlie = generateKeyPair();
        const david = generateKeyPair();
        
        const now = Date.now();
        
        // Multiple agents verify Bob's work
        const v1 = createVerification(
          alice.publicKey,
          alice.privateKey,
          bob.publicKey,
          'code_review',
          'correct',
          0.9
        );
        v1.timestamp = now;
        
        const v2 = createVerification(
          charlie.publicKey,
          charlie.privateKey,
          bob.publicKey,
          'code_review',
          'correct',
          0.95
        );
        v2.timestamp = now;
        
        const v3 = createVerification(
          david.publicKey,
          david.privateKey,
          bob.publicKey,
          'code_review',
          'incorrect',
          0.8
        );
        v3.timestamp = now;
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        store.append({ type: 'verification', data: v3 });
        
        const bobVerifications = store.getActiveVerificationsForAgent(bob.publicKey, 'code_review');
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
        const commit = createCommit(
          agent.publicKey,
          agent.privateKey,
          'price_prediction',
          prediction,
          1000 // 1 second expiry for test
        );
        
        store.append({ type: 'commit', data: commit });
        
        // Wait for expiry
        await new Promise(resolve => setTimeout(resolve, 1100));
        
        // Agent reveals prediction and outcome
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          commit.id,
          prediction,
          'Bitcoin reached $95k',
          'https://coinmarketcap.com/...'
        );
        
        store.append({ type: 'reveal', data: reveal });
        
        // Verify the reveal matches the commit
        const verificationResult = verifyReveal(commit, reveal);
        assert.strictEqual(verificationResult.valid, true);
        
        // Retrieve from store
        const storedCommit = store.getCommitById(commit.id);
        assert.ok(storedCommit);
        assert.strictEqual(storedCommit.id, commit.id);
        
        const storedReveal = store.getRevealByCommitmentId(commit.id);
        assert.ok(storedReveal);
        assert.strictEqual(storedReveal.prediction, prediction);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('multi-domain reputation', () => {
    it('should maintain separate scores per domain', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const verifier = generateKeyPair();
        
        const now = Date.now();
        
        // Agent is good at OCR
        const ocrVer1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0
        );
        ocrVer1.timestamp = now;
        
        const ocrVer2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0
        );
        ocrVer2.timestamp = now;
        
        // Agent is bad at code review
        const codeVer = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'incorrect',
          1.0
        );
        codeVer.timestamp = now;
        
        store.append({ type: 'verification', data: ocrVer1 });
        store.append({ type: 'verification', data: ocrVer2 });
        store.append({ type: 'verification', data: codeVer });
        
        // Compute all scores
        const allVerifications = store.getActiveVerifications();
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
    it('should handle verification revocation', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        const now = Date.now();
        
        // Verifier issues verification
        const verification = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        verification.timestamp = now;
        
        store.append({ type: 'verification', data: verification });
        
        // Compute initial score
        let verifications = store.getActiveVerificationsForAgent(agent.publicKey, 'ocr');
        let score = computeTrustScore(agent.publicKey, 'ocr', verifications, now);
        
        assert.ok(score.score > 0.9);
        assert.strictEqual(score.verificationCount, 1);
        
        // Verifier discovers error and revokes
        const revocation = {
          id: 'revocation_' + Date.now(),
          verifier: verifier.publicKey,
          verificationId: verification.id,
          reason: 'Found error in my verification process',
          timestamp: Date.now(),
          signature: 'fake_signature_for_test',
        };
        
        store.append({ type: 'revocation', data: revocation });
        
        // Recompute score with active verifications only
        verifications = store.getActiveVerificationsForAgent(agent.publicKey, 'ocr');
        score = computeTrustScore(agent.publicKey, 'ocr', verifications, now);
        
        assert.strictEqual(score.score, 0); // No active verifications
        assert.strictEqual(score.verificationCount, 0);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('time decay integration', () => {
    it('should show reputation decay over time', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const verification = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          1.0
        );
        
        store.append({ type: 'verification', data: verification });
        
        const verifications = store.getActiveVerificationsForAgent(agent.publicKey, 'ocr');
        
        // Score immediately
        const scoreNow = computeTrustScore(
          agent.publicKey,
          'ocr',
          verifications,
          verification.timestamp
        );
        
        assert.strictEqual(scoreNow.score, 1.0);
        
        // Score after 70 days (half-life)
        const seventyDaysLater = verification.timestamp + (70 * 24 * 60 * 60 * 1000);
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
