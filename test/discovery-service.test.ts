import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { PeerStore } from '../src/registry/peer-store.js';
import { createCapability } from '../src/registry/capability.js';
import { DiscoveryService } from '../src/registry/discovery-service.js';
import { verifyEnvelope, createEnvelope } from '../src/message/envelope.js';
import type { CapabilityQueryPayload } from '../src/registry/messages.js';

describe('DiscoveryService', () => {
  describe('announce', () => {
    it('should create a valid capability_announce envelope', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const capabilities = [
        createCapability('ocr', '1.0.0', 'OCR service', { tags: ['image', 'text'] }),
      ];
      
      const envelope = service.announce(capabilities);
      
      assert.strictEqual(envelope.type, 'capability_announce');
      assert.strictEqual(envelope.sender, identity.publicKey);
      assert.deepStrictEqual(envelope.payload.capabilities, capabilities);
      assert.strictEqual(envelope.payload.publicKey, identity.publicKey);
      assert.ok(envelope.payload.metadata?.lastSeen);
      
      const verification = verifyEnvelope(envelope);
      assert.strictEqual(verification.valid, true);
    });

    it('should include metadata in announcement', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const capabilities = [
        createCapability('code-review', '2.0.0', 'Code review service'),
      ];
      const metadata = { name: 'Review Bot', version: '2.0.0' };
      
      const envelope = service.announce(capabilities, metadata);
      
      assert.strictEqual(envelope.payload.metadata?.name, 'Review Bot');
      assert.strictEqual(envelope.payload.metadata?.version, '2.0.0');
      assert.ok(envelope.payload.metadata?.lastSeen);
    });

    it('should create announcement with empty capabilities', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const envelope = service.announce([]);
      
      assert.strictEqual(envelope.type, 'capability_announce');
      assert.deepStrictEqual(envelope.payload.capabilities, []);
    });
  });

  describe('handleAnnounce', () => {
    it('should update peer store with announced capabilities', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Create announcement from another peer
      const otherIdentity = generateKeyPair();
      const otherService = new DiscoveryService(new PeerStore(), otherIdentity);
      
      const capabilities = [
        createCapability('translation', '1.0.0', 'Translation service', { tags: ['nlp'] }),
      ];
      const announcement = otherService.announce(capabilities, { name: 'Translator' });
      
      // Handle the announcement
      service.handleAnnounce(announcement);
      
      // Verify peer was added to store
      const peer = peerStore.getPeer(otherIdentity.publicKey);
      assert.ok(peer);
      assert.strictEqual(peer.publicKey, otherIdentity.publicKey);
      assert.deepStrictEqual(peer.capabilities, capabilities);
      assert.strictEqual(peer.metadata?.name, 'Translator');
      assert.ok(peer.lastSeen);
    });

    it('should update existing peer with new capabilities', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const otherIdentity = generateKeyPair();
      const otherService = new DiscoveryService(new PeerStore(), otherIdentity);
      
      // First announcement
      const cap1 = [createCapability('cap1', '1.0.0', 'First capability')];
      const announce1 = otherService.announce(cap1);
      service.handleAnnounce(announce1);
      
      // Second announcement with different capabilities
      const cap2 = [createCapability('cap2', '2.0.0', 'Second capability')];
      const announce2 = otherService.announce(cap2);
      service.handleAnnounce(announce2);
      
      // Verify peer was updated
      const peer = peerStore.getPeer(otherIdentity.publicKey);
      assert.ok(peer);
      assert.deepStrictEqual(peer.capabilities, cap2);
    });

    it('should use envelope timestamp if lastSeen not in metadata', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const otherIdentity = generateKeyPair();
      const capabilities = [createCapability('test', '1.0.0', 'Test')];
      
      // Create envelope without lastSeen in metadata
      const envelope = createEnvelope(
        'capability_announce',
        otherIdentity.publicKey,
        otherIdentity.privateKey,
        {
          publicKey: otherIdentity.publicKey,
          capabilities,
          metadata: undefined,
        }
      );
      
      service.handleAnnounce(envelope);
      
      const peer = peerStore.getPeer(otherIdentity.publicKey);
      assert.ok(peer);
      assert.strictEqual(peer.lastSeen, envelope.timestamp);
    });
  });

  describe('query', () => {
    it('should create a valid capability_query payload for name query', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const queryPayload = service.query('name', 'ocr');
      
      assert.strictEqual(queryPayload.queryType, 'name');
      assert.strictEqual(queryPayload.query, 'ocr');
    });

    it('should create a valid capability_query payload for tag query', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const queryPayload = service.query('tag', 'typescript');
      
      assert.strictEqual(queryPayload.queryType, 'tag');
      assert.strictEqual(queryPayload.query, 'typescript');
    });

    it('should include filters in query payload', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const filters = { limit: 10, minTrustScore: 0.8 };
      const queryPayload = service.query('name', 'code-review', filters);
      
      assert.strictEqual(queryPayload.queryType, 'name');
      assert.strictEqual(queryPayload.query, 'code-review');
      assert.deepStrictEqual(queryPayload.filters, filters);
    });
  });

  describe('handleQuery', () => {
    it('should return matching peers by capability name', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add peers with different capabilities
      const peer1Identity = generateKeyPair();
      const peer1Service = new DiscoveryService(new PeerStore(), peer1Identity);
      const ocrCap = createCapability('ocr', '1.0.0', 'OCR service');
      const announce1 = peer1Service.announce([ocrCap]);
      service.handleAnnounce(announce1);
      
      const peer2Identity = generateKeyPair();
      const peer2Service = new DiscoveryService(new PeerStore(), peer2Identity);
      const reviewCap = createCapability('code-review', '1.0.0', 'Code review');
      const announce2 = peer2Service.announce([reviewCap]);
      service.handleAnnounce(announce2);
      
      // Query for OCR capability
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'name',
        query: 'ocr',
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.type, 'capability_response');
      assert.strictEqual(response.payload.queryId, queryEnvelope.id);
      assert.strictEqual(response.payload.peers.length, 1);
      assert.strictEqual(response.payload.peers[0].publicKey, peer1Identity.publicKey);
      assert.strictEqual(response.payload.totalMatches, 1);
      
      const verification = verifyEnvelope(response);
      assert.strictEqual(verification.valid, true);
    });

    it('should return matching peers by tag', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add peers with different tags
      const peer1Identity = generateKeyPair();
      const peer1Service = new DiscoveryService(new PeerStore(), peer1Identity);
      const cap1 = createCapability('review', '1.0.0', 'Code review', { tags: ['code', 'typescript'] });
      service.handleAnnounce(peer1Service.announce([cap1]));
      
      const peer2Identity = generateKeyPair();
      const peer2Service = new DiscoveryService(new PeerStore(), peer2Identity);
      const cap2 = createCapability('linter', '1.0.0', 'Linter', { tags: ['code', 'quality'] });
      service.handleAnnounce(peer2Service.announce([cap2]));
      
      const peer3Identity = generateKeyPair();
      const peer3Service = new DiscoveryService(new PeerStore(), peer3Identity);
      const cap3 = createCapability('translate', '1.0.0', 'Translation', { tags: ['nlp'] });
      service.handleAnnounce(peer3Service.announce([cap3]));
      
      // Query for 'code' tag
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'tag',
        query: 'code',
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 2);
      assert.strictEqual(response.payload.totalMatches, 2);
      assert.ok(response.payload.peers.some(p => p.publicKey === peer1Identity.publicKey));
      assert.ok(response.payload.peers.some(p => p.publicKey === peer2Identity.publicKey));
    });

    it('should respect limit filter', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add multiple peers with same capability
      for (let i = 0; i < 5; i++) {
        const peerIdentity = generateKeyPair();
        const peerService = new DiscoveryService(new PeerStore(), peerIdentity);
        const cap = createCapability('test', '1.0.0', 'Test capability');
        service.handleAnnounce(peerService.announce([cap]));
      }
      
      // Query with limit
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'name',
        query: 'test',
        filters: { limit: 2 },
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 2);
      assert.strictEqual(response.payload.totalMatches, 5);
    });

    it('should return empty result for non-matching query', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add a peer
      const peerIdentity = generateKeyPair();
      const peerService = new DiscoveryService(new PeerStore(), peerIdentity);
      const cap = createCapability('ocr', '1.0.0', 'OCR');
      service.handleAnnounce(peerService.announce([cap]));
      
      // Query for non-existent capability
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'name',
        query: 'nonexistent',
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 0);
      assert.strictEqual(response.payload.totalMatches, 0);
    });

    it('should return empty result for schema query (not yet implemented)', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add a peer
      const peerIdentity = generateKeyPair();
      const peerService = new DiscoveryService(new PeerStore(), peerIdentity);
      const cap = createCapability('ocr', '1.0.0', 'OCR');
      service.handleAnnounce(peerService.announce([cap]));
      
      // Query by schema (deferred to Phase 2b)
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'schema',
        query: { type: 'object' },
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 0);
    });

    it('should include peer metadata in response', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add peer with metadata
      const peerIdentity = generateKeyPair();
      const peerService = new DiscoveryService(new PeerStore(), peerIdentity);
      const cap = createCapability('ocr', '1.0.0', 'OCR');
      const metadata = { name: 'OCR Bot', version: '1.0.0' };
      service.handleAnnounce(peerService.announce([cap], metadata));
      
      // Query
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'name',
        query: 'ocr',
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 1);
      assert.strictEqual(response.payload.peers[0].metadata?.name, 'OCR Bot');
      assert.strictEqual(response.payload.peers[0].metadata?.version, '1.0.0');
      assert.ok(response.payload.peers[0].metadata?.lastSeen);
    });

    it('should set inReplyTo to query envelope ID', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const queryPayload: CapabilityQueryPayload = {
        queryType: 'name',
        query: 'test',
      };
      const queryEnvelope = createEnvelope(
        'capability_query',
        identity.publicKey,
        identity.privateKey,
        queryPayload
      );
      
      const response = service.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.inReplyTo, queryEnvelope.id);
    });
  });

  describe('pruneStale', () => {
    it('should remove peers older than maxAgeMs', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      const now = Date.now();
      
      // Add old peer
      const oldPeerIdentity = generateKeyPair();
      const oldEnvelope = createEnvelope(
        'capability_announce',
        oldPeerIdentity.publicKey,
        oldPeerIdentity.privateKey,
        {
          publicKey: oldPeerIdentity.publicKey,
          capabilities: [createCapability('old', '1.0.0', 'Old')],
          metadata: { lastSeen: now - 10000 },
        }
      );
      service.handleAnnounce(oldEnvelope);
      
      // Add recent peer
      const recentPeerIdentity = generateKeyPair();
      const recentService = new DiscoveryService(new PeerStore(), recentPeerIdentity);
      service.handleAnnounce(recentService.announce([createCapability('recent', '1.0.0', 'Recent')]));
      
      // Prune peers older than 5 seconds
      const removed = service.pruneStale(5000);
      
      assert.strictEqual(removed, 1);
      assert.strictEqual(peerStore.getPeer(oldPeerIdentity.publicKey), undefined);
      assert.ok(peerStore.getPeer(recentPeerIdentity.publicKey));
    });

    it('should return 0 when no peers are removed', () => {
      const peerStore = new PeerStore();
      const identity = generateKeyPair();
      const service = new DiscoveryService(peerStore, identity);
      
      // Add recent peer
      const peerIdentity = generateKeyPair();
      const peerService = new DiscoveryService(new PeerStore(), peerIdentity);
      service.handleAnnounce(peerService.announce([createCapability('test', '1.0.0', 'Test')]));
      
      const removed = service.pruneStale(1000);
      
      assert.strictEqual(removed, 0);
      assert.ok(peerStore.getPeer(peerIdentity.publicKey));
    });
  });

  describe('integration scenarios', () => {
    it('should support full discovery flow', () => {
      // Setup two agents
      const agent1Identity = generateKeyPair();
      const agent1Store = new PeerStore();
      const agent1 = new DiscoveryService(agent1Store, agent1Identity);
      
      const agent2Identity = generateKeyPair();
      const agent2Store = new PeerStore();
      const agent2 = new DiscoveryService(agent2Store, agent2Identity);
      
      // Agent 1 announces capabilities
      const agent1Caps = [
        createCapability('ocr', '1.0.0', 'OCR service', { tags: ['image', 'text'] }),
        createCapability('translation', '1.0.0', 'Translation', { tags: ['nlp', 'text'] }),
      ];
      const announcement = agent1.announce(agent1Caps, { name: 'Agent 1', version: '1.0.0' });
      
      // Agent 2 receives announcement
      agent2.handleAnnounce(announcement);
      
      // Agent 2 queries for 'text' tag
      const queryPayload = agent2.query('tag', 'text');
      const queryEnvelope = createEnvelope(
        'capability_query',
        agent2Identity.publicKey,
        agent2Identity.privateKey,
        queryPayload
      );
      
      // Agent 2 processes query locally
      const response = agent2.handleQuery(queryEnvelope);
      
      // Verify response
      assert.strictEqual(response.type, 'capability_response');
      assert.strictEqual(response.payload.peers.length, 1);
      assert.strictEqual(response.payload.peers[0].publicKey, agent1Identity.publicKey);
      assert.strictEqual(response.payload.peers[0].capabilities.length, 2);
      assert.strictEqual(response.payload.peers[0].metadata?.name, 'Agent 1');
      assert.strictEqual(response.payload.totalMatches, 1);
    });

    it('should support multiple agents discovering each other', () => {
      // Setup relay/coordinator that receives all announcements
      const relayIdentity = generateKeyPair();
      const relayStore = new PeerStore();
      const relay = new DiscoveryService(relayStore, relayIdentity);
      
      // Create 3 agents with different capabilities
      const agents = [
        {
          identity: generateKeyPair(),
          caps: [createCapability('ocr', '1.0.0', 'OCR', { tags: ['image'] })],
        },
        {
          identity: generateKeyPair(),
          caps: [createCapability('code-review', '1.0.0', 'Code review', { tags: ['code'] })],
        },
        {
          identity: generateKeyPair(),
          caps: [createCapability('linter', '1.0.0', 'Linter', { tags: ['code'] })],
        },
      ];
      
      // All agents announce to relay
      for (const agent of agents) {
        const service = new DiscoveryService(new PeerStore(), agent.identity);
        const announcement = service.announce(agent.caps);
        relay.handleAnnounce(announcement);
      }
      
      // Query for 'code' tag
      const queryPayload = relay.query('tag', 'code');
      const queryEnvelope = createEnvelope(
        'capability_query',
        relayIdentity.publicKey,
        relayIdentity.privateKey,
        queryPayload
      );
      
      const response = relay.handleQuery(queryEnvelope);
      
      assert.strictEqual(response.payload.peers.length, 2);
      assert.strictEqual(response.payload.totalMatches, 2);
      assert.ok(response.payload.peers.some(p => p.publicKey === agents[1].identity.publicKey));
      assert.ok(response.payload.peers.some(p => p.publicKey === agents[2].identity.publicKey));
    });
  });
});
