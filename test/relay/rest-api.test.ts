/**
 * rest-api.test.ts — REST API endpoint tests for the Agora relay.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import {
  createRestRouter,
  type RelayInterface,
  type RestSession,
} from '../../src/relay/rest-api';
import { MessageBuffer } from '../../src/relay/message-buffer';

const TEST_JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';

function setJwtEnv(): void {
  process.env.AGORA_RELAY_JWT_SECRET = TEST_JWT_SECRET;
  process.env.AGORA_JWT_EXPIRY_SECONDS = '3600';
}

function clearJwtEnv(): void {
  delete process.env.AGORA_RELAY_JWT_SECRET;
  delete process.env.AGORA_JWT_EXPIRY_SECONDS;
}

function mockSocket(open = true): { readyState: number; sent: string[]; send(data: string): void } {
  return {
    readyState: open ? 1 : 3,
    sent: [] as string[],
    send(data: string): void {
      this.sent.push(data);
    },
  };
}

type MockRelay = RelayInterface & {
  _listeners: Array<(from: string, to: string, env: unknown) => void>;
  _emit(from: string, to: string, env: unknown): void;
};

function createMockRelay(
  agents: Map<
    string,
    {
      publicKey: string;
      name?: string;
      lastSeen: number;
      metadata?: { version?: string; capabilities?: string[] };
      socket: ReturnType<typeof mockSocket>;
    }
  > = new Map()
): MockRelay {
  const listeners: Array<(from: string, to: string, env: unknown) => void> = [];
  return {
    getAgents: (): ReturnType<RelayInterface['getAgents']> => agents as ReturnType<RelayInterface['getAgents']>,
    on(_event: string, handler: (from: string, to: string, env: unknown) => void): void {
      listeners.push(handler);
    },
    _listeners: listeners,
    _emit(from: string, to: string, env: unknown): void {
      listeners.forEach((h) => h(from, to, env));
    },
  };
}

let envelopeCounter = 0;
function mockCreateEnvelope(
  type: string,
  from: string,
  to: string[],
  _privateKey: string,
  payload: unknown,
  timestamp?: number,
  inReplyTo?: string
): { id: string; type: string; from: string; to: string[]; timestamp: number; payload: unknown; signature: string; inReplyTo?: string } {
  return {
    id: `env-${++envelopeCounter}`,
    type,
    from,
    to,
    timestamp: timestamp ?? Date.now(),
    payload,
    signature: `sig-${from.slice(-4)}`,
    ...(inReplyTo && { inReplyTo }),
  };
}

function mockVerifyEnvelope(env: unknown): { valid: boolean; reason?: string } {
  const e = env as { signature?: string };
  if (e.signature?.startsWith('sig-')) return { valid: true };
  return { valid: false, reason: 'bad signature' };
}

function buildApp(
  relay: MockRelay = createMockRelay(),
  buffer = new MessageBuffer(),
  sessions = new Map<string, RestSession>(),
  replayBuffer?: MessageBuffer
): { app: express.Express; relay: MockRelay; buffer: MessageBuffer; sessions: Map<string, RestSession>; replayBuffer?: MessageBuffer } {
  const app = express();
  app.use(express.json());
  app.use(
    createRestRouter(relay, buffer, sessions, mockCreateEnvelope, mockVerifyEnvelope, 60, replayBuffer)
  );
  return { app, relay, buffer, sessions, replayBuffer };
}

const ALICE = {
  publicKey: 'alice-pub-key-0000000000000000',
  privateKey: 'alice-priv-key-000000000000000',
  name: 'alice',
};
const BOB = {
  publicKey: 'bob-pub-key-00000000000000000',
  privateKey: 'bob-priv-key-0000000000000000',
  name: 'bob',
};

describe('POST /v1/register', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  it('returns token + expiresAt + peers on valid registration', async () => {
    const { app } = buildApp();
    const res = await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
      name: ALICE.name,
    });
    assert.strictEqual(res.status, 200);
    assert.ok(res.body.token);
    assert.strictEqual(typeof res.body.expiresAt, 'number');
    assert.ok(Array.isArray(res.body.peers));
  });

  it('stores session in registry', async () => {
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    assert.ok(sessions.has(ALICE.publicKey));
  });

  it('returns 400 when publicKey is missing', async () => {
    const { app } = buildApp();
    const res = await supertest(app).post('/v1/register').send({
      privateKey: ALICE.privateKey,
    });
    assert.strictEqual(res.status, 400);
    assert.ok(/publicKey/.test(res.body.error));
  });

  it('returns 400 when key pair verification fails', async () => {
    const badVerify = (): { valid: boolean; reason?: string } => ({ valid: false, reason: 'invalid key' });
    const sessions = new Map<string, RestSession>();
    const buffer = new MessageBuffer();
    const app = express();
    app.use(express.json());
    app.use(
      createRestRouter(
        createMockRelay(),
        buffer,
        sessions,
        mockCreateEnvelope,
        badVerify
      )
    );
    const res = await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: 'bad-key',
    });
    assert.strictEqual(res.status, 400);
    assert.ok(/verification failed/i.test(res.body.error));
  });
});

describe('POST /v1/send', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  async function registerAndGetToken(app: express.Express): Promise<string> {
    const res = await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
      name: ALICE.name,
    });
    return res.body.token as string;
  }

  it('returns 401 without auth header', async () => {
    const { app } = buildApp();
    const res = await supertest(app).post('/v1/send').send({
      to: BOB.publicKey,
      type: 'publish',
      payload: { text: 'hello' },
    });
    assert.strictEqual(res.status, 401);
  });

  it('delivers message to WS recipient', async () => {
    const bobSocket = mockSocket();
    const agents = new Map([
      [
        BOB.publicKey,
        {
          publicKey: BOB.publicKey,
          name: BOB.name,
          lastSeen: Date.now(),
          socket: bobSocket,
        },
      ],
    ]);
    const { app } = buildApp(createMockRelay(agents));
    const token = await registerAndGetToken(app);
    const res = await supertest(app)
      .post('/v1/send')
      .set('Authorization', `Bearer ${token}`)
      .send({ to: BOB.publicKey, type: 'publish', payload: { text: 'hello' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(res.body.envelopeId);
    assert.strictEqual(bobSocket.sent.length, 1);
    const sent = JSON.parse(bobSocket.sent[0]);
    assert.strictEqual(sent.type, 'message');
    assert.strictEqual(sent.from, ALICE.publicKey);
  });

  it('buffers message for REST recipient', async () => {
    const buffer = new MessageBuffer();
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), buffer, sessions);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
      name: ALICE.name,
    });
    await supertest(app).post('/v1/register').send({
      publicKey: BOB.publicKey,
      privateKey: BOB.privateKey,
      name: BOB.name,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const res = await supertest(app)
      .post('/v1/send')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ to: BOB.publicKey, type: 'publish', payload: { text: 'hi bob' } });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    const msgs = buffer.get(BOB.publicKey);
    assert.strictEqual(msgs.length, 1);
    assert.deepStrictEqual(msgs[0].payload, { text: 'hi bob' });
    assert.strictEqual(msgs[0].from, ALICE.publicKey);
  });

  it('returns 404 when recipient is not connected', async () => {
    const { app } = buildApp();
    const token = await registerAndGetToken(app);
    const res = await supertest(app)
      .post('/v1/send')
      .set('Authorization', `Bearer ${token}`)
      .send({
        to: 'unknown-peer',
        type: 'publish',
        payload: { text: 'hi' },
      });
    assert.strictEqual(res.status, 404);
    assert.ok(/not connected/i.test(res.body.error));
  });
});

describe('GET /v1/peers', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  it('returns 401 without auth', async () => {
    const { app } = buildApp();
    const res = await supertest(app).get('/v1/peers');
    assert.strictEqual(res.status, 401);
  });
});

describe('GET /v1/messages', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  it('returns 401 without auth', async () => {
    const { app } = buildApp();
    const res = await supertest(app).get('/v1/messages');
    assert.strictEqual(res.status, 401);
  });

  it('returns buffered messages', async () => {
    const buffer = new MessageBuffer();
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), buffer, sessions);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    buffer.add(ALICE.publicKey, {
      id: 'msg-1',
      from: BOB.publicKey,
      type: 'publish',
      payload: { text: 'hello' },
      timestamp: 1000,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const res = await supertest(app)
      .get('/v1/messages')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.messages.length, 1);
    assert.strictEqual(res.body.messages[0].payload.text, 'hello');
  });
});

describe('DELETE /v1/disconnect', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  it('returns 401 without auth', async () => {
    const { app } = buildApp();
    const res = await supertest(app).delete('/v1/disconnect');
    assert.strictEqual(res.status, 401);
  });

  it('removes session and clears buffer', async () => {
    const buffer = new MessageBuffer();
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), buffer, sessions);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    buffer.add(ALICE.publicKey, {
      id: 'm1',
      from: BOB.publicKey,
      type: 'publish',
      payload: {},
      timestamp: 1,
    });
    const res = await supertest(app)
      .delete('/v1/disconnect')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(!sessions.has(ALICE.publicKey));
    assert.strictEqual(buffer.get(ALICE.publicKey).length, 0);
  });
});

describe('Token expiry', () => {
  afterEach(clearJwtEnv);

  it('returns 401 with expired token', async () => {
    process.env.AGORA_RELAY_JWT_SECRET = TEST_JWT_SECRET;
    const { app } = buildApp();
    const expiredToken = jwt.sign(
      { publicKey: ALICE.publicKey, jti: 'expired-jti' },
      TEST_JWT_SECRET,
      { expiresIn: -1 }
    );
    const res = await supertest(app)
      .get('/v1/peers')
      .set('Authorization', `Bearer ${expiredToken}`);
    assert.strictEqual(res.status, 401);
    assert.ok(/expired/i.test(res.body.error));
  });
});

describe('GET /v1/messages/replay', () => {
  beforeEach(setJwtEnv);
  afterEach(clearJwtEnv);

  it('returns 401 without auth', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), new Map(), replayBuffer);
    const res = await supertest(app).get('/v1/messages/replay?since=2024-01-01T00:00:00.000Z');
    assert.strictEqual(res.status, 401);
  });

  it('returns 501 when replay buffer is not configured', async () => {
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(Date.now() - 60_000).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${since}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 501);
    assert.ok(res.body.error);
  });

  it('returns 400 when `since` is missing', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const res = await supertest(app)
      .get('/v1/messages/replay')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 for invalid ISO8601 timestamp', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const res = await supertest(app)
      .get('/v1/messages/replay?since=not-a-timestamp')
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error);
  });

  it('returns 400 with retention_exceeded when since is older than retention window', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });
    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    // Use a timestamp 8 days in the past (beyond 7-day retention)
    const oldSince = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${oldSince}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 400);
    assert.strictEqual(res.body.error, 'retention_exceeded');
    assert.ok(res.body.message);
  });

  it('returns messages after the since timestamp', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });

    const now = Date.now();
    const sinceMs = now - 60_000; // 1 minute ago

    // Add a message before since (should not appear)
    replayBuffer.add(ALICE.publicKey, {
      id: 'old-msg',
      from: BOB.publicKey,
      type: 'publish',
      payload: { text: 'old' },
      timestamp: sinceMs - 1000,
    });
    // Add a message after since (should appear)
    replayBuffer.add(ALICE.publicKey, {
      id: 'new-msg',
      from: BOB.publicKey,
      type: 'publish',
      payload: { text: 'new' },
      timestamp: sinceMs + 1000,
    });

    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(sinceMs).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${since}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.messages.length, 1);
    assert.strictEqual(res.body.messages[0].id, 'new-msg');
    assert.strictEqual(res.body.hasMore, false);
  });

  it('does not clear replay buffer after read', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });

    const sinceMs = Date.now() - 60_000;
    replayBuffer.add(ALICE.publicKey, {
      id: 'replay-msg',
      from: BOB.publicKey,
      type: 'publish',
      payload: { text: 'replay' },
      timestamp: sinceMs + 1000,
    });

    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(sinceMs).toISOString();

    // First read
    const res1 = await supertest(app)
      .get(`/v1/messages/replay?since=${since}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res1.status, 200);
    assert.strictEqual(res1.body.messages.length, 1);

    // Second read — same message should still be there (not cleared)
    const res2 = await supertest(app)
      .get(`/v1/messages/replay?since=${since}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res2.status, 200);
    assert.strictEqual(res2.body.messages.length, 1);
  });

  it('respects the limit parameter (max 500)', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });

    const sinceMs = Date.now() - 60_000;
    for (let i = 0; i < 10; i++) {
      replayBuffer.add(ALICE.publicKey, {
        id: `msg-${i}`,
        from: BOB.publicKey,
        type: 'publish',
        payload: {},
        timestamp: sinceMs + 1000 + i,
      });
    }

    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(sinceMs).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${since}&limit=3`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.messages.length, 3);
    assert.strictEqual(res.body.hasMore, true);
  });

  it('caps limit at 500', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const { app } = buildApp(createMockRelay(), new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });

    const sinceMs = Date.now() - 60_000;
    // Add 505 messages to exceed the 500 cap
    for (let i = 0; i < 505; i++) {
      replayBuffer.add(ALICE.publicKey, {
        id: `msg-${i}`,
        from: BOB.publicKey,
        type: 'publish',
        payload: {},
        timestamp: sinceMs + 1000 + i,
      });
    }

    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(sinceMs).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${since}&limit=1000`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    // limit=1000 is capped at 500; 505 messages exist so hasMore should be true
    assert.strictEqual(res.body.messages.length, 500);
    assert.strictEqual(res.body.hasMore, true);
  });

  it('buffers messages via relay event into replay buffer', async () => {
    const replayBuffer = new MessageBuffer({ ttlMs: 7 * 24 * 60 * 60 * 1000, maxMessages: 10000 });
    const sessions = new Map<string, RestSession>();
    const relay = createMockRelay();
    const { app } = buildApp(relay, new MessageBuffer(), sessions, replayBuffer);
    await supertest(app).post('/v1/register').send({
      publicKey: ALICE.publicKey,
      privateKey: ALICE.privateKey,
    });

    const sinceMs = Date.now() - 60_000;

    // Emit a relay event (simulates a message being relayed)
    relay._emit(BOB.publicKey, ALICE.publicKey, {
      id: 'relayed-1',
      type: 'publish',
      from: BOB.publicKey,
      to: [ALICE.publicKey],
      payload: { text: 'from relay' },
      timestamp: sinceMs + 1000,
    });

    const aliceToken = sessions.get(ALICE.publicKey)!.token;
    const since = new Date(sinceMs).toISOString();
    const res = await supertest(app)
      .get(`/v1/messages/replay?since=${since}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.messages.length, 1);
    assert.strictEqual(res.body.messages[0].id, 'relayed-1');
  });
});

describe('MessageBuffer', () => {
  it('evicts oldest messages when full (max 100)', () => {
    const buf = new MessageBuffer();
    const key = 'agent-1';
    for (let i = 0; i < 105; i++) {
      buf.add(key, {
        id: `m${i}`,
        from: 'a',
        type: 't',
        payload: {},
        timestamp: i,
      });
    }
    const msgs = buf.get(key);
    assert.strictEqual(msgs.length, 100);
    assert.strictEqual(msgs[0].id, 'm5');
    assert.strictEqual(msgs[99].id, 'm104');
  });

  it('filters by since (exclusive)', () => {
    const buf = new MessageBuffer();
    buf.add('k', {
      id: 'a',
      from: 'x',
      type: 't',
      payload: {},
      timestamp: 100,
    });
    buf.add('k', {
      id: 'b',
      from: 'x',
      type: 't',
      payload: {},
      timestamp: 200,
    });
    buf.add('k', {
      id: 'c',
      from: 'x',
      type: 't',
      payload: {},
      timestamp: 300,
    });
    const result = buf.get('k', 100);
    assert.strictEqual(result.length, 2);
    assert.strictEqual(result[0].id, 'b');
  });

  it('clear empties the buffer', () => {
    const buf = new MessageBuffer();
    buf.add('k', {
      id: 'a',
      from: 'x',
      type: 't',
      payload: {},
      timestamp: 1,
    });
    buf.clear('k');
    assert.strictEqual(buf.get('k').length, 0);
  });
});
