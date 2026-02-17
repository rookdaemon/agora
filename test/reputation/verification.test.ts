import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import {
  createVerification,
  createRevocation,
  validateVerification,
  validateRevocation,
} from '../../src/reputation/verification.js';

describe('Verification', () => {
  describe('createVerification', () => {
    it('should create a valid verification record', () => {
      const kp = generateKeyPair();
      const targetId = 'target-message-id';
      const domain = 'ocr';

      const verification = createVerification(
        kp.publicKey,
        kp.privateKey,
        targetId,
        domain,
        'correct',
        0.95,
      );

      assert.strictEqual(verification.verifier, kp.publicKey);
      assert.strictEqual(verification.target, targetId);
      assert.strictEqual(verification.domain, domain);
      assert.strictEqual(verification.verdict, 'correct');
      assert.strictEqual(verification.confidence, 0.95);
      assert.ok(verification.id);
      assert.ok(verification.signature);
      assert.ok(verification.timestamp > 0);
    });

    it('should include evidence when provided', () => {
      const kp = generateKeyPair();
      const evidence = 'https://example.com/verification-proof.json';

      const verification = createVerification(
        kp.publicKey,
        kp.privateKey,
        'target',
        'domain',
        'correct',
        0.9,
        evidence,
      );

      assert.strictEqual(verification.evidence, evidence);
    });

    it('should not include evidence field when not provided', () => {
      const kp = generateKeyPair();

      const verification = createVerification(
        kp.publicKey,
        kp.privateKey,
        'target',
        'domain',
        'correct',
        0.9,
      );

      assert.strictEqual(verification.evidence, undefined);
    });

    it('should support all verdict types', () => {
      const kp = generateKeyPair();

      const correct = createVerification(kp.publicKey, kp.privateKey, 't1', 'd', 'correct', 0.9);
      assert.strictEqual(correct.verdict, 'correct');

      const incorrect = createVerification(kp.publicKey, kp.privateKey, 't2', 'd', 'incorrect', 0.8);
      assert.strictEqual(incorrect.verdict, 'incorrect');

      const disputed = createVerification(kp.publicKey, kp.privateKey, 't3', 'd', 'disputed', 0.7);
      assert.strictEqual(disputed.verdict, 'disputed');
    });
  });

  describe('createRevocation', () => {
    it('should create a valid revocation record', () => {
      const kp = generateKeyPair();
      const verificationId = 'verification-to-revoke';

      const revocation = createRevocation(
        kp.publicKey,
        kp.privateKey,
        verificationId,
        'discovered_error',
      );

      assert.strictEqual(revocation.verifier, kp.publicKey);
      assert.strictEqual(revocation.verificationId, verificationId);
      assert.strictEqual(revocation.reason, 'discovered_error');
      assert.ok(revocation.id);
      assert.ok(revocation.signature);
      assert.ok(revocation.timestamp > 0);
    });

    it('should include evidence when provided', () => {
      const kp = generateKeyPair();
      const evidence = 'https://example.com/revocation-reason.json';

      const revocation = createRevocation(
        kp.publicKey,
        kp.privateKey,
        'verification-id',
        'fraud_detected',
        evidence,
      );

      assert.strictEqual(revocation.evidence, evidence);
    });

    it('should support all reason types', () => {
      const kp = generateKeyPair();

      const reasons = ['discovered_error', 'fraud_detected', 'methodology_flawed', 'other'] as const;
      
      for (const reason of reasons) {
        const revocation = createRevocation(kp.publicKey, kp.privateKey, 'vid', reason);
        assert.strictEqual(revocation.reason, reason);
      }
    });
  });

  describe('validateVerification', () => {
    it('should validate a valid verification record', () => {
      const kp = generateKeyPair();
      const verification = createVerification(
        kp.publicKey,
        kp.privateKey,
        'target',
        'domain',
        'correct',
        0.95,
      );

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject non-object values', () => {
      const result = validateVerification(null);
      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.length > 0);
    });

    it('should reject verification without id', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).id;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('id')));
    });

    it('should reject verification without verifier', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).verifier;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('verifier')));
    });

    it('should reject verification without target', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).target;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('target')));
    });

    it('should reject verification without domain', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).domain;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('domain')));
    });

    it('should reject verification with invalid verdict', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      (verification as { verdict: string }).verdict = 'invalid';

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('verdict')));
    });

    it('should reject verification with confidence out of range', () => {
      const kp = generateKeyPair();
      const verification1 = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      (verification1 as { confidence: number }).confidence = 1.5;

      const result1 = validateVerification(verification1);
      assert.strictEqual(result1.valid, false);
      assert.ok(result1.errors.some(e => e.includes('confidence')));

      const verification2 = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      (verification2 as { confidence: number }).confidence = -0.1;

      const result2 = validateVerification(verification2);
      assert.strictEqual(result2.valid, false);
      assert.ok(result2.errors.some(e => e.includes('confidence')));
    });

    it('should reject verification without timestamp', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).timestamp;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('timestamp')));
    });

    it('should reject verification without signature', () => {
      const kp = generateKeyPair();
      const verification = createVerification(kp.publicKey, kp.privateKey, 't', 'd', 'correct', 0.9);
      delete (verification as Partial<typeof verification>).signature;

      const result = validateVerification(verification);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('signature')));
    });
  });

  describe('validateRevocation', () => {
    it('should validate a valid revocation record', () => {
      const kp = generateKeyPair();
      const revocation = createRevocation(kp.publicKey, kp.privateKey, 'vid', 'discovered_error');

      const result = validateRevocation(revocation);

      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.errors.length, 0);
    });

    it('should reject revocation without verificationId', () => {
      const kp = generateKeyPair();
      const revocation = createRevocation(kp.publicKey, kp.privateKey, 'vid', 'discovered_error');
      delete (revocation as Partial<typeof revocation>).verificationId;

      const result = validateRevocation(revocation);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('verificationId')));
    });

    it('should reject revocation with invalid reason', () => {
      const kp = generateKeyPair();
      const revocation = createRevocation(kp.publicKey, kp.privateKey, 'vid', 'discovered_error');
      (revocation as { reason: string }).reason = 'invalid_reason';

      const result = validateRevocation(revocation);

      assert.strictEqual(result.valid, false);
      assert.ok(result.errors.some(e => e.includes('reason')));
    });
  });
});
