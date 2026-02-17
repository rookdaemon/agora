import { describe, it, mock } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope, verifyEnvelope } from '../src/message/envelope.js';
import {
  sendToPeer,
  decodeInboundEnvelope,
  type TransportConfig,
  type PeerConfig,
} from '../src/transport/http.js';

describe('HTTP Transport', () => {
  describe('sendToPeer', () => {
    it('should return error for unknown peer', async () => {
      const identity = generateKeyPair();
      const config: TransportConfig = {
        identity,
        peers: new Map(),
      };

      const result = await sendToPeer(config, 'unknown-key', 'announce', { test: true });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.error, 'Unknown peer');
    });

    it('should construct correct envelope and POST body', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      // Mock fetch
      let capturedUrl: string | undefined;
      let capturedOptions: RequestInit | undefined;
      
      const mockFetch = mock.fn(async (url: string, options?: RequestInit) => {
        capturedUrl = url;
        capturedOptions = options;
        return new Response(null, { status: 200, statusText: 'OK' });
      });
      
      // @ts-expect-error - replacing global fetch
      global.fetch = mockFetch;

      const peer: PeerConfig = {
        url: 'http://localhost:18790/hooks',
        token: 'test-token-123',
        publicKey: peerIdentity.publicKey,
      };

      const config: TransportConfig = {
        identity,
        peers: new Map([[peerIdentity.publicKey, peer]]),
      };

      const payload = { message: 'Hello, peer!' };
      const result = await sendToPeer(config, peerIdentity.publicKey, 'request', payload);

      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.status, 200);
      assert.strictEqual(capturedUrl, 'http://localhost:18790/hooks/agent');
      assert.ok(capturedOptions);
      assert.strictEqual(capturedOptions.method, 'POST');
      
      const headers = capturedOptions.headers as Record<string, string>;
      assert.strictEqual(headers['Authorization'], 'Bearer test-token-123');
      assert.strictEqual(headers['Content-Type'], 'application/json');

      const body = JSON.parse(capturedOptions.body as string);
      assert.ok(body.message.startsWith('[AGORA_ENVELOPE]'));
      assert.strictEqual(body.name, 'Agora');
      assert.ok(body.sessionKey.startsWith('agora:'));
      assert.strictEqual(body.deliver, false);

      // Decode and verify the envelope
      const base64Part = body.message.substring('[AGORA_ENVELOPE]'.length);
      const envelopeJson = Buffer.from(base64Part, 'base64url').toString('utf-8');
      const envelope = JSON.parse(envelopeJson);
      
      assert.strictEqual(envelope.type, 'request');
      assert.strictEqual(envelope.sender, identity.publicKey);
      assert.deepStrictEqual(envelope.payload, payload);

      // Verify envelope is valid
      const verification = verifyEnvelope(envelope);
      assert.strictEqual(verification.valid, true);
    });

    it('should return error for peer with no webhook URL', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      const peer: PeerConfig = {
        publicKey: peerIdentity.publicKey,
        // no url or token — relay-only peer
      };

      const config: TransportConfig = {
        identity,
        peers: new Map([[peerIdentity.publicKey, peer]]),
      };

      const result = await sendToPeer(config, peerIdentity.publicKey, 'announce', { test: true });

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 0);
      assert.strictEqual(result.error, 'No webhook URL configured');
    });

    it('should handle network errors', async () => {
      const identity = generateKeyPair();
      const peerIdentity = generateKeyPair();

      // Mock fetch to throw error
      const mockFetch = mock.fn(async () => {
        throw new Error('Network error');
      });
      
      // @ts-expect-error - replacing global fetch
      global.fetch = mockFetch;

      const peer: PeerConfig = {
        url: 'http://localhost:18790/hooks',
        token: 'test-token',
        publicKey: peerIdentity.publicKey,
      };

      const config: TransportConfig = {
        identity,
        peers: new Map([[peerIdentity.publicKey, peer]]),
      };

      const result = await sendToPeer(config, peerIdentity.publicKey, 'announce', {});

      assert.strictEqual(result.ok, false);
      assert.strictEqual(result.status, 0);
      assert.ok(result.error?.includes('Network error'));
    });
  });

  describe('decodeInboundEnvelope', () => {
    it('should decode valid envelope', () => {
      const sender = generateKeyPair();

      const envelope = createEnvelope('request', sender.publicKey, sender.privateKey, {
        query: 'status',
      });

      const envelopeJson = JSON.stringify(envelope);
      const base64 = Buffer.from(envelopeJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      const peers = new Map<string, PeerConfig>([
        [sender.publicKey, {
          url: 'http://localhost:18789/hooks',
          token: 'token',
          publicKey: sender.publicKey,
        }],
      ]);

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.envelope.sender, sender.publicKey);
        assert.strictEqual(result.envelope.type, 'request');
        assert.deepStrictEqual(result.envelope.payload, { query: 'status' });
      }
    });

    it('should reject tampered envelope', () => {
      const sender = generateKeyPair();

      const envelope = createEnvelope('request', sender.publicKey, sender.privateKey, {
        honest: true,
      });

      // Tamper with the payload
      const tampered = { ...envelope, payload: { honest: false } };
      const envelopeJson = JSON.stringify(tampered);
      const base64 = Buffer.from(envelopeJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      const peers = new Map<string, PeerConfig>([
        [sender.publicKey, {
          url: 'http://localhost:18789/hooks',
          token: 'token',
          publicKey: sender.publicKey,
        }],
      ]);

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, 'id_mismatch');
      }
    });

    it('should reject unknown sender', () => {
      const sender = generateKeyPair();

      const envelope = createEnvelope('request', sender.publicKey, sender.privateKey, {
        data: 'test',
      });

      const envelopeJson = JSON.stringify(envelope);
      const base64 = Buffer.from(envelopeJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      // Empty peers map - sender is unknown
      const peers = new Map<string, PeerConfig>();

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, 'unknown_sender');
      }
    });

    it('should reject non-AGORA messages', () => {
      const peers = new Map<string, PeerConfig>();
      const message = 'Regular webhook message';

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, 'not_agora_message');
      }
    });

    it('should reject invalid base64', () => {
      const peers = new Map<string, PeerConfig>();
      // Use empty base64 which will decode to empty string (invalid JSON)
      const message = '[AGORA_ENVELOPE]';

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, 'invalid_base64');
      }
    });

    it('should reject invalid JSON', () => {
      const peers = new Map<string, PeerConfig>();
      const invalidJson = '{not valid json}';
      const base64 = Buffer.from(invalidJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, 'invalid_json');
      }
    });

    it('should handle round-trip: create -> encode -> decode -> verify', () => {
      const alice = generateKeyPair();

      // Alice creates an envelope
      const envelope = createEnvelope('publish', alice.publicKey, alice.privateKey, {
        topic: 'weather',
        data: 'sunny',
      });

      // Alice encodes it for transport
      const envelopeJson = JSON.stringify(envelope);
      const base64 = Buffer.from(envelopeJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      // Bob's peer list includes Alice
      const peers = new Map<string, PeerConfig>([
        [alice.publicKey, {
          url: 'http://localhost:18789/hooks',
          token: 'token',
          publicKey: alice.publicKey,
        }],
      ]);

      // Bob decodes and verifies
      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.envelope.sender, alice.publicKey);
        assert.strictEqual(result.envelope.type, 'publish');
        assert.deepStrictEqual(result.envelope.payload, {
          topic: 'weather',
          data: 'sunny',
        });

        // Verify the envelope is cryptographically valid
        const verification = verifyEnvelope(result.envelope);
        assert.strictEqual(verification.valid, true);
      }
    });

    it('should handle reply with inReplyTo', () => {
      const alice = generateKeyPair();
      const bob = generateKeyPair();

      // Alice's initial request
      const request = createEnvelope('request', alice.publicKey, alice.privateKey, {
        query: 'status',
      });

      // Bob's reply
      const reply = createEnvelope('response', bob.publicKey, bob.privateKey, {
        status: 'ok',
      }, 1000000000, request.id);

      // Encode Bob's reply
      const envelopeJson = JSON.stringify(reply);
      const base64 = Buffer.from(envelopeJson).toString('base64url');
      const message = `[AGORA_ENVELOPE]${base64}`;

      // Alice's peer list includes Bob
      const peers = new Map<string, PeerConfig>([
        [bob.publicKey, {
          url: 'http://localhost:18790/hooks',
          token: 'token',
          publicKey: bob.publicKey,
        }],
      ]);

      // Alice decodes Bob's reply
      const result = decodeInboundEnvelope(message, peers);

      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.envelope.sender, bob.publicKey);
        assert.strictEqual(result.envelope.type, 'response');
        assert.strictEqual(result.envelope.inReplyTo, request.id);
        assert.deepStrictEqual(result.envelope.payload, { status: 'ok' });
      }
    });
  });
});
