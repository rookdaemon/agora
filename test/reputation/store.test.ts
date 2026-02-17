import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { createCommit, createReveal } from '../../src/reputation/commit-reveal.js';
import { ReputationStore } from '../../src/reputation/store.js';

describe('ReputationStore', () => {
  describe('initialization', () => {
    it('should create directory if missing', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      
      const store = new ReputationStore(storePath);
      await store.initialize();
      
      // Directory should exist after initialization
      const verifierKeys = generateKeyPair();
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'test',
        'correct',
        1.0
      );
      
      await store.append({ type: 'verification', ...verification });
      
      const records = await store.readAll();
      assert.strictEqual(records.length, 1);
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('append and readAll', () => {
    it('should append and read verification records', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifierKeys = generateKeyPair();
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      await store.append({ type: 'verification', ...verification });
      
      const records = await store.readAll();
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].type, 'verification');
      
      const record = records[0] as { type: 'verification' } & typeof verification;
      assert.strictEqual(record.verifier, verification.verifier);
      assert.strictEqual(record.target, verification.target);
      assert.strictEqual(record.domain, verification.domain);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should append multiple records', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier1 = generateKeyPair();
      const verifier2 = generateKeyPair();
      
      const v1 = createVerification(
        verifier1.publicKey,
        verifier1.privateKey,
        'target1',
        'domain1',
        'correct',
        1.0
      );
      
      const v2 = createVerification(
        verifier2.publicKey,
        verifier2.privateKey,
        'target2',
        'domain2',
        'incorrect',
        0.8
      );
      
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      
      const records = await store.readAll();
      assert.strictEqual(records.length, 2);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should handle commits and reveals', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agentKeys = generateKeyPair();
      const commit = createCommit(
        agentKeys.publicKey,
        agentKeys.privateKey,
        'weather',
        'prediction',
        1000
      );
      
      const reveal = createReveal(
        agentKeys.publicKey,
        agentKeys.privateKey,
        commit.id,
        'prediction',
        'outcome'
      );
      
      await store.append({ type: 'commit', ...commit });
      await store.append({ type: 'reveal', ...reveal });
      
      const records = await store.readAll();
      assert.strictEqual(records.length, 2);
      assert.strictEqual(records[0].type, 'commit');
      assert.strictEqual(records[1].type, 'reveal');
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should return empty array for non-existent store', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'nonexistent.jsonl');
      const store = new ReputationStore(storePath);
      
      const records = await store.readAll();
      assert.strictEqual(records.length, 0);
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('queryVerifications', () => {
    it('should filter verifications by agent', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const agent1 = 'agent1-pubkey';
      const agent2 = 'agent2-pubkey';
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent1,
        'domain',
        'correct',
        1.0
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent2,
        'domain',
        'correct',
        1.0
      );
      
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      
      const agent1Verifications = await store.queryVerifications(agent1);
      assert.strictEqual(agent1Verifications.length, 1);
      assert.strictEqual(agent1Verifications[0].target, agent1);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should filter verifications by domain', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const verifier = generateKeyPair();
      const agent = 'agent-pubkey';
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'code_review',
        'correct',
        1.0
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        agent,
        'ocr',
        'correct',
        1.0
      );
      
      await store.append({ type: 'verification', ...v1 });
      await store.append({ type: 'verification', ...v2 });
      
      const codeReviewVerifications = await store.queryVerifications(agent, 'code_review');
      assert.strictEqual(codeReviewVerifications.length, 1);
      assert.strictEqual(codeReviewVerifications[0].domain, 'code_review');
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('queryCommits', () => {
    it('should filter commits by agent', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      
      const c1 = createCommit(
        agent1.publicKey,
        agent1.privateKey,
        'weather',
        'pred1',
        1000
      );
      
      const c2 = createCommit(
        agent2.publicKey,
        agent2.privateKey,
        'weather',
        'pred2',
        1000
      );
      
      await store.append({ type: 'commit', ...c1 });
      await store.append({ type: 'commit', ...c2 });
      
      const agent1Commits = await store.queryCommits(agent1.publicKey);
      assert.strictEqual(agent1Commits.length, 1);
      assert.strictEqual(agent1Commits[0].agent, agent1.publicKey);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should filter commits by domain', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      
      const c1 = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'pred1',
        1000
      );
      
      const c2 = createCommit(
        agent.publicKey,
        agent.privateKey,
        'stocks',
        'pred2',
        1000
      );
      
      await store.append({ type: 'commit', ...c1 });
      await store.append({ type: 'commit', ...c2 });
      
      const weatherCommits = await store.queryCommits(agent.publicKey, 'weather');
      assert.strictEqual(weatherCommits.length, 1);
      assert.strictEqual(weatherCommits[0].domain, 'weather');
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('getCommit', () => {
    it('should retrieve commit by ID', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const agent = generateKeyPair();
      const commit = createCommit(
        agent.publicKey,
        agent.privateKey,
        'weather',
        'prediction',
        1000
      );
      
      await store.append({ type: 'commit', ...commit });
      
      const retrieved = await store.getCommit(commit.id);
      assert.ok(retrieved);
      assert.strictEqual(retrieved.id, commit.id);
      assert.strictEqual(retrieved.agent, commit.agent);
      
      await rm(tmpDir, { recursive: true });
    });
    
    it('should return undefined for non-existent commit', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      const store = new ReputationStore(storePath);
      
      const retrieved = await store.getCommit('non-existent-id');
      assert.strictEqual(retrieved, undefined);
      
      await rm(tmpDir, { recursive: true });
    });
  });
  
  describe('persistence', () => {
    it('should persist across store instances', async () => {
      const tmpDir = await mkdtemp(join(tmpdir(), 'agora-test-'));
      const storePath = join(tmpDir, 'reputation.jsonl');
      
      // First instance
      const store1 = new ReputationStore(storePath);
      const verifier = generateKeyPair();
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target',
        'domain',
        'correct',
        1.0
      );
      await store1.append({ type: 'verification', ...v1 });
      
      // Second instance
      const store2 = new ReputationStore(storePath);
      const records = await store2.readAll();
      
      assert.strictEqual(records.length, 1);
      assert.strictEqual(records[0].type, 'verification');
      
      await rm(tmpDir, { recursive: true });
    });
  });
});
