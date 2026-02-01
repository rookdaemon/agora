import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope, verifyEnvelope } from '../src/protocol/envelope.js';
import type { AnnounceMessage } from '../src/protocol/messages.js';

describe('Protocol', () => {
  describe('createEnvelope', () => {
    it('should create a valid envelope for an AnnounceMessage', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'announce' as const,
        payload: {
          capabilities: ['skill-a', 'skill-b'],
          metadata: { version: '1.0.0' },
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.ok(envelope.id);
      assert.strictEqual(envelope.type, 'announce');
      assert.strictEqual(envelope.from, keyPair.publicKey);
      assert.ok(envelope.timestamp);
      assert.ok(envelope.signature);
      assert.deepStrictEqual(envelope.payload, message.payload);
    });

    it('should create a valid envelope for a QueryMessage', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'query' as const,
        payload: {
          query: 'find agents with skill-x',
          filters: { skillLevel: 'expert' },
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.ok(envelope.id);
      assert.strictEqual(envelope.type, 'query');
      assert.strictEqual(envelope.from, keyPair.publicKey);
      assert.ok(envelope.timestamp);
      assert.ok(envelope.signature);
    });

    it('should create a valid envelope for a ResponseMessage', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'response' as const,
        payload: {
          queryId: 'query-123',
          results: [{ agent: 'agent-1', capability: 'skill-x' }],
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.ok(envelope.id);
      assert.strictEqual(envelope.type, 'response');
      assert.strictEqual(envelope.from, keyPair.publicKey);
    });

    it('should create a valid envelope for a PingMessage', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: {
          nonce: 'random-nonce-123',
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.ok(envelope.id);
      assert.strictEqual(envelope.type, 'ping');
      assert.strictEqual(envelope.from, keyPair.publicKey);
    });

    it('should create a valid envelope for a PongMessage', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'pong' as const,
        payload: {
          nonce: 'random-nonce-123',
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.ok(envelope.id);
      assert.strictEqual(envelope.type, 'pong');
      assert.strictEqual(envelope.from, keyPair.publicKey);
    });

    it('should generate unique IDs for each envelope', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope1 = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      const envelope2 = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      assert.notStrictEqual(envelope1.id, envelope2.id);
    });

    it('should create ISO 8601 timestamp', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Validate ISO 8601 format
      assert.ok(envelope.timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/));
      
      // Should be parseable as a valid date
      const date = new Date(envelope.timestamp);
      assert.ok(!isNaN(date.getTime()));
    });

    it('should include hex-encoded signature', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Signature should be valid hex
      assert.match(envelope.signature, /^[0-9a-f]+$/i);
    });
  });

  describe('verifyEnvelope', () => {
    it('should verify a valid envelope', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'announce' as const,
        payload: {
          capabilities: ['skill-a', 'skill-b'],
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      const isValid = verifyEnvelope(envelope, keyPair.publicKey);
      
      assert.strictEqual(isValid, true);
    });

    it('should verify envelope using from field when publicKey not provided', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'query' as const,
        payload: { query: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      const isValid = verifyEnvelope(envelope);
      
      assert.strictEqual(isValid, true);
    });

    it('should reject envelope with tampered payload', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'announce' as const,
        payload: {
          capabilities: ['skill-a'],
        },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey) as AnnounceMessage;
      
      // Tamper with the payload
      envelope.payload.capabilities.push('skill-b');
      
      const isValid = verifyEnvelope(envelope, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject envelope with tampered signature', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Tamper with the signature
      const tamperedEnvelope = {
        ...envelope,
        signature: envelope.signature.slice(0, -2) + 'ff',
      };
      
      const isValid = verifyEnvelope(tamperedEnvelope, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject envelope with tampered timestamp', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Tamper with the timestamp
      const tamperedEnvelope = {
        ...envelope,
        timestamp: new Date(Date.now() + 1000).toISOString(),
      };
      
      const isValid = verifyEnvelope(tamperedEnvelope, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject envelope with tampered type', () => {
      const keyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Tamper with the type
      const tamperedEnvelope = {
        ...envelope,
        type: 'pong',
      };
      
      const isValid = verifyEnvelope(tamperedEnvelope, keyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject envelope with tampered from field', () => {
      const keyPair = generateKeyPair();
      const otherKeyPair = generateKeyPair();
      const message = {
        type: 'ping' as const,
        payload: { nonce: 'test' },
      };
      
      const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
      
      // Tamper with the from field
      const tamperedEnvelope = {
        ...envelope,
        from: otherKeyPair.publicKey,
      };
      
      const isValid = verifyEnvelope(tamperedEnvelope, otherKeyPair.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should reject envelope signed by wrong key', () => {
      const keyPair1 = generateKeyPair();
      const keyPair2 = generateKeyPair();
      const message = {
        type: 'announce' as const,
        payload: {
          capabilities: ['skill-a'],
        },
      };
      
      const envelope = createEnvelope(message, keyPair1.privateKey, keyPair1.publicKey);
      const isValid = verifyEnvelope(envelope, keyPair2.publicKey);
      
      assert.strictEqual(isValid, false);
    });

    it('should handle invalid envelope structure gracefully', () => {
      const invalidEnvelope = {
        id: 'test-id',
        type: 'ping',
        from: 'invalid-key',
        timestamp: new Date().toISOString(),
        signature: 'invalid-signature',
      };
      
      const isValid = verifyEnvelope(invalidEnvelope);
      
      assert.strictEqual(isValid, false);
    });
  });

  describe('end-to-end message flow', () => {
    it('should support complete announce workflow', () => {
      const keyPair = generateKeyPair();
      
      // Create an announce message
      const announceMsg = {
        type: 'announce' as const,
        payload: {
          capabilities: ['code-review', 'testing', 'documentation'],
          metadata: { version: '2.0.0', uptime: 3600 },
        },
      };
      
      // Wrap in envelope
      const envelope = createEnvelope(announceMsg, keyPair.privateKey, keyPair.publicKey);
      
      // Verify it can be validated
      assert.strictEqual(verifyEnvelope(envelope), true);
      
      // Serialize and deserialize (simulating network transfer)
      const serialized = JSON.stringify(envelope);
      const deserialized = JSON.parse(serialized) as AnnounceMessage;
      
      // Should still verify after serialization
      assert.strictEqual(verifyEnvelope(deserialized), true);
      assert.deepStrictEqual(deserialized.payload, announceMsg.payload);
    });

    it('should support query-response workflow', () => {
      const requester = generateKeyPair();
      const responder = generateKeyPair();
      
      // Create and send query
      const query = {
        type: 'query' as const,
        payload: {
          query: 'agents with code-review capability',
          filters: { minRating: 4.5 },
        },
      };
      
      const queryEnvelope = createEnvelope(query, requester.privateKey, requester.publicKey);
      assert.strictEqual(verifyEnvelope(queryEnvelope), true);
      
      // Create response
      const response = {
        type: 'response' as const,
        payload: {
          queryId: queryEnvelope.id,
          results: [
            { agentId: responder.publicKey, capabilities: ['code-review'] },
          ],
          metadata: { totalResults: 1 },
        },
      };
      
      const responseEnvelope = createEnvelope(response, responder.privateKey, responder.publicKey);
      assert.strictEqual(verifyEnvelope(responseEnvelope), true);
      
      // Verify query ID matches
      assert.strictEqual(responseEnvelope.payload.queryId, queryEnvelope.id);
    });

    it('should support ping-pong keepalive workflow', () => {
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      
      // Agent 1 sends ping
      const ping = {
        type: 'ping' as const,
        payload: {
          nonce: 'keepalive-' + Date.now(),
        },
      };
      
      const pingEnvelope = createEnvelope(ping, agent1.privateKey, agent1.publicKey);
      assert.strictEqual(verifyEnvelope(pingEnvelope), true);
      
      // Agent 2 responds with pong using same nonce
      const pong = {
        type: 'pong' as const,
        payload: {
          nonce: pingEnvelope.payload.nonce,
        },
      };
      
      const pongEnvelope = createEnvelope(pong, agent2.privateKey, agent2.publicKey);
      assert.strictEqual(verifyEnvelope(pongEnvelope), true);
      
      // Verify nonce matches
      assert.strictEqual(pongEnvelope.payload.nonce, pingEnvelope.payload.nonce);
    });

    it('should enforce signature verification across message types', () => {
      const keyPair = generateKeyPair();
      const messages = [
        { type: 'announce' as const, payload: { capabilities: [] } },
        { type: 'query' as const, payload: { query: 'test' } },
        { type: 'response' as const, payload: { queryId: '123', results: [] } },
        { type: 'ping' as const, payload: { nonce: 'test' } },
        { type: 'pong' as const, payload: { nonce: 'test' } },
      ];
      
      for (const message of messages) {
        const envelope = createEnvelope(message, keyPair.privateKey, keyPair.publicKey);
        
        // Should verify with correct key
        assert.strictEqual(verifyEnvelope(envelope), true, `${message.type} should verify`);
        
        // Should fail with tampered payload
        const tampered = JSON.parse(JSON.stringify(envelope));
        tampered.payload.extra = 'tampered';
        assert.strictEqual(verifyEnvelope(tampered), false, `${message.type} should reject tampering`);
      }
    });
  });
});
