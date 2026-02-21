import { describe, it } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';
import { RelayServer } from '../src/relay/server.js';
import { RelayClient } from '../src/relay/client.js';

/** Returns a promise that resolves after `ms` milliseconds. */
const delay = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Waits up to `maxMs` for `predicate` to return true, polling every `intervalMs`. */
async function waitFor(predicate: () => boolean, maxMs = 3000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('waitFor: timed out');
    await delay(intervalMs);
  }
}

const BASE_PORT = 49200;
let portOffset = 0;
function nextPort(): number {
  return BASE_PORT + portOffset++;
}

describe('RelayServer store-and-forward', () => {
  describe('isPeerOnline for stored peers', () => {
    it('should return true for a stored-for peer that is offline', async () => {
      const port = nextPort();
      const storedIdentity = generateKeyPair();
      const clientIdentity = generateKeyPair();

      const server = new RelayServer(undefined, [storedIdentity.publicKey]);
      await server.start(port);

      const client = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: clientIdentity.publicKey,
        privateKey: clientIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      try {
        await client.connect();
        // storedIdentity peer is offline, but relay stores for it → should be "online"
        assert.strictEqual(client.isPeerOnline(storedIdentity.publicKey), true,
          'stored-for peer should be considered online even when offline');
      } finally {
        client.disconnect();
        await server.stop();
      }
    });

    it('should return true for a stored-for peer that is online', async () => {
      const port = nextPort();
      const storedIdentity = generateKeyPair();
      const clientIdentity = generateKeyPair();

      const server = new RelayServer(undefined, [storedIdentity.publicKey]);
      await server.start(port);

      const storedClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: storedIdentity.publicKey,
        privateKey: storedIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      const observerClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: clientIdentity.publicKey,
        privateKey: clientIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      try {
        // Connect stored peer first, then observer
        await storedClient.connect();
        await observerClient.connect();

        assert.strictEqual(observerClient.isPeerOnline(storedIdentity.publicKey), true,
          'stored-for peer should be online when connected');
      } finally {
        storedClient.disconnect();
        observerClient.disconnect();
        await server.stop();
      }
    });

    it('should keep stored-for peer as "online" after it disconnects', async () => {
      const port = nextPort();
      const storedIdentity = generateKeyPair();
      const clientIdentity = generateKeyPair();

      const server = new RelayServer(undefined, [storedIdentity.publicKey]);
      await server.start(port);

      const storedClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: storedIdentity.publicKey,
        privateKey: storedIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 5000,
      });

      const observerClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: clientIdentity.publicKey,
        privateKey: clientIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 5000,
      });

      try {
        await storedClient.connect();
        await observerClient.connect();

        assert.strictEqual(observerClient.isPeerOnline(storedIdentity.publicKey), true,
          'stored-for peer should be online before disconnect');

        // Disconnect stored peer and wait for observer to receive peer_offline
        storedClient.disconnect();
        await waitFor(() => !server.getAgents().has(storedIdentity.publicKey));
        await delay(100); // allow peer_offline event to propagate

        assert.strictEqual(observerClient.isPeerOnline(storedIdentity.publicKey), true,
          'stored-for peer should still be considered online after disconnect');
      } finally {
        observerClient.disconnect();
        await server.stop();
      }
    });

    it('should return false for a non-stored peer that is offline', async () => {
      const port = nextPort();
      const normalIdentity = generateKeyPair();
      const clientIdentity = generateKeyPair();

      // No storedPeers configured
      const server = new RelayServer();
      await server.start(port);

      const client = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: clientIdentity.publicKey,
        privateKey: clientIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      try {
        await client.connect();
        assert.strictEqual(client.isPeerOnline(normalIdentity.publicKey), false,
          'non-stored offline peer should not be considered online');
      } finally {
        client.disconnect();
        await server.stop();
      }
    });
  });

  describe('message buffering for offline stored peers', () => {
    it('should buffer a message for an offline stored peer and deliver on reconnect', async () => {
      const port = nextPort();
      const senderIdentity = generateKeyPair();
      const storedIdentity = generateKeyPair();

      const server = new RelayServer(undefined, [storedIdentity.publicKey]);
      await server.start(port);

      const senderClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: senderIdentity.publicKey,
        privateKey: senderIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      try {
        await senderClient.connect();

        // Send a properly-signed message to the offline stored peer
        const envelope = createEnvelope(
          'publish',
          senderIdentity.publicKey,
          senderIdentity.privateKey,
          { text: 'buffered hello' },
          Date.now(),
        );
        const result = await senderClient.send(storedIdentity.publicKey, envelope);
        assert.strictEqual(result.ok, true, 'send to offline stored peer should succeed');

        // Allow relay to process the message
        await delay(50);

        // Connect the stored peer and verify it receives the buffered message
        const receivedMessages: unknown[] = [];
        const storedClient = new RelayClient({
          relayUrl: `ws://localhost:${port}`,
          publicKey: storedIdentity.publicKey,
          privateKey: storedIdentity.privateKey,
          pingInterval: 60000,
          maxReconnectDelay: 1000,
        });

        storedClient.once('message', (env) => { receivedMessages.push(env); });

        try {
          await storedClient.connect();
          await delay(200); // allow buffered messages to be delivered

          assert.strictEqual(receivedMessages.length, 1,
            'stored peer should receive exactly one buffered message after connecting');
        } finally {
          storedClient.disconnect();
        }
      } finally {
        senderClient.disconnect();
        await server.stop();
      }
    });

    it('should not buffer messages for non-stored offline peers and return error from relay', async () => {
      const port = nextPort();
      const senderIdentity = generateKeyPair();
      const offlineIdentity = generateKeyPair();

      // No storedPeers configured
      const server = new RelayServer();
      await server.start(port);

      const senderClient = new RelayClient({
        relayUrl: `ws://localhost:${port}`,
        publicKey: senderIdentity.publicKey,
        privateKey: senderIdentity.privateKey,
        pingInterval: 60000,
        maxReconnectDelay: 1000,
      });

      const errors: string[] = [];
      senderClient.on('error', (err) => { errors.push(err.message); });

      try {
        await senderClient.connect();

        const envelope = createEnvelope(
          'publish',
          senderIdentity.publicKey,
          senderIdentity.privateKey,
          { text: 'should not arrive' },
          Date.now(),
        );
        await senderClient.send(offlineIdentity.publicKey, envelope);

        // Wait for relay to send back an error
        await delay(200);

        assert.ok(
          errors.some(e => e.includes('Recipient not connected')),
          'should receive "Recipient not connected" error for non-stored offline peer',
        );
      } finally {
        senderClient.disconnect();
        await server.stop();
      }
    });
  });
});

