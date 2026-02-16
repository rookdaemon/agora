import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../../src/identity/keypair.js';
import { RelayServer } from '../../src/relay/server.js';
import { RelayClient } from '../../src/relay/client.js';
import { PeerDiscoveryService } from '../../src/discovery/peer-discovery.js';

describe('PeerDiscovery', () => {
  describe('PeerDiscoveryService', () => {
    it('should discover peers via relay', async () => {
      // Setup relay server with identity
      const relayIdentity = generateKeyPair();
      const relay = new RelayServer(relayIdentity);
      const port = 19474; // Use a test port
      
      try {
        await relay.start(port);

        // Create two test agents
        const agent1 = generateKeyPair();
        const agent2 = generateKeyPair();

        // Connect agent2 to relay
        const client2 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent2.publicKey,
          privateKey: agent2.privateKey,
          name: 'test-agent-2',
        });

        await client2.connect();

        // Give relay time to register agent2
        await new Promise(resolve => setTimeout(resolve, 100));

        // Connect agent1 to relay
        const client1 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          name: 'test-agent-1',
        });

        await client1.connect();

        // Create discovery service for agent1
        const discoveryService = new PeerDiscoveryService({
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          relayClient: client1,
          relayPublicKey: relayIdentity.publicKey,
        });

        // Discover peers
        const peerList = await discoveryService.discoverViaRelay();

        assert.ok(peerList, 'Should receive peer list');
        assert.strictEqual(peerList.relayPublicKey, relayIdentity.publicKey, 'Relay public key should match');
        assert.ok(peerList.peers.length >= 1, 'Should discover at least agent2');
        
        // Should find agent2 but not agent1 (self)
        const foundAgent2 = peerList.peers.find(p => p.publicKey === agent2.publicKey);
        assert.ok(foundAgent2, 'Should find agent2');
        assert.strictEqual(foundAgent2.metadata?.name, 'test-agent-2', 'Agent2 name should match');

        const foundAgent1 = peerList.peers.find(p => p.publicKey === agent1.publicKey);
        assert.ok(!foundAgent1, 'Should not include self in peer list');

        // Cleanup
        client1.disconnect();
        client2.disconnect();
        await relay.stop();
      } catch (err) {
        await relay.stop();
        throw err;
      }
    });

    it('should filter peers by activeWithin', async () => {
      const relayIdentity = generateKeyPair();
      const relay = new RelayServer(relayIdentity);
      const port = 19475;
      
      try {
        await relay.start(port);

        const agent1 = generateKeyPair();
        const agent2 = generateKeyPair();

        // Connect agent2
        const client2 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent2.publicKey,
          privateKey: agent2.privateKey,
        });

        await client2.connect();
        await new Promise(resolve => setTimeout(resolve, 100));

        // Connect agent1
        const client1 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
        });

        await client1.connect();

        const discoveryService = new PeerDiscoveryService({
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          relayClient: client1,
          relayPublicKey: relayIdentity.publicKey,
        });

        // Request peers active within the last hour
        const peerList = await discoveryService.discoverViaRelay({ activeWithin: 3600000 });

        assert.ok(peerList, 'Should receive peer list');
        assert.ok(peerList.peers.length >= 1, 'Should find active peers');
        
        // All returned peers should be within the time window
        const now = Date.now();
        for (const peer of peerList.peers) {
          assert.ok(now - peer.lastSeen < 3600000, 'Peer should be within activeWithin window');
        }

        client1.disconnect();
        client2.disconnect();
        await relay.stop();
      } catch (err) {
        await relay.stop();
        throw err;
      }
    });

    it('should limit peer list size', async () => {
      const relayIdentity = generateKeyPair();
      const relay = new RelayServer(relayIdentity);
      const port = 19476;
      
      try {
        await relay.start(port);

        const agent1 = generateKeyPair();
        const agents = [generateKeyPair(), generateKeyPair(), generateKeyPair()];

        // Connect 3 test agents
        const clients: RelayClient[] = [];
        for (const agent of agents) {
          const client = new RelayClient({
            relayUrl: `ws://localhost:${port}`,
            publicKey: agent.publicKey,
            privateKey: agent.privateKey,
          });
          await client.connect();
          clients.push(client);
          await new Promise(resolve => setTimeout(resolve, 50));
        }

        // Connect requesting agent
        const client1 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
        });

        await client1.connect();

        const discoveryService = new PeerDiscoveryService({
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          relayClient: client1,
          relayPublicKey: relayIdentity.publicKey,
        });

        // Request limit of 2 peers
        const peerList = await discoveryService.discoverViaRelay({ limit: 2 });

        assert.ok(peerList, 'Should receive peer list');
        assert.ok(peerList.peers.length <= 2, 'Should respect limit');
        assert.strictEqual(peerList.totalPeers, 3, 'Total peers should be 3 (excluding self)');

        client1.disconnect();
        for (const client of clients) {
          client.disconnect();
        }
        await relay.stop();
      } catch (err) {
        await relay.stop();
        throw err;
      }
    });

    it('should send and receive peer referrals', async () => {
      const relayIdentity = generateKeyPair();
      const relay = new RelayServer(relayIdentity);
      const port = 19477;
      
      try {
        await relay.start(port);

        const agent1 = generateKeyPair();
        const agent2 = generateKeyPair();
        const agent3 = generateKeyPair();

        // Connect agent1 and agent2
        const client1 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
        });

        const client2 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent2.publicKey,
          privateKey: agent2.privateKey,
        });

        await client1.connect();
        await client2.connect();

        const discoveryService1 = new PeerDiscoveryService({
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          relayClient: client1,
          relayPublicKey: relayIdentity.publicKey,
        });

        const discoveryService2 = new PeerDiscoveryService({
          publicKey: agent2.publicKey,
          privateKey: agent2.privateKey,
          relayClient: client2,
          relayPublicKey: relayIdentity.publicKey,
        });

        // Set up listener for referral on agent2
        let receivedReferral = false;
        discoveryService2.on('peer-referral', (referral, from) => {
          assert.strictEqual(referral.publicKey, agent3.publicKey, 'Referred peer should be agent3');
          assert.strictEqual(from, agent1.publicKey, 'Referral should be from agent1');
          assert.strictEqual(referral.comment, 'Great agent for testing', 'Comment should match');
          receivedReferral = true;
        });

        // Agent1 refers agent3 to agent2
        await discoveryService1.referPeer(
          agent2.publicKey,
          agent3.publicKey,
          {
            name: 'test-agent-3',
            comment: 'Great agent for testing',
          }
        );

        // Wait for message to be delivered
        await new Promise(resolve => setTimeout(resolve, 200));

        assert.ok(receivedReferral, 'Agent2 should receive referral');

        client1.disconnect();
        client2.disconnect();
        await relay.stop();
      } catch (err) {
        await relay.stop();
        throw err;
      }
    });
  });

  describe('Message validation', () => {
    it('should validate peer list response signature', async () => {
      const relayIdentity = generateKeyPair();
      const relay = new RelayServer(relayIdentity);
      const port = 19478;
      
      try {
        await relay.start(port);

        const agent1 = generateKeyPair();

        const client1 = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
        });

        await client1.connect();

        const discoveryService = new PeerDiscoveryService({
          publicKey: agent1.publicKey,
          privateKey: agent1.privateKey,
          relayClient: client1,
          relayPublicKey: relayIdentity.publicKey,
        });

        // Request peer list
        const peerList = await discoveryService.discoverViaRelay();

        assert.ok(peerList, 'Should receive valid peer list');
        assert.strictEqual(peerList.relayPublicKey, relayIdentity.publicKey, 'Relay signature should be verified');

        client1.disconnect();
        await relay.stop();
      } catch (err) {
        await relay.stop();
        throw err;
      }
    });
  });
});
