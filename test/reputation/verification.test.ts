import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createVerification,
  validateVerification,
  verifyVerification,
} from '../../src/reputation/verification.js';

describe('Verification', () => {
  describe('createVerification', () => {
    it('should create a valid verification record', () => {
      const verifierKeys = generateKeyPair();
      const targetId = 'target-message-id';
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        targetId,
        'code_review',
        'correct',
        0.95
      );
      
      assert.strictEqual(verification.verifier, verifierKeys.publicKey);
      assert.strictEqual(verification.target, targetId);
      assert.strictEqual(verification.domain, 'code_review');
      assert.strictEqual(verification.verdict, 'correct');
      assert.strictEqual(verification.confidence, 0.95);
      assert.ok(verification.id);
      assert.ok(verification.signature);
      assert.ok(verification.timestamp);
    });
    
    it('should include optional evidence field', () => {
      const verifierKeys = generateKeyPair();
      const targetId = 'target-message-id';
      const evidenceHash = 'evidence-hash-abc123';
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        targetId,
        'ocr',
        'correct',
        0.88,
        evidenceHash
      );
      
      assert.strictEqual(verification.evidence, evidenceHash);
    });
    
    it('should throw error if confidence is out of range', () => {
      const verifierKeys = generateKeyPair();
      
      assert.throws(
        () => createVerification(
          verifierKeys.publicKey,
          verifierKeys.privateKey,
          'target',
          'domain',
          'correct',
          1.5
        ),
        /Confidence must be between 0 and 1/
      );
      
      assert.throws(
        () => createVerification(
          verifierKeys.publicKey,
          verifierKeys.privateKey,
          'target',
          'domain',
          'correct',
          -0.1
        ),
        /Confidence must be between 0 and 1/
      );
    });
    
    it('should generate content-addressed ID', () => {
      const verifierKeys = generateKeyPair();
      
      const v1 = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target1',
        'domain',
        'correct',
        0.9
      );
      
      const v2 = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target1',
        'domain',
        'correct',
        0.9
      );
      
      // IDs should be different (different timestamps)
      assert.notStrictEqual(v1.id, v2.id);
    });
  });
  
  describe('validateVerification', () => {
    it('should validate a valid verification record', () => {
      const verifierKeys = generateKeyPair();
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      const errors = validateVerification(verification);
      assert.strictEqual(errors.length, 0);
    });
    
    it('should reject non-object values', () => {
      const errors = validateVerification(null);
      assert.ok(errors.length > 0);
      assert.ok(errors[0].includes('must be an object'));
    });
    
    it('should reject missing required fields', () => {
      const errors = validateVerification({});
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('id')));
      assert.ok(errors.some(e => e.includes('verifier')));
      assert.ok(errors.some(e => e.includes('target')));
      assert.ok(errors.some(e => e.includes('domain')));
      assert.ok(errors.some(e => e.includes('verdict')));
      assert.ok(errors.some(e => e.includes('confidence')));
      assert.ok(errors.some(e => e.includes('timestamp')));
      assert.ok(errors.some(e => e.includes('signature')));
    });
    
    it('should reject invalid verdict', () => {
      const verifierKeys = generateKeyPair();
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'domain',
        'correct',
        0.9
      );
      
      (verification as unknown as { verdict: string }).verdict = 'invalid';
      
      const errors = validateVerification(verification);
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('verdict')));
    });
    
    it('should reject invalid confidence values', () => {
      const verifierKeys = generateKeyPair();
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'domain',
        'correct',
        0.9
      );
      
      (verification as unknown as { confidence: number }).confidence = 1.5;
      
      const errors = validateVerification(verification);
      assert.ok(errors.length > 0);
      assert.ok(errors.some(e => e.includes('confidence')));
    });
  });
  
  describe('verifyVerification', () => {
    it('should verify a valid verification record', () => {
      const verifierKeys = generateKeyPair();
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      const isValid = verifyVerification(verification);
      assert.strictEqual(isValid, true);
    });
    
    it('should reject tampered payload', () => {
      const verifierKeys = generateKeyPair();
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      // Tamper with the verdict
      (verification as unknown as { verdict: string }).verdict = 'incorrect';
      
      const isValid = verifyVerification(verification);
      assert.strictEqual(isValid, false);
    });
    
    it('should reject tampered ID', () => {
      const verifierKeys = generateKeyPair();
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      // Tamper with the ID
      verification.id = 'fake-id-123';
      
      const isValid = verifyVerification(verification);
      assert.strictEqual(isValid, false);
    });
    
    it('should reject forged signature', () => {
      const verifierKeys = generateKeyPair();
      const attackerKeys = generateKeyPair();
      
      const verification = createVerification(
        verifierKeys.publicKey,
        verifierKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      
      // Replace signature with attacker's signature
      const fakeVerification = createVerification(
        attackerKeys.publicKey,
        attackerKeys.privateKey,
        'target',
        'code_review',
        'correct',
        0.95
      );
      verification.signature = fakeVerification.signature;
      
      const isValid = verifyVerification(verification);
      assert.strictEqual(isValid, false);
    });
  });
});
