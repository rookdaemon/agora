import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createCommit,
  validateCommit,
  createReveal,
  validateReveal,
  verifyReveal,
  hashPrediction,
} from '../../src/reputation/commit-reveal.js';

describe('Commit-Reveal', () => {
  describe('hashPrediction', () => {
    it('should hash prediction deterministically', () => {
      const pred = 'It will rain in Stockholm';
      const hash1 = hashPrediction(pred);
      const hash2 = hashPrediction(pred);
      assert.strictEqual(hash1, hash2);
    });
    
    it('should produce different hashes for different predictions', () => {
      const hash1 = hashPrediction('prediction A');
      const hash2 = hashPrediction('prediction B');
      assert.notStrictEqual(hash1, hash2);
    });
  });
  
  describe('createCommit', () => {
    it('should create a valid commit record', () => {
      const agent = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        prediction
      );
      
      assert.strictEqual(commit.agent, agent.publicKey);
      assert.strictEqual(commit.domain, 'weather_forecast');
      assert.strictEqual(commit.commitment, hashPrediction(prediction));
      assert.ok(commit.id);
      assert.ok(commit.signature);
      assert.ok(commit.timestamp > 0);
      assert.ok(commit.expiry > commit.timestamp);
    });
    
    it('should use custom expiry time', () => {
      const agent = generateKeyPair();
      const expiryMs = 60 * 60 * 1000; // 1 hour
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction',
        expiryMs
      );
      
      assert.strictEqual(commit.expiry - commit.timestamp, expiryMs);
    });
    
    it('should use default 24-hour expiry', () => {
      const agent = generateKeyPair();
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction'
      );
      
      const expectedExpiry = 24 * 60 * 60 * 1000;
      assert.ok(Math.abs((commit.expiry - commit.timestamp) - expectedExpiry) < 100);
    });
  });
  
  describe('validateCommit', () => {
    it('should validate a valid commit', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction'
      );
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });
    
    it('should reject commit with invalid signature', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction'
      );
      
      commit.signature = '0'.repeat(128);
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });
    
    it('should reject commit with tampered ID', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction'
      );
      
      commit.id = 'fake_id';
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });
    
    it('should reject commit with expiry before timestamp', () => {
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        'prediction'
      );
      
      commit.expiry = commit.timestamp - 1000;
      
      const result = validateCommit(commit);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'expiry_before_timestamp');
    });
  });
  
  describe('createReveal', () => {
    it('should create a valid reveal record', () => {
      const agent = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const outcome = 'It rained';
      const commitmentId = 'commit_id_123';
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commitmentId,
        prediction,
        outcome
      );
      
      assert.strictEqual(reveal.agent, agent.publicKey);
      assert.strictEqual(reveal.commitmentId, commitmentId);
      assert.strictEqual(reveal.prediction, prediction);
      assert.strictEqual(reveal.outcome, outcome);
      assert.ok(reveal.id);
      assert.ok(reveal.signature);
      assert.ok(reveal.timestamp > 0);
      assert.strictEqual(reveal.evidence, undefined);
    });
    
    it('should create reveal with evidence', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit_id_123',
        'prediction',
        'outcome',
        'https://example.com/evidence'
      );
      
      assert.strictEqual(reveal.evidence, 'https://example.com/evidence');
    });
  });
  
  describe('validateReveal', () => {
    it('should validate a valid reveal', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit_id_123',
        'prediction',
        'outcome'
      );
      
      const result = validateReveal(reveal);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });
    
    it('should reject reveal with invalid signature', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit_id_123',
        'prediction',
        'outcome'
      );
      
      reveal.signature = '0'.repeat(128);
      
      const result = validateReveal(reveal);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });
    
    it('should reject reveal with tampered ID', () => {
      const agent = generateKeyPair();
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit_id_123',
        'prediction',
        'outcome'
      );
      
      reveal.id = 'fake_id';
      
      const result = validateReveal(reveal);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });
  });
  
  describe('verifyReveal', () => {
    it('should verify a valid commit-reveal pair', () => {
      const agent = generateKeyPair();
      const prediction = 'It will rain tomorrow in Stockholm';
      
      // Create commit
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        prediction,
        1000 // 1 second expiry for test
      );
      
      // Wait for expiry
      const waitForExpiry = new Promise(resolve => setTimeout(resolve, 1100));
      
      return waitForExpiry.then(() => {
        // Create reveal after expiry
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          commit.id,
          prediction,
          'It did rain'
        );
        
        const result = verifyReveal(commit, reveal);
        assert.strictEqual(result.valid, true);
        assert.strictEqual(result.reason, undefined);
      });
    });
    
    it('should reject reveal with wrong commitment ID', () => {
      const agent = generateKeyPair();
      const prediction = 'prediction';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        prediction
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'wrong_commitment_id',
        prediction,
        'outcome'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'commitment_id_mismatch');
    });
    
    it('should reject reveal with wrong agent', () => {
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      const prediction = 'prediction';
      
      const commit = createCommit(
        agent1.publicKey,
        agent1.privateKey,
        'weather_forecast',
        prediction
      );
      
      const reveal = createReveal(
        agent2.publicKey,
        agent2.privateKey,
        commit.id,
        prediction,
        'outcome'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'agent_mismatch');
    });
    
    it('should reject reveal before expiry', () => {
      const agent = generateKeyPair();
      const prediction = 'prediction';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        prediction,
        60 * 60 * 1000 // 1 hour expiry
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        prediction,
        'outcome'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'reveal_before_expiry');
    });
    
    it('should reject reveal with wrong prediction', () => {
      const agent = generateKeyPair();
      const correctPrediction = 'It will rain';
      const wrongPrediction = 'It will be sunny';
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather_forecast',
        correctPrediction,
        1000
      );
      
      const waitForExpiry = new Promise(resolve => setTimeout(resolve, 1100));
      
      return waitForExpiry.then(() => {
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          commit.id,
          wrongPrediction, // Different prediction!
          'outcome'
        );
        
        const result = verifyReveal(commit, reveal);
        assert.strictEqual(result.valid, false);
        assert.strictEqual(result.reason, 'prediction_hash_mismatch');
      });
    });
  });
});
