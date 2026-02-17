import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { createCommit, createReveal } from '../../src/reputation/commit-reveal.js';
import { ReputationStore } from '../../src/reputation/store.js';
import type { RevocationRecord } from '../../src/reputation/types.js';

describe('ReputationStore', () => {
  const testStorePath = join('/tmp', `test-reputation-${Date.now()}.jsonl`);
  
  afterEach(() => {
    // Clean up test file
    if (existsSync(testStorePath)) {
      unlinkSync(testStorePath);
    }
  });
  
  describe('constructor', () => {
    it('should create store with custom path', () => {
      const store = new ReputationStore(testStorePath);
      assert.ok(existsSync(testStorePath));
    });
    
    it('should create store with default path', () => {
      // Just test that it doesn't throw
      const store = new ReputationStore();
      assert.ok(store);
    });
  });
  
  describe('appendVerification', () => {
    it('should append verification to store', () => {
      const store = new ReputationStore(testStorePath);
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      store.appendVerification(verification);
      
      const verifications = store.getVerifications();
      assert.strictEqual(verifications.length, 1);
      assert.deepStrictEqual(verifications[0], verification);
    });
    
    it('should append multiple verifications', () => {
      const store = new ReputationStore(testStorePath);
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-1',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        'target-2',
        'code_review',
        'incorrect',
        0.8,
      );
      
      store.appendVerification(v1);
      store.appendVerification(v2);
      
      const verifications = store.getVerifications();
      assert.strictEqual(verifications.length, 2);
    });
  });
  
  describe('appendCommit', () => {
    it('should append commit to store', () => {
      const store = new ReputationStore(testStorePath);
      const agent = generateKeyPair();
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'It will rain',
        1000,
      );
      
      store.appendCommit(commit);
      
      const commits = store.getCommits();
      assert.strictEqual(commits.length, 1);
      assert.deepStrictEqual(commits[0], commit);
    });
  });
  
  describe('appendReveal', () => {
    it('should append reveal to store', () => {
      const store = new ReputationStore(testStorePath);
      const agent = generateKeyPair();
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        'commit-123',
        'prediction',
        'outcome',
      );
      
      store.appendReveal(reveal);
      
      const reveals = store.getReveals();
      assert.strictEqual(reveals.length, 1);
      assert.deepStrictEqual(reveals[0], reveal);
    });
  });
  
  describe('appendRevocation', () => {
    it('should append revocation to store', () => {
      const store = new ReputationStore(testStorePath);
      const verifier = generateKeyPair();
      
      const revocation: RevocationRecord = {
        id: 'revocation-123',
        verifier: verifier.publicKey,
        verificationId: 'verification-123',
        reason: 'discovered_error',
        timestamp: Date.now(),
        signature: 'sig',
      };
      
      store.appendRevocation(revocation);
      
      const revocations = store.getRevocations();
      assert.strictEqual(revocations.length, 1);
      assert.deepStrictEqual(revocations[0], revocation);
    });
  });
  
  describe('readAll', () => {
    it('should read all records from store', () => {
      const store = new ReputationStore(testStorePath);
      const agent = generateKeyPair();
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      store.appendVerification(verification);
      store.appendCommit(commit);
      
      const all = store.readAll();
      assert.strictEqual(all.length, 2);
      assert.strictEqual(all[0].type, 'verification');
      assert.strictEqual(all[1].type, 'commit');
    });
    
    it('should return empty array for empty store', () => {
      const store = new ReputationStore(testStorePath);
      const all = store.readAll();
      assert.strictEqual(all.length, 0);
    });
  });
  
  describe('persistence', () => {
    it('should persist data across store instances', () => {
      const store1 = new ReputationStore(testStorePath);
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      store1.appendVerification(verification);
      
      // Create new store instance with same path
      const store2 = new ReputationStore(testStorePath);
      const verifications = store2.getVerifications();
      
      assert.strictEqual(verifications.length, 1);
      assert.deepStrictEqual(verifications[0], verification);
    });
  });
  
  describe('getVerificationsForTarget', () => {
    it('should get verifications for specific target', () => {
      const store = new ReputationStore(testStorePath);
      const verifier = generateKeyPair();
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-1',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-2',
        'ocr',
        'correct',
        0.95,
      );
      
      store.appendVerification(v1);
      store.appendVerification(v2);
      
      const results = store.getVerificationsForTarget('target-1');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].target, 'target-1');
    });
  });
  
  describe('getVerificationsByVerifier', () => {
    it('should get verifications by verifier', () => {
      const store = new ReputationStore(testStorePath);
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target-1',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        'target-2',
        'ocr',
        'correct',
        0.95,
      );
      
      store.appendVerification(v1);
      store.appendVerification(v2);
      
      const results = store.getVerificationsByVerifier(verifier1.publicKey);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].verifier, verifier1.publicKey);
    });
    
    it('should filter by domain when provided', () => {
      const store = new ReputationStore(testStorePath);
      const verifier = generateKeyPair();
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-1',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-2',
        'code_review',
        'correct',
        0.95,
      );
      
      store.appendVerification(v1);
      store.appendVerification(v2);
      
      const results = store.getVerificationsByVerifier(verifier.publicKey, 'ocr');
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].domain, 'ocr');
    });
  });
  
  describe('getCommitById', () => {
    it('should get commit by ID', () => {
      const store = new ReputationStore(testStorePath);
      const agent = generateKeyPair();
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      store.appendCommit(commit);
      
      const result = store.getCommitById(commit.id);
      assert.ok(result !== null);
      assert.deepStrictEqual(result, commit);
    });
    
    it('should return null for non-existent commit', () => {
      const store = new ReputationStore(testStorePath);
      const result = store.getCommitById('non-existent');
      assert.strictEqual(result, null);
    });
  });
  
  describe('getRevealForCommit', () => {
    it('should get reveal for commit', () => {
      const store = new ReputationStore(testStorePath);
      const agent = generateKeyPair();
      
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000,
      );
      
      const reveal = createReveal(
        agent.publicKey,
        agent.privateKey,
        commit.id,
        'prediction',
        'outcome',
      );
      
      store.appendCommit(commit);
      store.appendReveal(reveal);
      
      const result = store.getRevealForCommit(commit.id);
      assert.ok(result !== null);
      assert.deepStrictEqual(result, reveal);
    });
    
    it('should return null for commit without reveal', () => {
      const store = new ReputationStore(testStorePath);
      const result = store.getRevealForCommit('non-existent');
      assert.strictEqual(result, null);
    });
  });
});
