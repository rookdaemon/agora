import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';
import { createCapability } from '../src/registry/capability.js';
import type { AnnouncePayload, DiscoverPayload, DiscoverResponsePayload } from '../src/registry/messages.js';

describe('Registry Messages', () => {
  describe('AnnouncePayload', () => {
    it('should create a valid announce payload with capabilities', () => {
      const capability = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'review'],
      });
      
      const payload: AnnouncePayload = {
        capabilities: [capability],
      };
      
      assert.ok(payload.capabilities);
      assert.strictEqual(payload.capabilities.length, 1);
      assert.strictEqual(payload.capabilities[0].name, 'code-review');
    });

    it('should create a valid announce payload with metadata', () => {
      const payload: AnnouncePayload = {
        capabilities: [],
        metadata: {
          name: 'Test Agent',
          version: '1.0.0',
        },
      };
      
      assert.ok(payload.metadata);
      assert.strictEqual(payload.metadata.name, 'Test Agent');
      assert.strictEqual(payload.metadata.version, '1.0.0');
    });

    it('should create announce payload with multiple capabilities', () => {
      const cap1 = createCapability('code-review', '1.0.0', 'Reviews code');
      const cap2 = createCapability('translation', '1.0.0', 'Translates text');
      
      const payload: AnnouncePayload = {
        capabilities: [cap1, cap2],
      };
      
      assert.strictEqual(payload.capabilities.length, 2);
    });

    it('should work in an envelope', () => {
      const kp = generateKeyPair();
      const capability = createCapability('test', '1.0.0', 'Test capability');
      
      const payload: AnnouncePayload = {
        capabilities: [capability],
        metadata: {
          name: 'Test Agent',
        },
      };
      
      const envelope = createEnvelope('announce', kp.publicKey, kp.privateKey, payload);
      
      assert.strictEqual(envelope.type, 'announce');
      assert.ok(envelope.payload.capabilities);
      assert.strictEqual(envelope.payload.capabilities.length, 1);
    });
  });

  describe('DiscoverPayload', () => {
    it('should create a discover payload with capability name query', () => {
      const payload: DiscoverPayload = {
        query: {
          capabilityName: 'code-review',
        },
      };
      
      assert.ok(payload.query);
      assert.strictEqual(payload.query.capabilityName, 'code-review');
    });

    it('should create a discover payload with tag query', () => {
      const payload: DiscoverPayload = {
        query: {
          tag: 'typescript',
        },
      };
      
      assert.ok(payload.query);
      assert.strictEqual(payload.query.tag, 'typescript');
    });

    it('should create a discover payload with both capability and tag', () => {
      const payload: DiscoverPayload = {
        query: {
          capabilityName: 'code-review',
          tag: 'typescript',
        },
      };
      
      assert.strictEqual(payload.query.capabilityName, 'code-review');
      assert.strictEqual(payload.query.tag, 'typescript');
    });

    it('should create a discover payload with empty query', () => {
      const payload: DiscoverPayload = {
        query: {},
      };
      
      assert.ok(payload.query);
      assert.strictEqual(payload.query.capabilityName, undefined);
      assert.strictEqual(payload.query.tag, undefined);
    });

    it('should work in an envelope', () => {
      const kp = generateKeyPair();
      
      const payload: DiscoverPayload = {
        query: {
          capabilityName: 'translation',
        },
      };
      
      const envelope = createEnvelope('discover', kp.publicKey, kp.privateKey, payload);
      
      assert.strictEqual(envelope.type, 'discover');
      assert.strictEqual(envelope.payload.query.capabilityName, 'translation');
    });
  });

  describe('DiscoverResponsePayload', () => {
    it('should create a discover response with peers', () => {
      const capability = createCapability('code-review', '1.0.0', 'Reviews code');
      
      const payload: DiscoverResponsePayload = {
        peers: [
          {
            publicKey: 'abc123',
            capabilities: [capability],
          },
        ],
      };
      
      assert.ok(payload.peers);
      assert.strictEqual(payload.peers.length, 1);
      assert.strictEqual(payload.peers[0].publicKey, 'abc123');
      assert.strictEqual(payload.peers[0].capabilities.length, 1);
    });

    it('should create a discover response with peer metadata', () => {
      const capability = createCapability('translation', '1.0.0', 'Translates');
      
      const payload: DiscoverResponsePayload = {
        peers: [
          {
            publicKey: 'peer1',
            capabilities: [capability],
            metadata: {
              name: 'Translator Bot',
              version: '2.0.0',
            },
          },
        ],
      };
      
      assert.ok(payload.peers[0].metadata);
      assert.strictEqual(payload.peers[0].metadata.name, 'Translator Bot');
      assert.strictEqual(payload.peers[0].metadata.version, '2.0.0');
    });

    it('should create a discover response with multiple peers', () => {
      const cap1 = createCapability('code-review', '1.0.0', 'Reviews code');
      const cap2 = createCapability('translation', '1.0.0', 'Translates');
      
      const payload: DiscoverResponsePayload = {
        peers: [
          {
            publicKey: 'peer1',
            capabilities: [cap1],
          },
          {
            publicKey: 'peer2',
            capabilities: [cap2],
          },
        ],
      };
      
      assert.strictEqual(payload.peers.length, 2);
      assert.strictEqual(payload.peers[0].publicKey, 'peer1');
      assert.strictEqual(payload.peers[1].publicKey, 'peer2');
    });

    it('should create a discover response with no peers', () => {
      const payload: DiscoverResponsePayload = {
        peers: [],
      };
      
      assert.deepStrictEqual(payload.peers, []);
    });

    it('should work in an envelope as a reply', () => {
      const kp = generateKeyPair();
      const capability = createCapability('test', '1.0.0', 'Test');
      
      // Original discover request
      const discoverPayload: DiscoverPayload = {
        query: { capabilityName: 'test' },
      };
      const discoverEnvelope = createEnvelope('discover', kp.publicKey, kp.privateKey, discoverPayload);
      
      // Response
      const responsePayload: DiscoverResponsePayload = {
        peers: [
          {
            publicKey: 'responder',
            capabilities: [capability],
          },
        ],
      };
      
      const responseEnvelope = createEnvelope(
        'response',
        kp.publicKey,
        kp.privateKey,
        responsePayload,
        1000000000,
        discoverEnvelope.id
      );
      
      assert.strictEqual(responseEnvelope.type, 'response');
      assert.strictEqual(responseEnvelope.inReplyTo, discoverEnvelope.id);
      assert.strictEqual(responseEnvelope.payload.peers.length, 1);
    });
  });

  describe('Integration: Announce, Discover, Response Flow', () => {
    it('should support complete discovery flow', () => {
      // Setup: Two agents with keypairs
      const agent1 = generateKeyPair();
      const agent2 = generateKeyPair();
      
      // Agent 1 announces capabilities
      const capability = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'typescript'],
      });
      
      const announcePayload: AnnouncePayload = {
        capabilities: [capability],
        metadata: {
          name: 'Code Reviewer',
          version: '1.0.0',
        },
      };
      
      const announceEnvelope = createEnvelope('announce', agent1.publicKey, agent1.privateKey, announcePayload);
      
      // Verify announce envelope
      assert.strictEqual(announceEnvelope.type, 'announce');
      assert.strictEqual(announceEnvelope.sender, agent1.publicKey);
      
      // Agent 2 sends discover request
      const discoverPayload: DiscoverPayload = {
        query: {
          capabilityName: 'code-review',
        },
      };
      
      const discoverEnvelope = createEnvelope('discover', agent2.publicKey, agent2.privateKey, discoverPayload);
      
      // Verify discover envelope
      assert.strictEqual(discoverEnvelope.type, 'discover');
      assert.strictEqual(discoverEnvelope.sender, agent2.publicKey);
      
      // Agent 1 responds with its capabilities
      const responsePayload: DiscoverResponsePayload = {
        peers: [
          {
            publicKey: agent1.publicKey,
            capabilities: [capability],
            metadata: {
              name: 'Code Reviewer',
              version: '1.0.0',
            },
          },
        ],
      };
      
      const responseEnvelope = createEnvelope(
        'response',
        agent1.publicKey,
        agent1.privateKey,
        responsePayload,
        1000000000,
        discoverEnvelope.id
      );
      
      // Verify response envelope
      assert.strictEqual(responseEnvelope.type, 'response');
      assert.strictEqual(responseEnvelope.sender, agent1.publicKey);
      assert.strictEqual(responseEnvelope.inReplyTo, discoverEnvelope.id);
      assert.strictEqual(responseEnvelope.payload.peers.length, 1);
      assert.strictEqual(responseEnvelope.payload.peers[0].publicKey, agent1.publicKey);
    });

    it('should handle empty discovery response', () => {
      const agent = generateKeyPair();
      
      const discoverPayload: DiscoverPayload = {
        query: { capabilityName: 'nonexistent' },
      };
      
      const discoverEnvelope = createEnvelope('discover', agent.publicKey, agent.privateKey, discoverPayload);
      
      // No matching peers
      const responsePayload: DiscoverResponsePayload = {
        peers: [],
      };
      
      const responseEnvelope = createEnvelope(
        'response',
        agent.publicKey,
        agent.privateKey,
        responsePayload,
        discoverEnvelope.id
      );
      
      assert.strictEqual(responseEnvelope.payload.peers.length, 0);
    });
  });
});
