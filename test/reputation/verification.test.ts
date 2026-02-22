/**
 * Tests for verification records
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair';
import { createVerification, verifyVerificationSignature } from '../../src/reputation/verification';

describe('Verification', () => {
  describe('createVerification', () => {
    it('should create a signed verification record', () => {
      const keypair = generateKeyPair();
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      assert.strictEqual(verification.verifier, keypair.publicKey);
      assert.strictEqual(verification.target, 'target123');
      assert.strictEqual(verification.domain, 'ocr');
      assert.strictEqual(verification.verdict, 'correct');
      assert.strictEqual(verification.confidence, 0.95);
      assert.ok(verification.signature);
      assert.ok(verification.id);
      assert.ok(verification.timestamp);
    });

    it('should include optional evidence', () => {
      const keypair = generateKeyPair();
      const evidence = 'https://example.com/evidence';
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000,
        evidence
      );
      
      assert.strictEqual(verification.evidence, evidence);
    });

    it('should support all verdict types', () => {
      const keypair = generateKeyPair();
      
      const timestamp = 1000000000;
      const correct = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target1',
        'ocr',
        'correct',
        0.9,
        timestamp
      );
      assert.strictEqual(correct.verdict, 'correct');
      
      const incorrect = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target2',
        'ocr',
        'incorrect',
        0.8,
        timestamp
      );
      assert.strictEqual(incorrect.verdict, 'incorrect');
      
      const disputed = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target3',
        'ocr',
        'disputed',
        0.5,
        timestamp
      );
      assert.strictEqual(disputed.verdict, 'disputed');
    });

    it('should reject confidence out of range', () => {
      const keypair = generateKeyPair();
      
      assert.throws(() => {
        createVerification(
          keypair.publicKey,
          keypair.privateKey,
          'target123',
          'ocr',
          'correct',
          1.5,
          1000000000
        );
      }, /confidence must be between 0 and 1/);
      
      assert.throws(() => {
        createVerification(
          keypair.publicKey,
          keypair.privateKey,
          'target123',
          'ocr',
          'correct',
          -0.1,
          1000000000
        );
      }, /confidence must be between 0 and 1/);
    });
  });

  describe('verifyVerificationSignature', () => {
    it('should verify a valid verification signature', () => {
      const keypair = generateKeyPair();
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      const result = verifyVerificationSignature(verification);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('should reject verification with tampered target', () => {
      const keypair = generateKeyPair();
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      // Tamper with the target
      verification.target = 'tampered_target';
      
      const result = verifyVerificationSignature(verification);
      assert.strictEqual(result.valid, false);
    });

    it('should reject verification with tampered verdict', () => {
      const keypair = generateKeyPair();
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000
      );
      
      // Tamper with the verdict
      verification.verdict = 'incorrect';
      
      const result = verifyVerificationSignature(verification);
      assert.strictEqual(result.valid, false);
    });

    it('should verify record with evidence', () => {
      const keypair = generateKeyPair();
      
      const verification = createVerification(
        keypair.publicKey,
        keypair.privateKey,
        'target123',
        'ocr',
        'correct',
        0.95,
        1000000000,
        'https://example.com/evidence'
      );
      
      const result = verifyVerificationSignature(verification);
      assert.strictEqual(result.valid, true);
    });
  });
});
