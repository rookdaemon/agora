import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair';
import {
  createEnvelope,
  verifyEnvelope,
  canonicalize,
  computeId,
  type Envelope,
  type MessageType,
} from '../src/message/envelope';

describe('Envelope', () => {
  describe('canonicalize', () => {
    it('should produce deterministic output', () => {
      const a = canonicalize('announce', 'abc', ['peer1'], 1000, { name: 'test' });
      const b = canonicalize('announce', 'abc', ['peer1'], 1000, { name: 'test' });
      assert.strictEqual(a, b);
    });

    it('should produce different output for different inputs', () => {
      const a = canonicalize('announce', 'abc', ['peer1'], 1000, { name: 'test' });
      const b = canonicalize('announce', 'abc', ['peer1'], 1001, { name: 'test' });
      assert.notStrictEqual(a, b);
    });

    it('should include inReplyTo when provided', () => {
      const a = canonicalize('response', 'abc', ['peer1'], 1000, {}, 'someid');
      assert.ok(a.includes('inReplyTo'));
    });

    it('should not include inReplyTo when undefined', () => {
      const a = canonicalize('announce', 'abc', ['peer1'], 1000, {});
      assert.ok(!a.includes('inReplyTo'));
    });
  });

  describe('createEnvelope', () => {
    it('should create a valid signed envelope', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { capability: 'code-review' }, Date.now(), undefined, ['peer1']);

      assert.strictEqual(env.type, 'announce');
      assert.strictEqual(env.from, kp.publicKey);
      assert.deepStrictEqual(env.to, ['peer1']);
      assert.ok(env.id);
      assert.ok(env.signature);
      assert.ok(env.timestamp > 0);
      assert.deepStrictEqual(env.payload, { capability: 'code-review' });
    });

    it('should create an envelope with inReplyTo', () => {
      const kp = generateKeyPair();
      const original = createEnvelope('request', kp.publicKey, kp.privateKey, { query: 'help' }, Date.now(), undefined, ['peer1']);
      const reply = createEnvelope('response', kp.publicKey, kp.privateKey, { answer: 'yes' }, 1000000000, original.id, ['peer1']);

      assert.strictEqual(reply.inReplyTo, original.id);
    });

    it('should not include inReplyTo when not provided', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, {}, Date.now(), undefined, ['peer1']);

      assert.strictEqual(env.inReplyTo, undefined);
      assert.ok(!('inReplyTo' in env));
    });

    it('should generate content-addressed IDs', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { x: 1 }, Date.now(), undefined, ['peer1']);

      // Recompute expected ID
      const canonical = canonicalize(env.type, env.from, env.to, env.timestamp, env.payload);
      const expectedId = computeId(canonical);
      assert.strictEqual(env.id, expectedId);
    });
  });

  describe('verifyEnvelope', () => {
    it('should verify a valid envelope', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { test: true }, Date.now(), undefined, ['peer1']);

      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(result.reason, undefined);
    });

    it('should verify an envelope with inReplyTo', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('response', kp.publicKey, kp.privateKey, { data: 42 }, 1000000000, 'abc123', ['peer1']);

      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, true);
    });

    it('should reject a tampered payload', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { honest: true }, Date.now(), undefined, ['peer1']);

      // Tamper with payload
      const tampered: Envelope = { ...env, payload: { honest: false } };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });

    it('should reject a tampered ID', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 }, Date.now(), undefined, ['peer1']);

      const tampered: Envelope = { ...env, id: 'deadbeef'.repeat(8) };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'id_mismatch');
    });

    it('should reject a forged signature', () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const env = createEnvelope('announce', kp1.publicKey, kp1.privateKey, { claim: 'mine' }, Date.now(), undefined, ['peer1']);

      // Replace signature with one from a different key
      const forgedEnv = createEnvelope('announce', kp1.publicKey, kp2.privateKey, { claim: 'mine' }, Date.now(), undefined, ['peer1']);
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
      const env = createEnvelope('announce', real.publicKey, impersonator.privateKey, { trust: 'me' }, Date.now(), undefined, ['peer1']);
      const result = verifyEnvelope(env);
      assert.strictEqual(result.valid, false);
      assert.strictEqual(result.reason, 'signature_invalid');
    });

    it('should reject tampered timestamp', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 }, Date.now(), undefined, ['peer1']);

      const tampered: Envelope = { ...env, timestamp: env.timestamp + 1 };
      const result = verifyEnvelope(tampered);
      assert.strictEqual(result.valid, false);
    });

    it('should reject tampered type', () => {
      const kp = generateKeyPair();
      const env = createEnvelope('announce', kp.publicKey, kp.privateKey, { data: 1 }, Date.now(), undefined, ['peer1']);

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
      }, Date.now(), undefined, [bob.publicKey]);

      // Bob receives and verifies it — no shared secret needed
      const result = verifyEnvelope(message);
      assert.strictEqual(result.valid, true);
      assert.strictEqual(message.from, alice.publicKey);
      assert.notStrictEqual(message.from, bob.publicKey);
    });
  });
});
