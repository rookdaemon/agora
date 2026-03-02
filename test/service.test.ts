import { describe, it, mock, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair';
import {
  AgoraService,
  type AgoraServiceConfig,
  type RelayClientLike,
  type RelayClientFactory,
} from '../src/service';
import type { PeerConfig } from '../src/transport/http';

function createMockRelayClient(options?: {
  connected?: boolean;
  sendResult?: { ok: boolean; error?: string };
}): RelayClientLike {
  const connected = options?.connected ?? true;
  const sendResult = options?.sendResult ?? { ok: true };

  return {
    connect: mock.fn(async () => {}),
    disconnect: mock.fn(() => {}),
    connected: mock.fn(() => connected),
    send: mock.fn(async () => sendResult),
    on: mock.fn(() => {}),
  };
}

describe('AgoraService.sendMessage', () => {
  const identity = generateKeyPair();
  const peerIdentity = generateKeyPair();
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('should send via HTTP when peer has a webhook URL', async () => {
    const mockFetch = mock.fn(async () =>
      new Response(null, { status: 200, statusText: 'OK' })
    );
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
    };

    const service = new AgoraService(config, () => {});
    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'hello' },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 200);
    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  it('should fall back to relay when peer has no webhook URL', async () => {
    const relayClient = createMockRelayClient();

    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      // no url — relay-only peer
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['stefan', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.sendMessage({
      peerName: 'stefan',
      type: 'publish',
      payload: { text: 'hello via relay' },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 0);
    assert.strictEqual((relayClient.send as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  });

  it('should fall back to relay when HTTP send fails', async () => {
    const mockFetch = mock.fn(async () => {
      throw new Error('Connection refused');
    });
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'fallback' },
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 0);
    assert.strictEqual(mockFetch.mock.callCount(), 2); // one retry on network error
    assert.strictEqual((relayClient.send as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  });

  it('should return error when both HTTP and relay fail', async () => {
    const mockFetch = mock.fn(async () => {
      throw new Error('Connection refused');
    });
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const relayClient = createMockRelayClient({
      connected: true,
      sendResult: { ok: false, error: 'Relay send failed' },
    });
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'will fail' },
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'Relay send failed');
  });

  it('should return error when no URL and relay not connected', async () => {
    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      // no url — relay-only peer
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['stefan', peer]]),
    };

    const service = new AgoraService(config, () => {});

    const result = await service.sendMessage({
      peerName: 'stefan',
      type: 'publish',
      payload: { text: 'no route' },
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('relay not available'));
  });

  it('should return error for unknown peer', async () => {
    const config: AgoraServiceConfig = {
      identity,
      peers: new Map(),
    };

    const service = new AgoraService(config, () => {});

    const result = await service.sendMessage({
      peerName: 'nonexistent',
      type: 'publish',
      payload: {},
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('Unknown peer'));
  });

  it('should succeed with --direct when peer URL is reachable', async () => {
    const mockFetch = mock.fn(async () =>
      new Response(null, { status: 200, statusText: 'OK' })
    );
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {});
    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'direct' },
      direct: true,
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(mockFetch.mock.callCount(), 1);
  });

  it('should fail with --direct when peer URL is unreachable (no relay fallback)', async () => {
    const mockFetch = mock.fn(async () => {
      throw new Error('Connection refused');
    });
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'direct fail' },
      direct: true,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('Direct send'));
    // Should NOT have used relay
    assert.strictEqual((relayClient.send as ReturnType<typeof mock.fn>).mock.callCount(), 0);
  });

  it('should fail with --direct when peer has no URL configured', async () => {
    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      // no url
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {});
    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'no url' },
      direct: true,
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('no URL configured'));
  });

  it('should skip HTTP and use relay with --relay-only', async () => {
    const mockFetch = mock.fn(async () =>
      new Response(null, { status: 200, statusText: 'OK' })
    );
    // @ts-expect-error - replacing global fetch
    globalThis.fetch = mockFetch;

    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const peer: PeerConfig = {
      publicKey: peerIdentity.publicKey,
      url: 'http://localhost:18790/hooks',
      token: 'test-token',
    };

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['testpeer', peer]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.sendMessage({
      peerName: 'testpeer',
      type: 'publish',
      payload: { text: 'relay only' },
      relayOnly: true,
    });

    assert.strictEqual(result.ok, true);
    // HTTP should NOT have been called
    assert.strictEqual(mockFetch.mock.callCount(), 0);
    // Relay should have been called
    assert.strictEqual((relayClient.send as ReturnType<typeof mock.fn>).mock.callCount(), 1);
  });
});

describe('AgoraService.replyToEnvelope', () => {
  const identity = generateKeyPair();
  const unknownPeerIdentity = generateKeyPair();

  it('should send via relay when connected', async () => {
    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map(), // empty — target is NOT a configured peer
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.replyToEnvelope({
      targetPubkey: unknownPeerIdentity.publicKey,
      type: 'publish',
      payload: { text: 'hello stranger' },
      inReplyTo: 'envelope-abc-123',
    });

    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.status, 0);
    assert.strictEqual((relayClient.send as ReturnType<typeof mock.fn>).mock.callCount(), 1);

    // Verify the relay was called with the correct target pubkey
    const sendCall = (relayClient.send as ReturnType<typeof mock.fn>).mock.calls[0];
    assert.strictEqual(sendCall.arguments[0], unknownPeerIdentity.publicKey);
  });

  it('should fail when relay is not connected', async () => {
    const config: AgoraServiceConfig = {
      identity,
      peers: new Map(),
      // no relay configured
    };

    const service = new AgoraService(config, () => {});

    const result = await service.replyToEnvelope({
      targetPubkey: unknownPeerIdentity.publicKey,
      type: 'publish',
      payload: { text: 'hello' },
      inReplyTo: 'envelope-abc-123',
    });

    assert.strictEqual(result.ok, false);
    assert.ok(result.error?.includes('Relay not connected'));
  });

  it('should work with arbitrary pubkey not in peers map', async () => {
    const randomPubkey = generateKeyPair().publicKey;
    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map([['known-peer', { publicKey: 'some-other-key' }]]),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.replyToEnvelope({
      targetPubkey: randomPubkey,
      type: 'publish',
      payload: { text: 'to an unknown peer' },
      inReplyTo: 'envelope-xyz',
    });

    assert.strictEqual(result.ok, true);
    const sendCall = (relayClient.send as ReturnType<typeof mock.fn>).mock.calls[0];
    assert.strictEqual(sendCall.arguments[0], randomPubkey);
  });

  it('should propagate relay send errors', async () => {
    const relayClient = createMockRelayClient({
      connected: true,
      sendResult: { ok: false, error: 'Recipient not connected' },
    });
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map(),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    const result = await service.replyToEnvelope({
      targetPubkey: unknownPeerIdentity.publicKey,
      type: 'publish',
      payload: { text: 'will fail' },
      inReplyTo: 'envelope-fail',
    });

    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, 'Recipient not connected');
  });

  it('should set inReplyTo on the created envelope', async () => {
    const relayClient = createMockRelayClient();
    const relayClientFactory: RelayClientFactory = mock.fn(() => relayClient);

    const config: AgoraServiceConfig = {
      identity,
      peers: new Map(),
      relay: { url: 'wss://relay.example.com', autoConnect: true },
    };

    const service = new AgoraService(config, () => {}, undefined, relayClientFactory);
    await service.connectRelay('wss://relay.example.com');

    await service.replyToEnvelope({
      targetPubkey: unknownPeerIdentity.publicKey,
      type: 'publish',
      payload: { text: 'reply' },
      inReplyTo: 'original-envelope-id-999',
    });

    // The envelope passed to relay.send should have inReplyTo set
    const sendCall = (relayClient.send as ReturnType<typeof mock.fn>).mock.calls[0];
    const envelope = sendCall.arguments[1];
    assert.strictEqual(envelope.inReplyTo, 'original-envelope-id-999');
  });
});
