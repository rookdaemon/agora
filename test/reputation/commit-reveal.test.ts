/**
 * Tests for commit-reveal pattern
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  hashPrediction,
  createCommit,
  createReveal,
  verifyReveal,
} from '../../src/reputation/commit-reveal.js';

describe('Commit-Reveal', () => {
  describe('hashPrediction', () => {
    it('should create SHA-256 hash of prediction', () => {
      const prediction = 'It will rain tomorrow';
      const hash = hashPrediction(prediction);
      
      assert.strictEqual(typeof hash, 'string');
      assert.strictEqual(hash.length, 64); // SHA-256 hex is 64 chars
    });

    it('should produce deterministic hashes', () => {
      const prediction = 'It will rain tomorrow';
      const hash1 = hashPrediction(prediction);
      const hash2 = hashPrediction(prediction);
      
      assert.strictEqual(hash1, hash2);
    });

    it('should produce different hashes for different predictions', () => {
      const hash1 = hashPrediction('It will rain tomorrow');
      const hash2 = hashPrediction('It will be sunny tomorrow');
      
      assert.notStrictEqual(hash1, hash2);
    });
  });

  describe('createCommit', () => {
    it('should create a signed commit record', () => {
      const keypair = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 86400000; // 24 hours
      
      const commit = createCommit(
        keypair.publicKey,
        keypair.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      assert.strictEqual(commit.agent, keypair.publicKey);
      assert.strictEqual(commit.domain, 'weather_forecast');
      assert.strictEqual(commit.commitment, hashPrediction(prediction));
      assert.strictEqual(commit.expiry, commit.timestamp + expiryMs);
      assert.ok(commit.signature);
      assert.ok(commit.id);
    });
  });

  describe('createReveal', () => {
    it('should create a signed reveal record', () => {
      const keypair = generateKeyPair();
      const commitmentId = 'commit123';
      const prediction = 'It will rain tomorrow';
      const outcome = 'rain observed';
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        commitmentId,
        prediction,
        outcome
      );
      
      assert.strictEqual(reveal.agent, keypair.publicKey);
      assert.strictEqual(reveal.commitmentId, commitmentId);
      assert.strictEqual(reveal.prediction, prediction);
      assert.strictEqual(reveal.outcome, outcome);
      assert.ok(reveal.signature);
      assert.ok(reveal.id);
    });

    it('should include optional evidence', () => {
      const keypair = generateKeyPair();
      const evidence = 'https://weather.com/api';
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        'commit123',
        'It will rain tomorrow',
        'rain observed',
        evidence
      );
      
      assert.strictEqual(reveal.evidence, evidence);
    });
  });

  describe('verifyReveal', () => {
    it('should verify a valid reveal against its commit', async () => {
      const keypair = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 1000; // 1 second
      
      const commit = createCommit(
        keypair.publicKey,
        keypair.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      // Wait for expiry
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        commit.id,
        prediction,
        'rain observed'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('should reject reveal with wrong prediction', async () => {
      const keypair = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const wrongPrediction = 'It will be sunny tomorrow';
      const expiryMs = 1000;
      
      const commit = createCommit(
        keypair.publicKey,
        keypair.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        commit.id,
        wrongPrediction,
        'rain observed'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason?.includes('hash'));
    });

    it('should reject reveal before expiry', () => {
      const keypair = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 86400000; // 24 hours
      
      const commit = createCommit(
        keypair.publicKey,
        keypair.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        commit.id,
        prediction,
        'rain observed'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason?.includes('expiry'));
    });

    it('should reject reveal with wrong commitment ID', async () => {
      const keypair = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 1000;
      
      const commit = createCommit(
        keypair.publicKey,
        keypair.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reveal = createReveal(
        keypair.publicKey,
        keypair.privateKey,
        'wrong-commit-id',
        prediction,
        'rain observed'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason?.includes('reference'));
    });

    it('should reject reveal from different agent', async () => {
      const keypair1 = generateKeyPair();
      const keypair2 = generateKeyPair();
      const prediction = 'It will rain tomorrow';
      const expiryMs = 1000;
      
      const commit = createCommit(
        keypair1.publicKey,
        keypair1.privateKey,
        'weather_forecast',
        prediction,
        expiryMs
      );
      
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      const reveal = createReveal(
        keypair2.publicKey,
        keypair2.privateKey,
        commit.id,
        prediction,
        'rain observed'
      );
      
      const result = verifyReveal(commit, reveal);
      assert.strictEqual(result.valid, false);
      assert.ok(result.reason?.includes('agent'));
    });
  });
});
