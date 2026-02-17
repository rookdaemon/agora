import { describe, it } from 'node:test';
import assert from 'node:assert';
import { PeerStore } from '../src/registry/peer-store.js';
import { createCapability } from '../src/registry/capability.js';
import type { Peer } from '../src/registry/peer.js';

describe('PeerStore', () => {
  describe('addOrUpdatePeer', () => {
    it('should add a new peer', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'abc123',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      
      const retrieved = store.getPeer('abc123');
      assert.deepStrictEqual(retrieved, peer);
    });

    it('should update an existing peer', () => {
      const store = new PeerStore();
      const peer1: Peer = {
        publicKey: 'abc123',
        capabilities: [],
        lastSeen: 1000,
      };
      
      store.addOrUpdatePeer(peer1);
      
      const peer2: Peer = {
        publicKey: 'abc123',
        capabilities: [createCapability('test', '1.0.0', 'Test capability')],
        lastSeen: 2000,
      };
      
      store.addOrUpdatePeer(peer2);
      
      const retrieved = store.getPeer('abc123');
      assert.deepStrictEqual(retrieved, peer2);
      assert.strictEqual(retrieved?.lastSeen, 2000);
    });

    it('should store multiple peers', () => {
      const store = new PeerStore();
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [],
        lastSeen: 1000000000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      
      assert.strictEqual(store.allPeers().length, 2);
    });
  });

  describe('removePeer', () => {
    it('should remove an existing peer', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'abc123',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      const removed = store.removePeer('abc123');
      
      assert.strictEqual(removed, true);
      assert.strictEqual(store.getPeer('abc123'), undefined);
    });

    it('should return false when removing non-existent peer', () => {
      const store = new PeerStore();
      const removed = store.removePeer('nonexistent');
      
      assert.strictEqual(removed, false);
    });
  });

  describe('getPeer', () => {
    it('should retrieve an existing peer', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'abc123',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      const retrieved = store.getPeer('abc123');
      
      assert.deepStrictEqual(retrieved, peer);
    });

    it('should return undefined for non-existent peer', () => {
      const store = new PeerStore();
      const retrieved = store.getPeer('nonexistent');
      
      assert.strictEqual(retrieved, undefined);
    });
  });

  describe('findByCapability', () => {
    it('should find peers with a specific capability', () => {
      const store = new PeerStore();
      const codeReviewCap = createCapability('code-review', '1.0.0', 'Reviews code');
      const translationCap = createCapability('translation', '1.0.0', 'Translates text');
      
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [codeReviewCap],
        lastSeen: 1000000000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [translationCap],
        lastSeen: 1000000000,
      };
      const peer3: Peer = {
        publicKey: 'peer3',
        capabilities: [codeReviewCap, translationCap],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      store.addOrUpdatePeer(peer3);
      
      const found = store.findByCapability('code-review');
      
      assert.strictEqual(found.length, 2);
      assert.ok(found.some(p => p.publicKey === 'peer1'));
      assert.ok(found.some(p => p.publicKey === 'peer3'));
      assert.ok(!found.some(p => p.publicKey === 'peer2'));
    });

    it('should return empty array when no peers have the capability', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'peer1',
        capabilities: [createCapability('test', '1.0.0', 'Test')],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      const found = store.findByCapability('nonexistent');
      
      assert.deepStrictEqual(found, []);
    });

    it('should return empty array for empty store', () => {
      const store = new PeerStore();
      const found = store.findByCapability('anything');
      
      assert.deepStrictEqual(found, []);
    });
  });

  describe('findByTag', () => {
    it('should find peers with capabilities containing a specific tag', () => {
      const store = new PeerStore();
      const cap1 = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'typescript'],
      });
      const cap2 = createCapability('translation', '1.0.0', 'Translates text', {
        tags: ['language', 'nlp'],
      });
      const cap3 = createCapability('linter', '1.0.0', 'Lints code', {
        tags: ['code', 'quality'],
      });
      
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [cap1],
        lastSeen: 1000000000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [cap2],
        lastSeen: 1000000000,
      };
      const peer3: Peer = {
        publicKey: 'peer3',
        capabilities: [cap3],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      store.addOrUpdatePeer(peer3);
      
      const found = store.findByTag('code');
      
      assert.strictEqual(found.length, 2);
      assert.ok(found.some(p => p.publicKey === 'peer1'));
      assert.ok(found.some(p => p.publicKey === 'peer3'));
      assert.ok(!found.some(p => p.publicKey === 'peer2'));
    });

    it('should find peers with multiple capabilities, any matching the tag', () => {
      const store = new PeerStore();
      const cap1 = createCapability('cap1', '1.0.0', 'First', { tags: ['tag1'] });
      const cap2 = createCapability('cap2', '1.0.0', 'Second', { tags: ['tag2'] });
      
      const peer: Peer = {
        publicKey: 'peer1',
        capabilities: [cap1, cap2],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      
      const found1 = store.findByTag('tag1');
      const found2 = store.findByTag('tag2');
      
      assert.strictEqual(found1.length, 1);
      assert.strictEqual(found2.length, 1);
      assert.strictEqual(found1[0].publicKey, 'peer1');
      assert.strictEqual(found2[0].publicKey, 'peer1');
    });

    it('should return empty array when no peers have the tag', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'peer1',
        capabilities: [createCapability('test', '1.0.0', 'Test', { tags: ['other'] })],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      const found = store.findByTag('nonexistent');
      
      assert.deepStrictEqual(found, []);
    });

    it('should return empty array for empty store', () => {
      const store = new PeerStore();
      const found = store.findByTag('anything');
      
      assert.deepStrictEqual(found, []);
    });
  });

  describe('allPeers', () => {
    it('should return all peers in the store', () => {
      const store = new PeerStore();
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [],
        lastSeen: 1000000000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      
      const all = store.allPeers();
      
      assert.strictEqual(all.length, 2);
      assert.ok(all.some(p => p.publicKey === 'peer1'));
      assert.ok(all.some(p => p.publicKey === 'peer2'));
    });

    it('should return empty array for empty store', () => {
      const store = new PeerStore();
      const all = store.allPeers();
      
      assert.deepStrictEqual(all, []);
    });
  });

  describe('prune', () => {
    it('should remove peers older than maxAgeMs', () => {
      const store = new PeerStore();
      const now = 1000000000;
      
      const oldPeer: Peer = {
        publicKey: 'old',
        capabilities: [],
        lastSeen: now - 10000, // 10 seconds ago
      };
      const recentPeer: Peer = {
        publicKey: 'recent',
        capabilities: [],
        lastSeen: now - 1000, // 1 second ago
      };
      
      store.addOrUpdatePeer(oldPeer);
      store.addOrUpdatePeer(recentPeer);
      
      const removed = store.prune(5000, now); // Remove peers older than 5 seconds
      
      assert.strictEqual(removed, 1);
      assert.strictEqual(store.getPeer('old'), undefined);
      assert.ok(store.getPeer('recent'));
    });

    it('should keep peers within the maxAgeMs threshold', () => {
      const store = new PeerStore();
      const now = 1000000000;
      
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [],
        lastSeen: now - 1000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [],
        lastSeen: now - 2000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      
      const removed = store.prune(5000, now);
      
      assert.strictEqual(removed, 0);
      assert.strictEqual(store.allPeers().length, 2);
    });

    it('should remove all peers when all are stale', () => {
      const store = new PeerStore();
      const now = 1000000000;
      
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [],
        lastSeen: now - 10000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [],
        lastSeen: now - 20000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      
      const removed = store.prune(5000, now);
      
      assert.strictEqual(removed, 2);
      assert.strictEqual(store.allPeers().length, 0);
    });

    it('should return 0 when no peers are removed', () => {
      const store = new PeerStore();
      const peer: Peer = {
        publicKey: 'peer1',
        capabilities: [],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer);
      const removed = store.prune(1000, 1000000000);
      
      assert.strictEqual(removed, 0);
    });

    it('should return 0 for empty store', () => {
      const store = new PeerStore();
      const removed = store.prune(1000, 1000000000);
      
      assert.strictEqual(removed, 0);
    });
  });

  describe('integration scenarios', () => {
    it('should support a complete peer lifecycle', () => {
      const store = new PeerStore();
      const capability = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'review'],
      });
      
      // Add peer
      const peer: Peer = {
        publicKey: 'test-peer',
        capabilities: [capability],
        lastSeen: 1000000000,
        metadata: {
          name: 'Code Reviewer Bot',
          version: '1.0.0',
        },
      };
      
      store.addOrUpdatePeer(peer);
      
      // Find by capability
      const byCapability = store.findByCapability('code-review');
      assert.strictEqual(byCapability.length, 1);
      
      // Find by tag
      const byTag = store.findByTag('code');
      assert.strictEqual(byTag.length, 1);
      
      // Update peer
      const updatedPeer = { ...peer, lastSeen: 1000000000 + 1000 };
      store.addOrUpdatePeer(updatedPeer);
      
      const retrieved = store.getPeer('test-peer');
      assert.ok(retrieved);
      assert.strictEqual(retrieved.lastSeen, updatedPeer.lastSeen);
      
      // Remove peer
      store.removePeer('test-peer');
      assert.strictEqual(store.getPeer('test-peer'), undefined);
    });

    it('should handle complex multi-peer scenarios', () => {
      const store = new PeerStore();
      
      const reviewCap = createCapability('code-review', '1.0.0', 'Reviews code', {
        tags: ['code', 'review'],
      });
      const translateCap = createCapability('translation', '1.0.0', 'Translates', {
        tags: ['language', 'nlp'],
      });
      const summarizeCap = createCapability('summarization', '1.0.0', 'Summarizes', {
        tags: ['text', 'nlp'],
      });
      
      const peer1: Peer = {
        publicKey: 'peer1',
        capabilities: [reviewCap],
        lastSeen: 1000000000,
      };
      const peer2: Peer = {
        publicKey: 'peer2',
        capabilities: [translateCap, summarizeCap],
        lastSeen: 1000000000,
      };
      const peer3: Peer = {
        publicKey: 'peer3',
        capabilities: [reviewCap, summarizeCap],
        lastSeen: 1000000000,
      };
      
      store.addOrUpdatePeer(peer1);
      store.addOrUpdatePeer(peer2);
      store.addOrUpdatePeer(peer3);
      
      // Find by different criteria
      const reviewers = store.findByCapability('code-review');
      assert.strictEqual(reviewers.length, 2);
      
      const nlpPeers = store.findByTag('nlp');
      assert.strictEqual(nlpPeers.length, 2);
      
      const allPeers = store.allPeers();
      assert.strictEqual(allPeers.length, 3);
    });
  });
});
