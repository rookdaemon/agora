import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { createCommit, createReveal, validateRevealMatchesCommit } from '../../src/reputation/commit-reveal.js';
import { computeTrustScore } from '../../src/reputation/scoring.js';
import { ReputationStore } from '../../src/reputation/store.js';

describe('Reputation Integration', () => {
  describe('end-to-end verification flow', () => {
    it('should support complete verification workflow', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      // Setup: Two agents, one verifier
      const agent1 = generateKeyPair();
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      // Agent 1 does work, gets verified
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        agent1.publicKey,
        'code_review',
        'correct',
        0.95
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        agent1.publicKey,
        'code_review',
        'correct',
        0.88
      );
      
      // Store verifications
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      
      // Query verifications
      const verifications = await store.queryVerifications(agent1.publicKey, 'code_review');
      assert.strictEqual(verifications.length, 2);
      
      // Compute trust score
      const score = computeTrustScore(agent1.publicKey, 'code_review', verifications);
      assert.ok(score.score > 0.8);
      assert.strictEqual(score.verificationCount, 2);
      assert.strictEqual(score.domain, 'code_review');
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should isolate reputation by domain', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      // Agent is good at code review
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'code_review',
        'correct',
        1.0
      );
      
      // But bad at OCR
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent.publicKey,
        'ocr',
        'incorrect',
        1.0
      );
      
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      
      const codeReviewVerifications = await store.queryVerifications(agent.publicKey, 'code_review');
      const ocrVerifications = await store.queryVerifications(agent.publicKey, 'ocr');
      
      const codeReviewScore = computeTrustScore(agent.publicKey, 'code_review', codeReviewVerifications);
      const ocrScore = computeTrustScore(agent.publicKey, 'ocr', ocrVerifications);
      
      // Should have high score in code review
      assert.ok(codeReviewScore.score > 0.9);
      
      // Should have low score in OCR
      assert.ok(ocrScore.score < 0.1);
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('end-to-end commit-reveal flow', () => {
    it('should support complete commit-reveal workflow', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const prediction = 'Bitcoin will reach $100,000 by end of 2026';
      const domain = 'price_prediction';
      
      // Phase 1: Commit
      const expiryMs = 100; // Short expiry for testing
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        domain,
        prediction,
        expiryMs
      );
      
      await store.append({ type: 'commit', ...commit });
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Phase 2: Reveal
      const outcome = 'Bitcoin reached $95,000';
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        prediction,
        outcome,
        'https://coinmarketcap.com/...'
      );
      
      await store.append({ type: 'reveal', ...reveal });
      
      // Verify commit-reveal pair
      const storedCommit = await store.getCommit(commit.id);
      assert.ok(storedCommit);
      
      const reveals = await store.queryReveals(agent.publicKey);
      assert.strictEqual(reveals.length, 1);
      assert.strictEqual(reveals[0].commitmentId, commit.id);
      
      // Validate reveal matches commit
      const isValid = validateRevealMatchesCommit(storedCommit, reveals[0]);
      assert.strictEqual(isValid, true);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should prevent cheating with wrong prediction in reveal', async () => {
      const agent = generateKeyPair();
      const realPrediction = 'It will rain';
      const fakePrediction = 'It will be sunny';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        realPrediction,
        100
      );
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Try to reveal with different prediction
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        fakePrediction,
        'It rained'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, false);
    });
  });
  
  describe('multi-agent reputation network', () => {
    it('should track reputation across multiple agents and domains', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      // Create a network of 3 agents
      const alice = generateKeyPair();
      const bob = generateKeyPair();
      const carol = generateKeyPair();
      
      // Alice verifies Bob in code_review
      const v1 = createVerification(
        alice.publicKey,
        alice.privateKey,
        bob.publicKey,
        'code_review',
        'correct',
        0.9
      );
      
      // Carol verifies Bob in code_review
      const v2 = createVerification(
        carol.publicKey,
        carol.privateKey,
        bob.publicKey,
        'code_review',
        'correct',
        0.95
      );
      
      // Bob verifies Alice in translation
      const v3 = createVerification(
        bob.publicKey,
        bob.privateKey,
        alice.publicKey,
        'translation',
        'correct',
        0.85
      );
      
      // Alice verifies Carol in OCR
      const v4 = createVerification(
        alice.publicKey,
        alice.privateKey,
        carol.publicKey,
        'ocr',
        'correct',
        0.92
      );
      
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      await store.append({ type: 'verification', ...v3 });
      await store.append({ type: 'verification', ...v4 });
      
      // Check Bob's code review reputation
      const bobCodeReviewVerifications = await store.queryVerifications(bob.publicKey, 'code_review');
      const bobScore = computeTrustScore(bob.publicKey, 'code_review', bobCodeReviewVerifications);
      assert.ok(bobScore.score > 0.8);
      assert.strictEqual(bobScore.verificationCount, 2);
      assert.strictEqual(bobScore.topVerifiers.length, 2);
      
      // Check Alice's translation reputation
      const aliceTranslationVerifications = await store.queryVerifications(alice.publicKey, 'translation');
      const aliceScore = computeTrustScore(alice.publicKey, 'translation', aliceTranslationVerifications);
      assert.ok(aliceScore.score > 0.8);
      assert.strictEqual(aliceScore.verificationCount, 1);
      
      // Check Carol's OCR reputation
      const carolOcrVerifications = await store.queryVerifications(carol.publicKey, 'ocr');
      const carolScore = computeTrustScore(carol.publicKey, 'ocr', carolOcrVerifications);
      assert.ok(carolScore.score > 0.8);
      assert.strictEqual(carolScore.verificationCount, 1);
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('reputation decay over time', () => {
    it('should apply time decay to old verifications', async () => {
      const agent = 'agent-pubkey';
      const verifier = generateKeyPair();
      const currentTime = Date.now();
      
      // Create verification from 1 year ago
      const oldVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      oldVerification.timestamp = currentTime - (365 * 24 * 60 * 60 * 1000);
      
      // Create recent verification
      const recentVerification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      recentVerification.timestamp = currentTime;
      
      const scoreOld = computeTrustScore(agent, 'code_review', [oldVerification], currentTime);
      const scoreRecent = computeTrustScore(agent, 'code_review', [recentVerification], currentTime);
      
      // Recent verifications should have much higher weight
      assert.ok(scoreRecent.score > scoreOld.score);
      
      // Old verification should have significantly decayed
      assert.ok(scoreOld.score < 0.1);
    });
  });
});
