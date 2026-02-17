import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createCommit,
  createReveal,
  validateCommit,
  validateReveal,
  verifyRevealMatchesCommit,
  hashPrediction,
} from '../../src/reputation/commit-reveal.js';

describe('Commit-Reveal', () => {
  describe('hashPrediction', () => {
    it('should generate deterministic hash', () => {
      const prediction = 'It will rain in Stockholm on 2026-02-17';
      const hash1 = hashPrediction(prediction);
      const hash2 = hashPrediction(prediction);
      
      assert.strictEqual(hash1, hash2);
      assert.strictEqual(hash1.length, 64); // SHA-256 hex is 64 chars
    });
    
    it('should generate different hashes for different predictions', () => {
      const hash1 = hashPrediction('prediction 1');
      const hash2 = hashPrediction('prediction 2');
      
      assert.notStrictEqual(hash1, hash2);
    });
  });
  
  describe('createCommit', () => {
    it('should create a valid commit record', () => {
      const agent = generateKeyPair();
      const domain = 'weather_forecast';
      const prediction = 'It will rain tomorrow';
      const expiryMs = 24 * 60 * 60 * 1000; // 24 hours
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        domain,
        prediction,
        expiryMs,
      );
      
      assert.strictEqual(commit.agent, agent.publicKey);
      assert.strictEqual(commit.domain, domain);
      assert.strictEqual(commit.commitment, hashPrediction(prediction));
      assert.ok(commit.id);
      assert.ok(commit.signature);
      assert.ok(commit.timestamp > 0);
      assert.ok(commit.expiry > commit.timestamp);
      assert.strictEqual(commit.expiry, commit.timestamp + expiryMs);
    });
  });
  
  describe('createReveal', () => {
    it('should create a valid reveal record', () => {
      const agent = generateKeyPair();
      const commitmentId = 'commit-id-123';
      const prediction = 'It will rain tomorrow';
      const outcome = 'rain observed';
      const evidence = 'https://weather.com/api/result';
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commitmentId,
        prediction,
        outcome,
        evidence,
      );
      
      assert.strictEqual(reveal.agent, agent.publicKey);
      assert.strictEqual(reveal.commitmentId, commitmentId);
      assert.strictEqual(reveal.prediction, prediction);
      assert.strictEqual(reveal.outcome, outcome);
      assert.strictEqual(reveal.evidence, evidence);
      assert.ok(reveal.id);
      assert.ok(reveal.signature);
      assert.ok(reveal.timestamp > 0);
    });
    
    it('should create reveal without evidence', () => {
      const agent = generateKeyPair();
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit-123',
        'prediction',
        'outcome',
      );
      
      assert.strictEqual(reveal.evidence, undefined);
    });
  });
  
  describe('validateCommit', () => {
    it('should validate a valid commit', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors, undefined);
    });
    
    it('should reject commit with missing fields', () => {
      const result = validateCommit({
        id: 'test-id',
        agent: 'agent-key',
        domain: 'weather',
        commitment: 'hash',
        timestamp: Date.now(),
        expiry: Date.now() + 1000,
        // Missing signature
      } as any);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('signature')));
    });
    
    it('should reject commit with expiry before timestamp', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      // Tamper with expiry
      commit.expiry = commit.timestamp - 1000;
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('expiry')));
    });
    
    it('should reject commit with invalid signature', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      // Tamper with signature
      commit.signature = 'invalid-signature';
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('signature')));
    });
  });
  
  describe('validateReveal', () => {
    it('should validate a valid reveal', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit-123',
        'prediction',
        'outcome',
      );
      
      const result = validateReveal(reveal);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors, undefined);
    });
    
    it('should reject reveal with invalid signature', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit-123',
        'prediction',
        'outcome',
      );
      
      // Tamper with signature
      reveal.signature = 'invalid-signature';
      
      const result = validateReveal(reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('signature')));
    });
  });
  
  describe('verifyRevealMatchesCommit', () => {
    it('should verify matching commit and reveal', () => {
      const agent = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 1000;
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        prediction,
        expiryMs,
      );
      
      // Wait for expiry
      const originalDateNow = Date.now;
      Date.now = () => commit.expiry + 100;
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        prediction,
        'rain observed',
      );
      
      Date.now = originalDateNow;
      
      const result = verifyRevealMatchesCommit(commit, reveal);
      assert.strictEqual(result.valid, true);
    });
    
    it('should reject reveal with wrong agent', () => {
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      const prediction = 'test prediction';
      
      const commit = createCommit(
        agent1.publicKey,
        agent1.privateKey,
        'weather',
        prediction,
        1000,
      );
      
      const reveal = createReveal(
        agent2.publicKey, // Different agent
        agent2.privateKey,
        commit.id,
        prediction,
        'outcome',
      );
      
      const result = verifyRevealMatchesCommit(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('Agent mismatch')));
    });
    
    it('should reject reveal with wrong commitment ID', () => {
      const agent = generateKeyPair();
      const prediction = 'test prediction';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        prediction,
        1000,
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'wrong-commit-id', // Wrong ID
        prediction,
        'outcome',
      );
      
      const result = verifyRevealMatchesCommit(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('Commitment ID mismatch')));
    });
    
    it('should reject reveal with wrong prediction', () => {
      const agent = generateKeyPair();
      const originalPrediction = 'original prediction';
      const wrongPrediction = 'different prediction';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        originalPrediction,
        1000,
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        wrongPrediction, // Different prediction
        'outcome',
      );
      
      const result = verifyRevealMatchesCommit(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('Prediction hash')));
    });
    
    it('should reject reveal before expiry', () => {
      const agent = generateKeyPair();
      const prediction = 'test prediction';
      const expiryMs = 10000; // 10 seconds
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        prediction,
        expiryMs,
      );
      
      // Create reveal before expiry
      const originalDateNow = Date.now;
      Date.now = () => commit.expiry - 100; // Before expiry
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        prediction,
        'outcome',
      );
      
      Date.now = originalDateNow;
      
      const result = verifyRevealMatchesCommit(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('before commitment expiry')));
    });
  });
});
