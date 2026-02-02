import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';
import type { AnnouncePayload } from '../src/registry/messages.js';
import { PeerManager } from '../src/peer/manager.js';

describe('Peer Transport', () => {
  let manager1: PeerManager;
  let manager2: PeerManager;
  const port1 = 9001;
  const port2 = 9002;

  beforeEach(async () => {
    // Create two peer identities
    const identity1 = generateKeyPair();
    const identity2 = generateKeyPair();

    const announcePayload1: AnnouncePayload = {
      capabilities: [{ name: 'test', version: '1.0.0' }],
      metadata: { name: 'peer1', version: '1.0.0' },
    };

    const announcePayload2: AnnouncePayload = {
      capabilities: [{ name: 'test', version: '1.0.0' }],
      metadata: { name: 'peer2', version: '1.0.0' },
    };

    manager1 = new PeerManager(identity1, announcePayload1);
    manager2 = new PeerManager(identity2, announcePayload2);
  });

  afterEach(async () => {
    if (manager1) {
      await manager1.stop();
    }
    if (manager2) {
      await manager2.stop();
    }
    // Wait a bit for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));
  });

  describe('Two peers connect and exchange announce messages', () => {
    it('should connect and exchange announce messages', async () => {
      let peer1Connected = false;
      let peer2Connected = false;

      // Start both servers
      await manager1.start(port1);
      await manager2.start(port2);

      // Wait for connections
      const connectedPromise = new Promise<void>((resolve) => {
        manager1.on('peer-connected', () => {
          peer1Connected = true;
          if (peer2Connected) resolve();
        });

        manager2.on('peer-connected', () => {
          peer2Connected = true;
          if (peer1Connected) resolve();
        });
      });

      // Connect manager1 to manager2
      manager1.connect(`ws://localhost:${port2}`);

      // Wait for both sides to be connected
      await connectedPromise;

      // Verify both peers are connected
      assert.strictEqual(peer1Connected, true);
      assert.strictEqual(peer2Connected, true);

      // Verify peers list
      const peers1 = manager1.getPeers();
      const peers2 = manager2.getPeers();

      assert.strictEqual(peers1.length, 1);
      assert.strictEqual(peers2.length, 1);
    });
  });

  describe('Message with invalid signature is rejected', () => {
    it('should reject messages with invalid signatures', async () => {
      let messageReceived = false;

      // Start both servers
      await manager1.start(port1);
      await manager2.start(port2);

      // Set up message handler
      manager2.on('message-received', () => {
        messageReceived = true;
      });

      // Wait for connection
      const connectedPromise = new Promise<void>((resolve) => {
        manager1.on('peer-connected', () => resolve());
      });

      manager1.connect(`ws://localhost:${port2}`);
      await connectedPromise;

      // Create a message with a valid envelope
      const identity1 = generateKeyPair();
      const validEnvelope = createEnvelope(
        'publish',
        identity1.publicKey,
        identity1.privateKey,
        { data: 'test' }
      );

      // Tamper with the envelope (invalid signature)
      const tamperedEnvelope = {
        ...validEnvelope,
        payload: { data: 'tampered' },
      };

      // Try to send the tampered message directly via client
      const peers1 = manager1.getPeers();
      if (peers1.length > 0) {
        manager1.send(peers1[0].publicKey, tamperedEnvelope);
      }

      // Wait a bit to see if message is received
      await new Promise(resolve => setTimeout(resolve, 100));

      // Message should not have been received due to invalid signature
      assert.strictEqual(messageReceived, false);
    });
  });

  describe('Broadcast and send functionality', () => {
    it('should broadcast messages to all connected peers', async () => {
      const messagesReceived: string[] = [];

      // Store identities to reuse
      const identity1 = generateKeyPair();
      const identity2 = generateKeyPair();

      const announcePayload1: AnnouncePayload = {
        capabilities: [{ name: 'test', version: '1.0.0' }],
        metadata: { name: 'peer1', version: '1.0.0' },
      };

      const announcePayload2: AnnouncePayload = {
        capabilities: [{ name: 'test', version: '1.0.0' }],
        metadata: { name: 'peer2', version: '1.0.0' },
      };

      // Create new managers with known identities
      manager1 = new PeerManager(identity1, announcePayload1);
      manager2 = new PeerManager(identity2, announcePayload2);

      // Start servers
      await manager1.start(port1);
      await manager2.start(port2);

      // Track messages
      manager2.on('message-received', (envelope) => {
        messagesReceived.push(envelope.type);
      });

      // Connect
      const connectedPromise = new Promise<void>((resolve) => {
        manager1.on('peer-connected', () => resolve());
      });

      manager1.connect(`ws://localhost:${port2}`);
      await connectedPromise;

      // Create and broadcast a message from manager1's identity
      const envelope = createEnvelope(
        'publish',
        identity1.publicKey,
        identity1.privateKey,
        { data: 'broadcast test' }
      );

      manager1.broadcast(envelope);

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.strictEqual(messagesReceived.length, 1);
      assert.strictEqual(messagesReceived[0], 'publish');
    });

    it('should send messages to specific peers', async () => {
      let messageReceived = false;

      // Store identities to reuse
      const identity1 = generateKeyPair();
      const identity2 = generateKeyPair();

      const announcePayload1: AnnouncePayload = {
        capabilities: [{ name: 'test', version: '1.0.0' }],
        metadata: { name: 'peer1', version: '1.0.0' },
      };

      const announcePayload2: AnnouncePayload = {
        capabilities: [{ name: 'test', version: '1.0.0' }],
        metadata: { name: 'peer2', version: '1.0.0' },
      };

      // Create new managers with known identities
      manager1 = new PeerManager(identity1, announcePayload1);
      manager2 = new PeerManager(identity2, announcePayload2);

      // Start servers
      await manager1.start(port1);
      await manager2.start(port2);

      // Track messages
      manager2.on('message-received', () => {
        messageReceived = true;
      });

      // Connect
      const connectedPromise = new Promise<void>((resolve) => {
        manager1.on('peer-connected', () => resolve());
      });

      manager1.connect(`ws://localhost:${port2}`);
      await connectedPromise;

      // Get peer public key
      const peers = manager1.getPeers();
      assert.strictEqual(peers.length, 1);

      // Create and send a message to specific peer from manager1's identity
      const envelope = createEnvelope(
        'request',
        identity1.publicKey,
        identity1.privateKey,
        { query: 'test' }
      );

      const sent = manager1.send(peers[0].publicKey, envelope);
      assert.strictEqual(sent, true);

      // Wait for message to be received
      await new Promise(resolve => setTimeout(resolve, 100));

      assert.strictEqual(messageReceived, true);
    });
  });
});
