import { describe, it } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { createVerification } from '../../src/reputation/verification.js';
import { createCommit, createReveal } from '../../src/reputation/commit-reveal.js';
import { ReputationStore } from '../../src/reputation/store.js';

describe('ReputationStore', () => {
  // Helper to create temporary directory for each test
  function createTempStore(): { store: ReputationStore; cleanup: () => void } {
    const tempDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
    const filePath = join(tempDir, 'reputation.jsonl');
    const store = new ReputationStore({ filePath });
    
    return {
      store,
      cleanup: () => rmSync(tempDir, { recursive: true, force: true })
    };
  }
  
  describe('append and readAll', () => {
    it('should append and read verification records', () => {
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
          0.95
        );
        
        store.append({ type: 'verification', data: verification });
        
        const records = store.readAll();
        assert.strictEqual(records.length, 1);
        assert.strictEqual(records[0].type, 'verification');
        assert.strictEqual((records[0].data as typeof verification).id, verification.id);
      } finally {
        cleanup();
      }
    });
    
    it('should append multiple records', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        
        const records = store.readAll();
        assert.strictEqual(records.length, 2);
      } finally {
        cleanup();
      }
    });
    
    it('should handle empty store', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const records = store.readAll();
        assert.strictEqual(records.length, 0);
      } finally {
        cleanup();
      }
    });
    
    it('should persist across store instances', () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'agora-test-'));
      const filePath = join(tempDir, 'reputation.jsonl');
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        // Write with first instance
        {
          const store1 = new ReputationStore({ filePath });
          const verification = createVerification(
            verifier.publicKey,
            verifier.privateKey,
            agent.publicKey,
            'ocr',
            'correct',
            0.9
          );
          store1.append({ type: 'verification', data: verification });
        }
        
        // Read with second instance
        {
          const store2 = new ReputationStore({ filePath });
          const records = store2.readAll();
          assert.strictEqual(records.length, 1);
        }
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
  
  describe('getVerifications', () => {
    it('should get all verification records', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const commit = createCommit(
          agent.publicKey,
          agent.privateKey,
          'weather',
          'prediction'
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'commit', data: commit });
        store.append({ type: 'verification', data: v2 });
        
        const verifications = store.getVerifications();
        assert.strictEqual(verifications.length, 2);
        assert.strictEqual(verifications[0].id, v1.id);
        assert.strictEqual(verifications[1].id, v2.id);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('getVerificationsForAgent', () => {
    it('should filter verifications by agent', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent1 = generateKeyPair();
        const agent2 = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent1.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent2.publicKey,
          'ocr',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        
        const agent1Verifications = store.getVerificationsForAgent(agent1.publicKey);
        assert.strictEqual(agent1Verifications.length, 1);
        assert.strictEqual(agent1Verifications[0].target, agent1.publicKey);
      } finally {
        cleanup();
      }
    });
    
    it('should filter verifications by agent and domain', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        
        const ocrVerifications = store.getVerificationsForAgent(agent.publicKey, 'ocr');
        assert.strictEqual(ocrVerifications.length, 1);
        assert.strictEqual(ocrVerifications[0].domain, 'ocr');
      } finally {
        cleanup();
      }
    });
  });
  
  describe('commit and reveal operations', () => {
    it('should store and retrieve commits', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const commit = createCommit(
          agent.publicKey,
          agent.privateKey,
          'weather',
          'prediction'
        );
        
        store.append({ type: 'commit', data: commit });
        
        const commits = store.getCommits();
        assert.strictEqual(commits.length, 1);
        assert.strictEqual(commits[0].id, commit.id);
      } finally {
        cleanup();
      }
    });
    
    it('should get commit by ID', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const commit = createCommit(
          agent.publicKey,
          agent.privateKey,
          'weather',
          'prediction'
        );
        
        store.append({ type: 'commit', data: commit });
        
        const retrieved = store.getCommitById(commit.id);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.id, commit.id);
      } finally {
        cleanup();
      }
    });
    
    it('should store and retrieve reveals', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          'commit_id_123',
          'prediction',
          'outcome'
        );
        
        store.append({ type: 'reveal', data: reveal });
        
        const reveals = store.getReveals();
        assert.strictEqual(reveals.length, 1);
        assert.strictEqual(reveals[0].id, reveal.id);
      } finally {
        cleanup();
      }
    });
    
    it('should get reveal by commitment ID', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const agent = generateKeyPair();
        const commitId = 'commit_id_123';
        const reveal = createReveal(
          agent.publicKey,
          agent.privateKey,
          commitId,
          'prediction',
          'outcome'
        );
        
        store.append({ type: 'reveal', data: reveal });
        
        const retrieved = store.getRevealByCommitmentId(commitId);
        assert.ok(retrieved);
        assert.strictEqual(retrieved.commitmentId, commitId);
      } finally {
        cleanup();
      }
    });
  });
  
  describe('revocations', () => {
    it('should store and retrieve revocations', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        
        const revocation = {
          id: 'revocation_id_123',
          verifier: verifier.publicKey,
          verificationId: 'verification_id_456',
          reason: 'Found error in verification',
          timestamp: Date.now(),
          signature: 'fake_signature',
        };
        
        store.append({ type: 'revocation', data: revocation });
        
        const revocations = store.getRevocations();
        assert.strictEqual(revocations.length, 1);
        assert.strictEqual(revocations[0].id, revocation.id);
      } finally {
        cleanup();
      }
    });
    
    it('should check if verification is revoked', () => {
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
          0.9
        );
        
        store.append({ type: 'verification', data: verification });
        
        // Not revoked initially
        assert.strictEqual(store.isRevoked(verification.id), false);
        
        // Add revocation
        const revocation = {
          id: 'revocation_id_123',
          verifier: verifier.publicKey,
          verificationId: verification.id,
          reason: 'Error found',
          timestamp: Date.now(),
          signature: 'fake_signature',
        };
        
        store.append({ type: 'revocation', data: revocation });
        
        // Now revoked
        assert.strictEqual(store.isRevoked(verification.id), true);
      } finally {
        cleanup();
      }
    });
    
    it('should get active (non-revoked) verifications', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        
        // Revoke v1
        const revocation = {
          id: 'revocation_id_123',
          verifier: verifier.publicKey,
          verificationId: v1.id,
          reason: 'Error found',
          timestamp: Date.now(),
          signature: 'fake_signature',
        };
        
        store.append({ type: 'revocation', data: revocation });
        
        const activeVerifications = store.getActiveVerifications();
        assert.strictEqual(activeVerifications.length, 1);
        assert.strictEqual(activeVerifications[0].id, v2.id);
      } finally {
        cleanup();
      }
    });
    
    it('should get active verifications for agent', () => {
      const { store, cleanup } = createTempStore();
      
      try {
        const verifier = generateKeyPair();
        const agent = generateKeyPair();
        
        const v1 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'ocr',
          'correct',
          0.9
        );
        
        const v2 = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          agent.publicKey,
          'code_review',
          'correct',
          0.8
        );
        
        store.append({ type: 'verification', data: v1 });
        store.append({ type: 'verification', data: v2 });
        
        // Revoke v1
        const revocation = {
          id: 'revocation_id_123',
          verifier: verifier.publicKey,
          verificationId: v1.id,
          reason: 'Error found',
          timestamp: Date.now(),
          signature: 'fake_signature',
        };
        
        store.append({ type: 'revocation', data: revocation });
        
        const activeVerifications = store.getActiveVerificationsForAgent(agent.publicKey);
        assert.strictEqual(activeVerifications.length, 1);
        assert.strictEqual(activeVerifications[0].domain, 'code_review');
        
        const activeOcrVerifications = store.getActiveVerificationsForAgent(agent.publicKey, 'ocr');
        assert.strictEqual(activeOcrVerifications.length, 0);
      } finally {
        cleanup();
      }
    });
  });
});
