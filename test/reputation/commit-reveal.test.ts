import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createCommit,
  createReveal,
  validateCommit,
  validateReveal,
  verifyCommit,
  verifyReveal,
  validateRevealMatchesCommit,
  isCommitExpired,
} from '../../src/reputation/commit-reveal.js';

describe('Commit-Reveal', () => {
  describe('createCommit', () => {
    it('should create a valid commit record', () => {
      const agentKeys = generateKeyPair();
      const prediction = 'It will rain in Stockholm on 2026-02-17';
      const expiryMs = 24 * 60 * 60 * 1000; // 24 hours
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      assert.strictEqual(commit.agent, agentKeys.publicKey);
      assert.strictEqual(commit.domain, 'weather_forecast');
      assert.ok(commit.commitment);
      assert.ok(commit.id);
      assert.ok(commit.signature);
      assert.strictEqual(commit.expiry, commit.timestamp + expiryMs);
    });
    
    it('should generate deterministic commitment hash', () => {
      const agentKeys = generateKeyPair();
      const prediction = 'Test prediction';
      
      const commit1 = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        prediction,
        1000
      );
      
      const commit2 = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        prediction,
        1000
      );
      
      // Same prediction should have same commitment hash
      assert.strictEqual(commit1.commitment, commit2.commitment);
    });
    
    it('should generate different hashes for different predictions', () => {
      const agentKeys = generateKeyPair();
      
      const commit1 = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction A',
        1000
      );
      
      const commit2 = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction B',
        1000
      );
      
      assert.notStrictEqual(commit1.commitment, commit2.commitment);
    });
  });
  
  describe('createReveal', () => {
    it('should create a valid reveal record', () => {
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather_forecast',
        'It will rain',
        1000
      );
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commit.id,
        'It will rain',
        'Rain was observed',
        'https://weather.example.com/data'
      );
      
      assert.strictEqual(reveal.agent, agentKeys.publicKey);
      assert.strictEqual(reveal.commitmentId, commit.id);
      assert.strictEqual(reveal.prediction, 'It will rain');
      assert.strictEqual(reveal.outcome, 'Rain was observed');
      assert.strictEqual(reveal.evidence, 'https://weather.example.com/data');
      assert.ok(reveal.id);
      assert.ok(reveal.signature);
    });
    
    it('should work without evidence', () => {
      const agentKeys = generateKeyPair();
      const commitId = 'commit-id-123';
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commitId,
        'prediction',
        'outcome'
      );
      
      assert.strictEqual(reveal.evidence, undefined);
    });
  });
  
  describe('validateCommit', () => {
    it('should validate a valid commit', () => {
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        1000
      );
      
      const errors = validateCommit(commit);
      assert.strictEqual(errors.length, 0);
    });
    
    it('should reject commit with expiry before timestamp', () => {
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        1000
      );
      
      // Tamper with expiry
      commit.expiry = commit.timestamp - 1;
      
      const errors = validateCommit(commit);
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('Expiry must be after timestamp')));
    });
  });
  
  describe('validateReveal', () => {
    it('should validate a valid reveal', () => {
      const agentKeys = generateKeyPair();
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'commit-id',
        'prediction',
        'outcome'
      );
      
      const errors = validateReveal(reveal);
      assert.strictEqual(errors.length, 0);
    });
  });
  
  describe('verifyCommit', () => {
    it('should verify a valid commit', () => {
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        1000
      );
      
      const isValid = verifyCommit(commit);
      assert.strictEqual(isValid, true);
    });
    
    it('should reject tampered commit', () => {
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        1000
      );
      
      // Tamper with domain
      commit.domain = 'tampered';
      
      const isValid = verifyCommit(commit);
      assert.strictEqual(isValid, false);
    });
  });
  
  describe('verifyReveal', () => {
    it('should verify a valid reveal', () => {
      const agentKeys = generateKeyPair();
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'commit-id',
        'prediction',
        'outcome'
      );
      
      const isValid = verifyReveal(reveal);
      assert.strictEqual(isValid, true);
    });
  });
  
  describe('validateRevealMatchesCommit', () => {
    it('should validate matching commit and reveal', async () => {
      const agentKeys = generateKeyPair();
      const prediction = 'It will rain';
      const expiryMs = 100; // 100ms for quick test
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather',
        prediction,
        expiryMs
      );
      
      // Wait for commit to expire
      await new Promise(resolve => setTimeout(resolve, 150));
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commit.id,
        prediction,
        'Rain observed'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, true);
    });
    
    it('should reject reveal with wrong commitmentId', () => {
      const agentKeys = generateKeyPair();
      const prediction = 'It will rain';
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather',
        prediction,
        100
      );
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'wrong-commit-id',
        prediction,
        'outcome'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, false);
    });
    
    it('should reject reveal with different agent', () => {
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      const prediction = 'It will rain';
      
      const commit = createCommit(
        agent1.publicKey,
        agent1.privateKey,
        'weather',
        prediction,
        100
      );
      
      const reveal = createReveal(
        agent2.publicKey,
        agent2.privateKey,
        commit.id,
        prediction,
        'outcome'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, false);
    });
    
    it('should reject reveal with wrong prediction', () => {
      const agentKeys = generateKeyPair();
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather',
        'prediction A',
        100
      );
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commit.id,
        'prediction B',
        'outcome'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, false);
    });
    
    it('should reject reveal before expiry', () => {
      const agentKeys = generateKeyPair();
      const prediction = 'It will rain';
      const expiryMs = 10000; // 10 seconds in future
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather',
        prediction,
        expiryMs
      );
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commit.id,
        prediction,
        'outcome'
      );
      
      const isValid = validateRevealMatchesCommit(commit, reveal);
      assert.strictEqual(isValid, false);
    });
  });
  
  describe('isCommitExpired', () => {
    it('should return true for expired commit', () => {
      const agentKeys = generateKeyPair();
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        100
      );
      
      // Check with time in future
      const futureTime = commit.expiry + 1000;
      assert.strictEqual(isCommitExpired(commit, futureTime), true);
    });
    
    it('should return false for non-expired commit', () => {
      const agentKeys = generateKeyPair();
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        10000
      );
      
      assert.strictEqual(isCommitExpired(commit), false);
    });
    
    it('should use current time by default', () => {
      const agentKeys = generateKeyPair();
      
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'test',
        'prediction',
        -1000 // Already expired
      );
      
      assert.strictEqual(isCommitExpired(commit), true);
    });
  });
});
