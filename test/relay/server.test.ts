/**
 * server.test.ts — WebSocket RelayServer tests (multi-session, storage).
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import WebSocket from 'ws';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { RelayServer } from '../../src/relay/server';
import { MessageStore } from '../../src/relay/store';
import { generateKeyPair } from '../../src/identity/keypair';
import { createEnvelope } from '../../src/message/envelope';

const TEST_PORT = 9471;
const STORAGE_PORT = 9472;

describe('RelayServer', () => {
  let server: RelayServer;

  beforeEach(async () => {
    server = new RelayServer();
    await server.start(TEST_PORT);
  });

  afterEach(async () => {
    await server.stop();
  });

  it('should start and stop successfully', () => {
    assert.ok(server);
  });

  it('should allow multiple sessions for the same public key', async () => {
    const client1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const client2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await Promise.all([
      new Promise<void>((r) => client1.on('open', r)),
      new Promise<void>((r) => client2.on('open', r)),
    ]);

    const msg1 = await new Promise<any>((resolve) => {
      client1.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered') resolve(msg);
      });
      client1.send(JSON.stringify({ type: 'register', publicKey: 'duplicate' }));
    });
    assert.ok(msg1.sessionId, 'sessionId in response');

    const msg2 = await new Promise<any>((resolve) => {
      client2.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'registered') resolve(msg);
      });
      client2.send(JSON.stringify({ type: 'register', publicKey: 'duplicate' }));
    });
    assert.ok(msg2.sessionId);
    assert.notStrictEqual(msg1.sessionId, msg2.sessionId);

    assert.strictEqual(client1.readyState, WebSocket.OPEN);
    assert.strictEqual(client2.readyState, WebSocket.OPEN);

    client1.close();
    client2.close();
  });

  it('should deliver messages to all sessions of the recipient', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const envelope = createEnvelope('publish', alice.publicKey, alice.privateKey, { text: 'hello all sessions' }, Date.now(), undefined, [bob.publicKey]);

    const sender = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const recipient1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const recipient2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await Promise.all([
      new Promise<void>((r) => sender.on('open', r)),
      new Promise<void>((r) => recipient1.on('open', r)),
      new Promise<void>((r) => recipient2.on('open', r)),
    ]);

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: alice.publicKey }));
    });

    await new Promise<void>((resolve) => {
      recipient1.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      recipient1.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });
    await new Promise<void>((resolve) => {
      recipient2.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      recipient2.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    const r1Messages: any[] = [];
    const r2Messages: any[] = [];
    recipient1.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'message') r1Messages.push(msg);
    });
    recipient2.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'message') r2Messages.push(msg);
    });

    sender.send(JSON.stringify({ type: 'message', to: bob.publicKey, envelope }));
    await new Promise((r) => setTimeout(r, 100));

    assert.strictEqual(r1Messages.length, 1);
    assert.strictEqual(r2Messages.length, 1);
    assert.deepStrictEqual(r1Messages[0].envelope.payload, { text: 'hello all sessions' });
    assert.deepStrictEqual(r2Messages[0].envelope.payload, { text: 'hello all sessions' });

    sender.close();
    recipient1.close();
    recipient2.close();
  });

  it('should send peer_offline only when the last session disconnects', async () => {
    const observer = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const session1 = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const session2 = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await Promise.all([
      new Promise<void>((r) => observer.on('open', r)),
      new Promise<void>((r) => session1.on('open', r)),
      new Promise<void>((r) => session2.on('open', r)),
    ]);

    await new Promise<void>((resolve) => {
      observer.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      observer.send(JSON.stringify({ type: 'register', publicKey: 'observer' }));
    });
    await new Promise<void>((resolve) => {
      session1.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      session1.send(JSON.stringify({ type: 'register', publicKey: 'multi' }));
    });
    await new Promise<void>((resolve) => {
      session2.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      session2.send(JSON.stringify({ type: 'register', publicKey: 'multi' }));
    });

    const observerEvents: any[] = [];
    observer.on('message', (data: Buffer) => observerEvents.push(JSON.parse(data.toString())));

    session1.close();
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(observerEvents.filter((m: any) => m.type === 'peer_offline').length, 0);

    session2.close();
    await new Promise((r) => setTimeout(r, 100));
    const offlineEvents = observerEvents.filter((m: any) => m.type === 'peer_offline');
    assert.strictEqual(offlineEvents.length, 1);
    assert.strictEqual(offlineEvents[0].publicKey, 'multi');

    observer.close();
  });

  it('should include sessionId in the registered response', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise<void>((r) => ws.on('open', r));

    const msg = await new Promise<any>((resolve) => {
      ws.on('message', (data: Buffer) => {
        const m = JSON.parse(data.toString());
        if (m.type === 'registered') resolve(m);
      });
      ws.send(JSON.stringify({ type: 'register', publicKey: 'session-test' }));
    });
    assert.ok(msg.sessionId);
    assert.strictEqual(typeof msg.sessionId, 'string');

    ws.close();
  });

  it('should emit disconnection event when client disconnects', async () => {
    const disconnectedKey = await new Promise<string>((resolve) => {
      server.on('disconnection', (publicKey: string) => resolve(publicKey));
      const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'register', publicKey: 'disconnect-test' }));
      });
      ws.on('message', () => ws.close());
    });
    assert.strictEqual(disconnectedKey, 'disconnect-test');
  });

  it('should respond to ping with pong', async () => {
    const ws = new WebSocket(`ws://localhost:${TEST_PORT}`);
    await new Promise<void>((r) => ws.on('open', r));

    await new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      ws.send(JSON.stringify({ type: 'register', publicKey: 'ping-test' }));
    });

    await new Promise<void>((resolve) => {
      ws.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'pong') resolve();
      });
      ws.send(JSON.stringify({ type: 'ping' }));
    });

    ws.close();
  });

  it('should drop duplicate envelope IDs before forwarding', async () => {
    const alice = generateKeyPair();
    const bob = generateKeyPair();
    const envelope = createEnvelope('publish', alice.publicKey, alice.privateKey, { text: 'dedup me' }, Date.now(), undefined, [bob.publicKey]);

    const sender = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const recipient = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await Promise.all([
      new Promise<void>((r) => sender.on('open', r)),
      new Promise<void>((r) => recipient.on('open', r)),
    ]);

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: alice.publicKey }));
    });

    await new Promise<void>((resolve) => {
      recipient.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      recipient.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    const received: any[] = [];
    recipient.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'message') {
        received.push(msg);
      }
    });

    sender.send(JSON.stringify({ type: 'message', to: bob.publicKey, envelope }));
    sender.send(JSON.stringify({ type: 'message', to: bob.publicKey, envelope }));

    await new Promise((r) => setTimeout(r, 120));

    assert.strictEqual(received.length, 1);
    assert.strictEqual(received[0].envelope.id, envelope.id);

    sender.close();
    recipient.close();
  });

  it('should enforce per-sender rate limit before forwarding', async () => {
    const limitedServer = new RelayServer({
      rateLimit: { enabled: true, maxMessages: 3, windowMs: 60_000 },
    });
    await server.stop();
    server = limitedServer;
    await server.start(TEST_PORT);

    const alice = generateKeyPair();
    const bob = generateKeyPair();

    const sender = new WebSocket(`ws://localhost:${TEST_PORT}`);
    const recipient = new WebSocket(`ws://localhost:${TEST_PORT}`);

    await Promise.all([
      new Promise<void>((r) => sender.on('open', r)),
      new Promise<void>((r) => recipient.on('open', r)),
    ]);

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: alice.publicKey }));
    });

    await new Promise<void>((resolve) => {
      recipient.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      recipient.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    const received: any[] = [];
    recipient.on('message', (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'message') {
        received.push(msg);
      }
    });

    for (let i = 0; i < 5; i++) {
      const envelope = createEnvelope('publish', alice.publicKey, alice.privateKey, { seq: i }, Date.now(), undefined, [bob.publicKey]);
      sender.send(JSON.stringify({ type: 'message', to: bob.publicKey, envelope }));
    }

    await new Promise((r) => setTimeout(r, 150));
    assert.strictEqual(received.length, 3);

    sender.close();
    recipient.close();
  });
});

describe('MessageStore', () => {
  let storageDir: string;

  beforeEach(() => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-relay-test-'));
  });

  afterEach(() => {
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('should save and load messages for a recipient', () => {
    const store = new MessageStore(storageDir);
    store.save('alice', { from: 'bob', envelope: { data: 'hello' } });
    const messages = store.load('alice');
    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].from, 'bob');
    assert.deepStrictEqual(messages[0].envelope, { data: 'hello' });
  });

  it('should return empty array when no messages stored', () => {
    const store = new MessageStore(storageDir);
    assert.deepStrictEqual(store.load('nobody'), []);
  });

  it('should clear stored messages after delivery', () => {
    const store = new MessageStore(storageDir);
    store.save('alice', { from: 'bob', envelope: { data: 'hello' } });
    store.clear('alice');
    assert.deepStrictEqual(store.load('alice'), []);
  });
});

describe('RelayServer with file-backed storage', () => {
  let server: RelayServer;
  let storageDir: string;

  beforeEach(async () => {
    storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agora-relay-test-'));
    server = new RelayServer({ storagePeers: ['alice'], storageDir });
    await server.start(STORAGE_PORT);
  });

  afterEach(async () => {
    await server.stop();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });

  it('should queue message for storage-enabled offline peer without error', async () => {
    const bob = generateKeyPair();
    const envelope = createEnvelope('publish', bob.publicKey, bob.privateKey, { text: 'offline message' }, Date.now(), undefined, ['alice']);

    const sender = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    await new Promise<void>((r) => sender.on('open', r));

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    const received: any[] = [];
    sender.on('message', (data: Buffer) => received.push(JSON.parse(data.toString())));

    sender.send(JSON.stringify({ type: 'message', to: 'alice', envelope }));
    await new Promise((r) => setTimeout(r, 100));

    const errors = received.filter((m: any) => m.type === 'error');
    assert.strictEqual(errors.length, 0);

    sender.close();
  });

  it('should deliver queued messages when storage-enabled peer reconnects', async () => {
    const bob = generateKeyPair();
    const envelope = createEnvelope('publish', bob.publicKey, bob.privateKey, { text: 'stored for alice' }, Date.now(), undefined, ['alice']);

    const sender = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    await new Promise<void>((r) => sender.on('open', r));

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    sender.send(JSON.stringify({ type: 'message', to: 'alice', envelope }));
    await new Promise((r) => setTimeout(r, 100));

    const alice = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    await new Promise<void>((r) => alice.on('open', r));

    const aliceMessages: any[] = [];
    await new Promise<void>((resolve) => {
      alice.on('message', (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        aliceMessages.push(msg);
        if (msg.type === 'registered') resolve();
      });
      alice.send(JSON.stringify({ type: 'register', publicKey: 'alice' }));
    });

    await new Promise((r) => setTimeout(r, 100));

    const delivered = aliceMessages.filter((m: any) => m.type === 'message');
    assert.strictEqual(delivered.length, 1);
    assert.strictEqual(delivered[0].from, bob.publicKey);
    assert.strictEqual((delivered[0].envelope as any).payload?.text, 'stored for alice');

    sender.close();
    alice.close();
  });

  it('should include storage-enabled offline peers in the registered peers list', async () => {
    const bob = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    await new Promise<void>((r) => bob.on('open', r));

    const msg = await new Promise<any>((resolve) => {
      bob.on('message', (data: Buffer) => {
        const m = JSON.parse(data.toString());
        if (m.type === 'registered') resolve(m);
      });
      bob.send(JSON.stringify({ type: 'register', publicKey: 'bob' }));
    });

    const peerKeys = msg.peers.map((p: any) => p.publicKey);
    assert.ok(peerKeys.includes('alice'));

    bob.close();
  });

  it('should not broadcast peer_offline when a storage-enabled peer disconnects', async () => {
    const alice = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    const bob = new WebSocket(`ws://localhost:${STORAGE_PORT}`);

    await Promise.all([
      new Promise<void>((r) => alice.on('open', r)),
      new Promise<void>((r) => bob.on('open', r)),
    ]);

    await new Promise<void>((resolve) => {
      alice.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      alice.send(JSON.stringify({ type: 'register', publicKey: 'alice' }));
    });
    await new Promise<void>((resolve) => {
      bob.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      bob.send(JSON.stringify({ type: 'register', publicKey: 'bob' }));
    });

    const bobReceived: any[] = [];
    bob.on('message', (data: Buffer) => bobReceived.push(JSON.parse(data.toString())));

    alice.close();
    await new Promise((r) => setTimeout(r, 100));

    const offlineEvents = bobReceived.filter((m: any) => m.type === 'peer_offline');
    assert.strictEqual(offlineEvents.length, 0);

    bob.close();
  });

  it('should still return error for non-storage-enabled offline peers', async () => {
    const bob = generateKeyPair();
    const envelope = createEnvelope('publish', bob.publicKey, bob.privateKey, { x: 1 }, Date.now(), undefined, ['charlie']);

    const sender = new WebSocket(`ws://localhost:${STORAGE_PORT}`);
    await new Promise<void>((r) => sender.on('open', r));

    await new Promise<void>((resolve) => {
      sender.on('message', (data: Buffer) => {
        if (JSON.parse(data.toString()).type === 'registered') resolve();
      });
      sender.send(JSON.stringify({ type: 'register', publicKey: bob.publicKey }));
    });

    const errorMsg = await new Promise<any>((resolve) => {
      sender.on('message', (data: Buffer) => {
        const m = JSON.parse(data.toString());
        if (m.type === 'error') resolve(m);
      });
      sender.send(JSON.stringify({ type: 'message', to: 'charlie', envelope }));
    });

    assert.strictEqual(errorMsg.code, 'unknown_recipient');

    sender.close();
  });
});
