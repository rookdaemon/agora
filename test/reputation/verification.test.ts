import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createVerification,
  validateVerification,
} from '../../src/reputation/verification.js';

describe('Verification', () => {
  describe('createVerification', () => {
    it('should create a valid verification record', () => {
      const verifier = generateKeyPair();
      const targetId = 'target-message-id-123';
      const domain = 'ocr';
      const verdict = 'correct';
      const confidence = 0.95;
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        targetId,
        domain,
        verdict,
        confidence,
      );
      
      assert.strictEqual(verification.verifier, verifier.publicKey);
      assert.strictEqual(verification.target, targetId);
      assert.strictEqual(verification.domain, domain);
      assert.strictEqual(verification.verdict, verdict);
      assert.strictEqual(verification.confidence, confidence);
      assert.ok(verification.id);
      assert.ok(verification.signature);
      assert.ok(verification.timestamp > 0);
    });
    
    it('should create verification with evidence', () => {
      const verifier = generateKeyPair();
      const evidence = 'https://example.com/verification-results.json';
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'code_review',
        'incorrect',
        0.8,
        evidence,
      );
      
      assert.strictEqual(verification.evidence, evidence);
    });
    
    it('should throw error for invalid confidence', () => {
      const verifier = generateKeyPair();
      
      assert.throws(() => {
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          'target-123',
          'ocr',
          'correct',
          1.5, // Invalid: > 1
        );
      }, /Confidence must be between 0 and 1/);
      
      assert.throws(() => {
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          'target-123',
          'ocr',
          'correct',
          -0.1, // Invalid: < 0
        );
      }, /Confidence must be between 0 and 1/);
    });
    
    it('should generate deterministic IDs for same inputs', () => {
      const verifier = generateKeyPair();
      const timestamp = Date.now();
      
      // Mock Date.now to get same timestamp
      const originalDateNow = Date.now;
      Date.now = () => timestamp;
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      Date.now = originalDateNow;
      
      assert.strictEqual(v1.id, v2.id);
    });
    
    it('should generate different IDs for different targets', () => {
      const verifier = generateKeyPair();
      
      const v1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      const v2 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-456',
        'ocr',
        'correct',
        0.95,
      );
      
      assert.notStrictEqual(v1.id, v2.id);
    });
  });
  
  describe('validateVerification', () => {
    it('should validate a valid verification', () => {
      const verifier = generateKeyPair();
      
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      const result = validateVerification(verification);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors, undefined);
    });
    
    it('should reject verification with missing fields', () => {
      const result = validateVerification({
        id: 'test-id',
        verifier: 'verifier-key',
        target: 'target-123',
        domain: 'ocr',
        verdict: 'correct',
        confidence: 0.95,
        timestamp: Date.now(),
        // Missing signature
      } as any);
      
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('signature')));
    });
    
    it('should reject verification with invalid verdict', () => {
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      // Tamper with verdict
      (verification as any).verdict = 'invalid-verdict';
      
      const result = validateVerification(verification);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('verdict')));
    });
    
    it('should reject verification with invalid confidence', () => {
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      // Tamper with confidence
      verification.confidence = 1.5;
      
      const result = validateVerification(verification);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('confidence')));
    });
    
    it('should reject verification with tampered signature', () => {
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      // Tamper with signature
      verification.signature = 'invalid-signature';
      
      const result = validateVerification(verification);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('signature')));
    });
    
    it('should reject verification with tampered ID', () => {
      const verifier = generateKeyPair();
      const verification = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target-123',
        'ocr',
        'correct',
        0.95,
      );
      
      // Tamper with ID
      verification.id = 'tampered-id';
      
      const result = validateVerification(verification);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors?.some(e => e.includes('ID mismatch')));
    });
  });
});
