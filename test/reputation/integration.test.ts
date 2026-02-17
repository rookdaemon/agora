import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createCommit, createReveal, verifyRevealMatchesCommit } from '../../src/reputation/commit-reveal.js';
import { createVerification, validateVerification } from '../../src/reputation/verification.js';
import { computeTrustScore } from '../../src/reputation/scoring.js';
import { ReputationStore } from '../../src/reputation/store.js';

describe('Reputation Integration', () => {
  const testStorePath = join('/tmp', `test-reputation-integration-${Date.now()}.jsonl`);
  
  afterEach(() => {
    if (existsSync(testStorePath)) {
      unlinkSync(testStorePath);
    }
  });
  
  it('should complete full commit-reveal-verify flow', () => {
    const store = new ReputationStore(testStorePath);
    
    // Step 1: Agent makes a prediction commitment
    const predictor = generateKeyPair();
    const prediction = 'It will rain in Stockholm on 2026-02-17';
    const domain = 'weather_forecast';
    const expiryMs = 24 * 60 * 60 * 1000; // 24 hours
    
    const commit = createCommit(
      predictor.publicKey,
      predictor.privateKey,
      domain,
      prediction,
      expiryMs,
    );
    
    store.appendCommit(commit);
    
    // Step 2: After expiry, agent reveals the prediction
    const originalDateNow = Date.now;
    Date.now = () => commit.expiry + 1000; // After expiry
    
    const outcome = 'rain observed';
    const evidence = 'https://weather.com/api/stockholm/2026-02-17';
    
    const reveal = createReveal(
      predictor.publicKey,
      predictor.privateKey,
      commit.id,
      prediction,
      outcome,
      evidence,
    );
    
    Date.now = originalDateNow;
    
    store.appendReveal(reveal);
    
    // Step 3: Verify reveal matches commit
    const matchResult = verifyRevealMatchesCommit(commit, reveal);
    assert.strictEqual(matchResult.valid, true);
    
    // Step 4: Other agents verify the prediction
    const verifier1 = generateKeyPair();
    const verifier2 = generateKeyPair();
    
    const v1 = createVerification(
      verifier1.publicKey,
      verifier1.privateKey,
      reveal.id,
      domain,
      'correct', // Prediction was accurate
      0.95,
      'https://verifier1.com/check',
    );
    
    const v2 = createVerification(
      verifier2.publicKey,
      verifier2.privateKey,
      reveal.id,
      domain,
      'correct',
      0.9,
      'https://verifier2.com/check',
    );
    
    store.appendVerification(v1);
    store.appendVerification(v2);
    
    // Step 5: Compute trust score for predictor
    const verifications = store.getVerifications();
    const score = computeTrustScore(
      predictor.publicKey,
      domain,
      verifications,
      [],
      Date.now(),
    );
    
    assert.ok(score !== null);
    assert.strictEqual(score.agent, predictor.publicKey);
    assert.strictEqual(score.domain, domain);
    assert.strictEqual(score.verificationCount, 2);
    assert.ok(score.score > 0.9); // High score for correct predictions
    
    // Step 6: Verify persistence
    const store2 = new ReputationStore(testStorePath);
    const loadedCommits = store2.getCommits();
    const loadedReveals = store2.getReveals();
    const loadedVerifications = store2.getVerifications();
    
    assert.strictEqual(loadedCommits.length, 1);
    assert.strictEqual(loadedReveals.length, 1);
    assert.strictEqual(loadedVerifications.length, 2);
  });
  
  it('should handle multi-domain reputation tracking', () => {
    const store = new ReputationStore(testStorePath);
    const agent = generateKeyPair();
    const verifier = generateKeyPair();
    
    // Agent gets verifications in multiple domains
    const ocrVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-ocr',
      'ocr',
      'correct',
      1.0,
    );
    
    const codeReviewVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-code',
      'code_review',
      'incorrect',
      0.9,
    );
    
    const summarizationVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-summary',
      'summarization',
      'correct',
      0.85,
    );
    
    store.appendVerification(ocrVerification);
    store.appendVerification(codeReviewVerification);
    store.appendVerification(summarizationVerification);
    
    // Compute scores for each domain
    const verifications = store.getVerifications();
    
    const ocrScore = computeTrustScore(
      agent.publicKey,
      'ocr',
      verifications,
      [],
      Date.now(),
    );
    
    const codeReviewScore = computeTrustScore(
      agent.publicKey,
      'code_review',
      verifications,
      [],
      Date.now(),
    );
    
    const summarizationScore = computeTrustScore(
      agent.publicKey,
      'summarization',
      verifications,
      [],
      Date.now(),
    );
    
    // OCR should have high score (correct)
    assert.ok(ocrScore !== null);
    assert.ok(ocrScore.score > 0.9);
    
    // Code review should have low score (incorrect)
    assert.ok(codeReviewScore !== null);
    assert.ok(codeReviewScore.score < 0.2);
    
    // Summarization should have high score (correct)
    assert.ok(summarizationScore !== null);
    assert.ok(summarizationScore.score > 0.8);
    
    // Domain isolation: scores should be independent
    assert.notStrictEqual(ocrScore.score, codeReviewScore.score);
  });
  
  it('should handle verification validation in workflow', () => {
    const verifier = generateKeyPair();
    
    // Create valid verification
    const verification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-123',
      'ocr',
      'correct',
      0.95,
    );
    
    // Validate before storing
    const validationResult = validateVerification(verification);
    assert.strictEqual(validationResult.valid, true);
    
    // Store only if valid
    if (validationResult.valid) {
      const store = new ReputationStore(testStorePath);
      store.appendVerification(verification);
      
      const stored = store.getVerifications();
      assert.strictEqual(stored.length, 1);
    }
  });
  
  it('should handle time decay in real-world scenario', () => {
    const store = new ReputationStore(testStorePath);
    const agent = generateKeyPair();
    const verifier = generateKeyPair();
    
    // Create old verification
    const oldTimestamp = Date.now() - (100 * 24 * 60 * 60 * 1000); // 100 days ago
    const originalDateNow = Date.now;
    Date.now = () => oldTimestamp;
    
    const oldVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-old',
      'ocr',
      'correct',
      1.0,
    );
    
    Date.now = originalDateNow;
    
    // Create recent verification
    const recentVerification = createVerification(
      verifier.publicKey,
      verifier.privateKey,
      'target-recent',
      'ocr',
      'correct',
      1.0,
    );
    
    store.appendVerification(oldVerification);
    store.appendVerification(recentVerification);
    
    // Compute score - old verification should have less weight
    const verifications = store.getVerifications();
    const score = computeTrustScore(
      agent.publicKey,
      'ocr',
      verifications,
      [],
      Date.now(),
    );
    
    assert.ok(score !== null);
    assert.strictEqual(score.verificationCount, 2);
    // Score should be high but not perfect due to old verification decay
    assert.ok(score.score > 0.8);
  });
  
  it('should handle prediction that does not match commitment', () => {
    const predictor = generateKeyPair();
    const originalPrediction = 'It will rain';
    const fakeRevealPrediction = 'It will be sunny'; // Different!
    
    const commit = createCommit(
      predictor.publicKey,
      predictor.privateKey,
      'weather',
      originalPrediction,
      1000,
    );
    
    // Try to reveal different prediction
    const originalDateNow = Date.now;
    Date.now = () => commit.expiry + 1000;
    
    const reveal = createReveal(
      predictor.publicKey,
      predictor.privateKey,
      commit.id,
      fakeRevealPrediction, // Wrong prediction
      'outcome',
    );
    
    Date.now = originalDateNow;
    
    // Verification should fail
    const matchResult = verifyRevealMatchesCommit(commit, reveal);
    assert.strictEqual(matchResult.valid, false);
    assert.ok(matchResult.errors?.some(e => e.includes('Prediction hash')));
  });
});
