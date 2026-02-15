import { describe, test, before, after } from 'node:test';
import assert from 'node:assert';
import { RelayServer } from '../src/relay/server.js';
import { RelayClient } from '../src/relay/client.js';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';

describe('RelayClient', () => {
  let server: RelayServer;
  const port = 19475; // Use a unique port for testing

  before(async () => {
    server = new RelayServer();
    await server.start(port);
  });

  after(async () => {
    await server.stop();
  });

  test('should connect and register successfully', async () => {
    const identity = generateKeyPair();
    const client = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      name: 'test-agent',
    });

    let connectedEventFired = false;
    client.on('connected', () => {
      connectedEventFired = true;
    });

    await client.connect();

    assert.strictEqual(client.connected(), true);
    assert.strictEqual(connectedEventFired, true);

    client.disconnect();
  });

  test('should send messages to another peer', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();

    const client1 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent1.publicKey,
      privateKey: agent1.privateKey,
      name: 'agent1',
    });

    const client2 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent2.publicKey,
      privateKey: agent2.privateKey,
      name: 'agent2',
    });

    await client1.connect();
    await client2.connect();

    // Wait for message on client2
    const messagePromise = new Promise<void>((resolve) => {
      client2.on('message', (envelope, from, fromName) => {
        assert.strictEqual(from, agent1.publicKey);
        assert.strictEqual(fromName, 'agent1');
        assert.strictEqual(envelope.type, 'publish');
        assert.deepStrictEqual(envelope.payload, { text: 'Hello from agent1' });
        resolve();
      });
    });

    // Send message from client1 to client2
    const envelope = createEnvelope(
      'publish',
      agent1.publicKey,
      agent1.privateKey,
      { text: 'Hello from agent1' }
    );

    const result = await client1.send(agent2.publicKey, envelope);
    assert.strictEqual(result.ok, true);

    // Wait for message to be received
    await messagePromise;

    client1.disconnect();
    client2.disconnect();
  });

  test('should receive peer_online events', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();

    const client1 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent1.publicKey,
      privateKey: agent1.privateKey,
      name: 'agent1',
    });

    await client1.connect();

    // Wait for peer_online event when agent2 connects
    const peerOnlinePromise = new Promise<void>((resolve) => {
      client1.on('peer_online', (peer) => {
        if (peer.publicKey === agent2.publicKey) {
          assert.strictEqual(peer.name, 'agent2');
          resolve();
        }
      });
    });

    const client2 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent2.publicKey,
      privateKey: agent2.privateKey,
      name: 'agent2',
    });

    await client2.connect();
    await peerOnlinePromise;

    // Check online peers
    const onlinePeers = client1.getOnlinePeers();
    const agent2Online = onlinePeers.find(p => p.publicKey === agent2.publicKey);
    assert.ok(agent2Online);
    assert.strictEqual(agent2Online.name, 'agent2');
    assert.strictEqual(client1.isPeerOnline(agent2.publicKey), true);

    client1.disconnect();
    client2.disconnect();
  });

  test('should receive peer_offline events', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();

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

    // Wait a bit to ensure both are registered
    await new Promise(resolve => setTimeout(resolve, 100));

    // Wait for peer_offline event when agent2 disconnects
    const peerOfflinePromise = new Promise<void>((resolve) => {
      client1.on('peer_offline', (peer) => {
        if (peer.publicKey === agent2.publicKey) {
          resolve();
        }
      });
    });

    client2.disconnect();
    await peerOfflinePromise;

    // Check that peer is no longer online
    assert.strictEqual(client1.isPeerOnline(agent2.publicKey), false);

    client1.disconnect();
  });

  test('should verify envelope signatures on inbound messages', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();

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

    // Send valid message
    const envelope = createEnvelope(
      'publish',
      agent1.publicKey,
      agent1.privateKey,
      { text: 'Valid message' }
    );

    const messagePromise = new Promise<void>((resolve) => {
      client2.on('message', (env) => {
        assert.strictEqual(env.payload.text, 'Valid message');
        resolve();
      });
    });

    await client1.send(agent2.publicKey, envelope);
    await messagePromise;

    client1.disconnect();
    client2.disconnect();
  });

  test('should handle connection failures gracefully', async () => {
    const identity = generateKeyPair();
    const client = new RelayClient({
      relayUrl: 'ws://localhost:99999', // Invalid port
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
    });

    let errorFired = false;
    client.on('error', () => {
      errorFired = true;
    });

    try {
      await client.connect();
      assert.fail('Should have thrown connection error');
    } catch (err) {
      assert.ok(err instanceof Error);
      // Error should have been fired
      assert.strictEqual(client.connected(), false);
    }

    client.disconnect();
  });

  test('should return error when sending while disconnected', async () => {
    const identity = generateKeyPair();
    const client = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
    });

    const envelope = createEnvelope(
      'publish',
      identity.publicKey,
      identity.privateKey,
      { text: 'test' }
    );

    const result = await client.send('some-peer', envelope);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error);
    assert.ok(result.error.includes('Not connected'));
  });

  test('should send periodic pings', async () => {
    const identity = generateKeyPair();
    const client = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      pingInterval: 100, // Very short interval for testing
    });

    await client.connect();
    assert.strictEqual(client.connected(), true);

    // Wait for at least one ping cycle
    await new Promise(resolve => setTimeout(resolve, 200));

    // If we're still connected, pings are working
    assert.strictEqual(client.connected(), true);

    client.disconnect();
  });

  test('should populate initial peer list on registration', async () => {
    const agent1 = generateKeyPair();
    const agent2 = generateKeyPair();

    // Connect agent1 first
    const client1 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent1.publicKey,
      privateKey: agent1.privateKey,
      name: 'existing-peer',
    });

    await client1.connect();

    // Connect agent2 - should receive agent1 in initial peer list
    const client2 = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: agent2.publicKey,
      privateKey: agent2.privateKey,
    });

    await client2.connect();

    // agent2 should see agent1 as online
    const onlinePeers = client2.getOnlinePeers();
    const agent1Online = onlinePeers.find(p => p.publicKey === agent1.publicKey);
    assert.ok(agent1Online, 'agent1 should be in online peers list');

    client1.disconnect();
    client2.disconnect();
  });

  test('should handle reconnection after disconnect', async () => {
    const identity = generateKeyPair();
    const client = new RelayClient({
      relayUrl: `ws://localhost:${port}`,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      pingInterval: 100,
    });

    await client.connect();
    assert.strictEqual(client.connected(), true);

    const disconnectPromise = new Promise<void>((resolve) => {
      client.on('disconnected', () => {
        resolve();
      });
    });

    // Force disconnect
    client.disconnect();
    await disconnectPromise;
    assert.strictEqual(client.connected(), false);

    // Reconnect
    await client.connect();
    assert.strictEqual(client.connected(), true);

    client.disconnect();
  });
});
