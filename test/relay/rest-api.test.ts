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
} from '../../src/relay/rest-api.js';
import { MessageBuffer } from '../../src/relay/message-buffer.js';

const TEST_JWT_SECRET = 'test-secret-at-least-32-bytes-long!!';

function setJwtEnv() {
  process.env.AGORA_RELAY_JWT_SECRET = TEST_JWT_SECRET;
  process.env.AGORA_JWT_EXPIRY_SECONDS = '3600';
}

function clearJwtEnv() {
  delete process.env.AGORA_RELAY_JWT_SECRET;
  delete process.env.AGORA_JWT_EXPIRY_SECONDS;
}

function mockSocket(open = true) {
  return {
    readyState: open ? 1 : 3,
    sent: [] as string[],
    send(data: string) {
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
    getAgents: () => agents as ReturnType<RelayInterface['getAgents']>,
    on(_event: string, handler: (from: string, to: string, env: unknown) => void) {
      listeners.push(handler);
    },
    _listeners: listeners,
    _emit(from: string, to: string, env: unknown) {
      listeners.forEach((h) => h(from, to, env));
    },
  };
}

let envelopeCounter = 0;
function mockCreateEnvelope(
  type: string,
  sender: string,
  _privateKey: string,
  payload: unknown,
  timestamp?: number,
  inReplyTo?: string
) {
  return {
    id: `env-${++envelopeCounter}`,
    type,
    sender,
    timestamp: timestamp ?? Date.now(),
    payload,
    signature: `sig-${sender.slice(-4)}`,
    ...(inReplyTo && { inReplyTo }),
  };
}

function mockVerifyEnvelope(env: unknown) {
  const e = env as { signature?: string };
  if (e.signature?.startsWith('sig-')) return { valid: true };
  return { valid: false, reason: 'bad signature' };
}

function buildApp(
  relay: MockRelay = createMockRelay(),
  buffer = new MessageBuffer(),
  sessions = new Map<string, RestSession>()
) {
  const app = express();
  app.use(express.json());
  app.use(
    createRestRouter(relay, buffer, sessions, mockCreateEnvelope, mockVerifyEnvelope)
  );
  return { app, relay, buffer, sessions };
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
    const badVerify = () => ({ valid: false, reason: 'invalid key' });
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

  async function registerAndGetToken(app: express.Express) {
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
      fromName: 'bob',
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
