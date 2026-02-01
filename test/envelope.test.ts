import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import {
  createEnvelope,
  verifyEnvelope,
  canonicalize,
  computeId,
  type Envelope,
  type MessageType,
} from '../src/message/envelope.js';

describe('Envelope', () => {
  describe('canonicalize', () => {
    it('should produce deterministic output', () => {
      const a = canonicalize('announce', 'abc', 1000, { name: 'test' });
      const b = canonicalize('announce', 'abc', 1000, { name: 'test' });
      assert.strictEqual(a, b);
    });

    it('should produce different output for different inputs', () => {
      const a = canonicalize('announce', 'abc', 1000, { name: 'test' });
      const b = canonicalize('announce', 'abc', 1001, { name: 'test' });
      assert.notStrictEqual(a, b);
    });

    it('should include inReplyTo when provided', () => {
      const a = canonicalize('response', 'abc', 1000, {}, 'someid');
      assert.ok(a.includes('inReplyTo'));
    });

    it('should not include inReplyTo when undefined', () => {
      const a = canonicalize('announce', 'abc', 1000, {});
      assert.ok(!a.includes('inReplyTo'));
    });
  });

  describe('createEnvelope', () => {
    it('should create a valid signed envelope', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { capability: 'code-review' });

      assert.strictEqual(env.type, 'announce');
      assert.strictEqual(env.sender, kp.publicKey);
      assert.ok(env.id);
      assert.ok(env.signature);
      assert.ok(env.timestamp > 0);
      assert.deepStrictEqual(env.payload, { capability: 'code-review' });
    });

    it('should create an envelope with inReplyTo', () => {
      const kp = generateKeyPair();
      const original = createEnvelope('request', kp.publicKey, kp.privateKey, { query: 'help' });
      const reply = createEnvelope('response', kp.publicKey, kp.privateKey, { answer: 'yes' }, original.id);

      assert.strictEqual(reply.inReplyTo, original.id);
    });

    it('should not include inReplyTo when not provided', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, {});

      assert.strictEqual(env.inReplyTo, undefined);
      assert.ok(!('inReplyTo' in env));
    });

    it('should generate content-addressed IDs', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { x: 1 });

      // Recompute expected ID
      const canonical = canonicalize(env.type, env.sender, env.timestamp, env.payload);
      const expectedId = computeId(canonical);
      assert.strictEqual(env.id, expectedId);
    });
  });

  describe('verifyEnvelope', () => {
    it('should verify a valid envelope', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { test: true });

      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('should verify an envelope with inReplyTo', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('response', kp.publicKey, kp.privateKey, { data: 42 }, 'abc123');

      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, true);
    });

    it('should reject a tampered payload', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { honest: true });

      // Tamper with payload
      const tampered: Envelope = { ...env, payload: { honest: false } };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });

    it('should reject a tampered ID', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 });

      const tampered: Envelope = { ...env, id: 'deadbeef'.repeat(8) };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });

    it('should reject a forged signature', () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const env = createEnvelope('announce', kp1.publicKey, kp1.privateKey, { claim: 'mine' });

      // Replace signature with one from a different key
      const forgedEnv = createEnvelope('announce', kp1.publicKey, kp2.privateKey, { claim: 'mine' });
      // Manually set the correct ID but wrong signature
      const tampered: Envelope = { ...env, signature: forgedEnv.signature };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });

    it('should reject impersonation (wrong sender key)', () => {
      const real = generateKeyPair();
      const impersonator = generateKeyPair();

      // Impersonator creates message claiming to be real agent
      const env = createEnvelope('announce', real.publicKey, impersonator.privateKey, { trust: 'me' });
      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });

    it('should reject tampered timestamp', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 });

      const tampered: Envelope = { ...env, timestamp: env.timestamp + 1 };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
    });

    it('should reject tampered type', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 });

      const tampered: Envelope = { ...env, type: 'request' as MessageType };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
    });
  });

  describe('cross-agent verification', () => {
    it('should allow one agent to verify another agents message', () => {
      const alice = generateKeyPair();
      const bob = generateKeyPair();

      // Alice creates a message
      const message = createEnvelope('publish', alice.publicKey, alice.privateKey, {
        claim: 'The sky is blue',
        domain: 'weather',
      });

      // Bob receives and verifies it — no shared secret needed
      const result = verifyEnvelope(message);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(message.sender, alice.publicKey);
      assert.notStrictEqual(message.sender, bob.publicKey);
    });
  });
});
