import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createVerification,
  validateVerification,
  computeVerificationId,
} from '../../src/reputation/verification.js';

describe('Verification', () => {
  describe('createVerification', () => {
    it('should create a valid verification record', () => {
      const verifier = generateKeyPair();
      const targetId = 'target_message_id_123';
      
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        targetId,
        'code_review',
        'correct',
        0.95
      );
      
      assert.strictEqual(record.verifier, verifier.publicKey);
      assert.strictEqual(record.target, targetId);
      assert.strictEqual(record.domain, 'code_review');
      assert.strictEqual(record.verdict, 'correct');
      assert.strictEqual(record.confidence, 0.95);
      assert.ok(record.id);
      assert.ok(record.signature);
      assert.ok(record.timestamp > 0);
      assert.strictEqual(record.evidence, undefined);
    });
    
    it('should create verification with evidence', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'ocr',
        'correct',
        0.9,
        'https://example.com/evidence'
      );
      
      assert.strictEqual(record.evidence, 'https://example.com/evidence');
    });
    
    it('should throw on confidence < 0', () => {
      const verifier = generateKeyPair();
      assert.throws(() => {
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          'target_123',
          'ocr',
          'correct',
          -0.1
        );
      }, /Confidence must be between 0 and 1/);
    });
    
    it('should throw on confidence > 1', () => {
      const verifier = generateKeyPair();
      assert.throws(() => {
        createVerification(
          verifier.publicKey,
          verifier.privateKey,
          'target_123',
          'ocr',
          'correct',
          1.5
        );
      }, /Confidence must be between 0 and 1/);
    });
    
    it('should accept confidence at boundaries', () => {
      const verifier = generateKeyPair();
      
      const record0 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'ocr',
        'correct',
        0
      );
      assert.strictEqual(record0.confidence, 0);
      
      const record1 = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_456',
        'ocr',
        'correct',
        1
      );
      assert.strictEqual(record1.confidence, 1);
    });
    
    it('should support all verdict types', () => {
      const verifier = generateKeyPair();
      
      const correct = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_1',
        'ocr',
        'correct',
        0.9
      );
      assert.strictEqual(correct.verdict, 'correct');
      
      const incorrect = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_2',
        'ocr',
        'incorrect',
        0.8
      );
      assert.strictEqual(incorrect.verdict, 'incorrect');
      
      const disputed = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_3',
        'ocr',
        'disputed',
        0.5
      );
      assert.strictEqual(disputed.verdict, 'disputed');
    });
    
    it('should generate deterministic IDs', () => {
      const verifier = generateKeyPair();
      
      // Create two records with same parameters at same timestamp
      const timestamp = Date.now();
      const makeRecord = (): string => {
        const record = createVerification(
          verifier.publicKey,
          verifier.privateKey,
          'target_123',
          'ocr',
          'correct',
          0.95
        );
        // Override timestamp for determinism
        (record as { timestamp: number }).timestamp = timestamp;
        // Recompute ID
        const canonical = JSON.stringify({
          confidence: record.confidence,
          domain: record.domain,
          target: record.target,
          timestamp: record.timestamp,
          verdict: record.verdict,
          verifier: record.verifier,
        });
        return computeVerificationId(canonical);
      };
      
      // IDs should be the same
      assert.strictEqual(makeRecord(), makeRecord());
    });
  });
  
  describe('validateVerification', () => {
    it('should validate a valid verification', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9
      );
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });
    
    it('should reject verification with invalid signature', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9
      );
      
      // Tamper with signature
      record.signature = '0'.repeat(128);
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });
    
    it('should reject verification with tampered ID', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9
      );
      
      // Tamper with ID
      record.id = 'fake_id';
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });
    
    it('should reject verification with confidence out of range', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9
      );
      
      // Tamper with confidence
      (record as { confidence: number }).confidence = 1.5;
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'confidence_out_of_range');
    });
    
    it('should reject verification with invalid verdict', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9
      );
      
      // Tamper with verdict
      (record as { verdict: string }).verdict = 'invalid' as 'correct';
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'invalid_verdict');
    });
    
    it('should validate verification with evidence', () => {
      const verifier = generateKeyPair();
      const record = createVerification(
        verifier.publicKey,
        verifier.privateKey,
        'target_123',
        'code_review',
        'correct',
        0.9,
        'https://example.com/evidence'
      );
      
      const result = validateVerification(record);
      assert.strictEqual(result.valid, true);
    });
  });
});
