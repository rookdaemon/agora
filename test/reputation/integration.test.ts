import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { ReputationStore } from '../../src/reputation/store.js';
import {
  createVerification,
  createRevocation,
} from '../../src/reputation/verification.js';
import {
  createCommit,
  createReveal,
  verifyReveal,
} from '../../src/reputation/commit-reveal.js';
import { computeTrustScore } from '../../src/reputation/scoring.js';

describe('Reputation Integration', () => {
  const testStorePath = '/tmp/agora-test-reputation-integration.jsonl';

  beforeEach(() => {
    if (existsSync(testStorePath)) {
      unlinkSync(testStorePath);
    }
    const dir = dirname(testStorePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  });

  it('should support complete commit-reveal-verify flow', () => {
    const store = new ReputationStore(testStorePath);
    const agent = generateKeyPair();
    const verifier1 = generateKeyPair();
    const verifier2 = generateKeyPair();

    // Step 1: Agent commits to a prediction
    const prediction = 'It will rain in Stockholm on 2026-02-17';
    const commit = createCommit(agent.publicKey, agent.privateKey, 'weather_forecast', prediction, 100);
    store.addCommit(commit);

    // Verify commit was stored
    const storedCommit = store.getCommit(commit.id);
    assert.ok(storedCommit);
    assert.strictEqual(storedCommit.commitment, commit.commitment);

    // Step 2: After event occurs, agent reveals the prediction
    const reveal = createReveal(
      agent.publicKey,
      agent.privateKey,
      commit.id,
      prediction,
      'rain observed',
      'https://weather.api/stockholm/2026-02-17',
    );
    store.addReveal(reveal);

    // Step 3: Verify the reveal matches the commitment
    const verifyResult = verifyReveal(commit, reveal);
    assert.strictEqual(verifyResult.valid, true);

    // Step 4: Verifiers independently check and verify the claim
    const verification1 = createVerification(
      verifier1.publicKey,
      verifier1.privateKey,
      reveal.id,
      'weather_forecast',
      'correct',
      0.95,
      'https://verifier1.com/check',
    );
    store.addVerification(verification1);

    const verification2 = createVerification(
      verifier2.publicKey,
      verifier2.privateKey,
      reveal.id,
      'weather_forecast',
      'correct',
      0.90,
    );
    store.addVerification(verification2);

    // Step 5: Compute trust score for the agent
    const score = store.computeTrustScore(agent.publicKey, 'weather_forecast');
    assert.ok(score.score > 0.5); // Positive verifications should increase score
    assert.strictEqual(score.verificationCount, 2);
    assert.strictEqual(score.domain, 'weather_forecast');
  });

  it('should handle verification revocation', () => {
    const store = new ReputationStore(testStorePath);
    const agent = 'agent-key';
    const verifier = generateKeyPair();

    // Verifier creates a verification
    const verification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target1',
      'ocr',
      'correct',
      0.95,
    );
    store.addVerification(verification);

    // Compute initial score
    let score = store.computeTrustScore(agent, 'ocr');
    assert.strictEqual(score.verificationCount, 1);

    // Verifier discovers an error and revokes the verification
    const revocation = createRevocation(
      verifier.publicKey,
      verifier.privateKey,
      verification.id,
      'discovered_error',
      'https://evidence.com/error-report',
    );
    store.addRevocation(revocation);

    // Verify the verification is marked as revoked
    assert.strictEqual(store.isRevoked(verification.id), true);

    // Compute score again - should not include revoked verification
    score = store.computeTrustScore(agent, 'ocr');
    assert.strictEqual(score.verificationCount, 0);
    assert.strictEqual(score.score, 0.5); // Neutral score with no verifications
  });

  it('should compute domain-specific trust scores', () => {
    const store = new ReputationStore(testStorePath);
    const agent = 'agent-key';
    const verifier = generateKeyPair();

    // Add verifications in different domains
    const v1 = createVerification(verifier.publicKey, verifier.privateKey, 't1', 'ocr', 'correct', 1.0);
    const v2 = createVerification(verifier.publicKey, verifier.privateKey, 't2', 'ocr', 'correct', 0.9);
    const v3 = createVerification(verifier.publicKey, verifier.privateKey, 't3', 'summarization', 'incorrect', 0.8);

    store.addVerification(v1);
    store.addVerification(v2);
    store.addVerification(v3);

    // Compute scores for each domain
    const ocrScore = store.computeTrustScore(agent, 'ocr');
    const summScore = store.computeTrustScore(agent, 'summarization');

    // OCR should have high score (2 correct verifications)
    assert.ok(ocrScore.score > 0.5);
    assert.strictEqual(ocrScore.verificationCount, 2);
    assert.strictEqual(ocrScore.domain, 'ocr');

    // Summarization should have low score (1 incorrect verification)
    assert.ok(summScore.score < 0.5);
    assert.strictEqual(summScore.verificationCount, 1);
    assert.strictEqual(summScore.domain, 'summarization');
  });

  it('should apply time decay to verifications', () => {
    const agent = 'agent-key';
    const verifier = generateKeyPair();

    const now = Date.now();
    const recentTime = now - 1000; // 1 second ago
    const oldTime = now - (100 * 24 * 60 * 60 * 1000); // 100 days ago

    // Create two positive verifications at different times
    const recentVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      't1',
      'ocr',
      'correct',
      1.0,
    );
    recentVerification.timestamp = recentTime;

    const oldVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      't2',
      'ocr',
      'correct',
      1.0,
    );
    oldVerification.timestamp = oldTime;

    // Compute score with both verifications
    const score = computeTrustScore(agent, 'ocr', [recentVerification, oldVerification], now);

    // Both are positive, so score should be high
    assert.ok(score.score > 0.5);
    assert.strictEqual(score.verificationCount, 2);
    assert.strictEqual(score.lastVerified, recentTime); // Most recent tracked
  });

  it('should persist and reload complete reputation history', () => {
    const agent = generateKeyPair();
    const verifier = generateKeyPair();

    // Create first store and add data
    const store1 = new ReputationStore(testStorePath);

    const commit = createCommit(agent.publicKey, agent.privateKey, 'test', 'prediction');
    const reveal = createReveal(agent.publicKey, agent.privateKey, commit.id, 'prediction', 'outcome');
    const verification = createVerification(verifier.publicKey, verifier.privateKey, reveal.id, 'test', 'correct', 0.9);

    store1.addCommit(commit);
    store1.addReveal(reveal);
    store1.addVerification(verification);

    // Create second store instance - should load from file
    const store2 = new ReputationStore(testStorePath);

    assert.strictEqual(store2.getAllCommits().length, 1);
    assert.strictEqual(store2.getAllReveals().length, 1);
    assert.strictEqual(store2.getAllVerifications().length, 1);

    const loadedCommit = store2.getCommit(commit.id);
    assert.ok(loadedCommit);
    assert.strictEqual(loadedCommit.commitment, commit.commitment);

    const loadedReveal = store2.getRevealByCommitment(commit.id);
    assert.ok(loadedReveal);
    assert.strictEqual(loadedReveal.prediction, 'prediction');
  });

  it('should handle multiple verifiers with different opinions', () => {
    const store = new ReputationStore(testStorePath);
    const agent = 'agent-key';
    const verifier1 = generateKeyPair();
    const verifier2 = generateKeyPair();
    const verifier3 = generateKeyPair();

    // Three verifiers with different opinions
    const v1 = createVerification(verifier1.publicKey, verifier1.privateKey, 't1', 'ocr', 'correct', 1.0);
    const v2 = createVerification(verifier2.publicKey, verifier2.privateKey, 't1', 'ocr', 'correct', 0.9);
    const v3 = createVerification(verifier3.publicKey, verifier3.privateKey, 't1', 'ocr', 'incorrect', 0.8);

    store.addVerification(v1);
    store.addVerification(v2);
    store.addVerification(v3);

    const score = store.computeTrustScore(agent, 'ocr');

    // With 2 correct and 1 incorrect, score should be positive but not perfect
    assert.ok(score.score > 0.5);
    assert.ok(score.score < 1.0);
    assert.strictEqual(score.verificationCount, 3);
    assert.strictEqual(score.topVerifiers.length, 3);
  });

  it('should handle commit expiry correctly', () => {
    const agent = generateKeyPair();
    const shortExpiryMs = 100; // 100ms

    const commit = createCommit(
      agent.publicKey,
      agent.privateKey,
      'test',
      'prediction',
      shortExpiryMs,
    );

    // Check expiry before time
    assert.strictEqual(commit.expiry, commit.timestamp + shortExpiryMs);

    // Reveal should still work regardless of expiry for verification purposes
    const reveal = createReveal(
      agent.publicKey,
      agent.privateKey,
      commit.id,
      'prediction',
      'outcome',
    );

    const verifyResult = verifyReveal(commit, reveal);
    assert.strictEqual(verifyResult.valid, true);
  });
});
