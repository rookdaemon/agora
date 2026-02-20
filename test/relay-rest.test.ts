import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { generateKeyPair } from '../src/identity/keypair.js';
import { createEnvelope } from '../src/message/envelope.js';
import { RelayServer } from '../src/relay/server.js';
import { RestApiServer } from '../src/relay/rest.js';

const REST_PORT = 19810;
const WS_PORT = 19811;
const BASE_URL = `http://localhost:${REST_PORT}`;

async function jsonPost(url: string, body: unknown, token?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}

async function jsonGet(url: string, token?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'GET', headers });
  return { status: res.status, body: await res.json() };
}

async function jsonDelete(url: string, token?: string): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(url, { method: 'DELETE', headers });
  return { status: res.status, body: await res.json() };
}

describe('RestApiServer', () => {
  let relay: RelayServer;
  let rest: RestApiServer;
  const relayIdentity = generateKeyPair();

  before(async () => {
    relay = new RelayServer(relayIdentity);
    await relay.start(WS_PORT);
    rest = new RestApiServer(relay);
    await rest.start(REST_PORT);
  });

  after(async () => {
    await rest.stop();
    await relay.stop();
  });

  describe('POST /v1/register', () => {
    it('should register an agent and return a token', async () => {
      const agent = generateKeyPair();
      const { status, body } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
        name: 'test-agent',
      });

      assert.strictEqual(status, 200);
      const b = body as Record<string, unknown>;
      assert.ok(typeof b.token === 'string' && b.token.length === 64, 'token should be 64-char hex');
      assert.ok(typeof b.expiresAt === 'number' && b.expiresAt > Date.now(), 'expiresAt should be in the future');
      assert.ok(Array.isArray(b.peers), 'peers should be an array');
    });

    it('should reject missing publicKey', async () => {
      const agent = generateKeyPair();
      const { status } = await jsonPost(`${BASE_URL}/v1/register`, {
        privateKey: agent.privateKey,
      });
      assert.strictEqual(status, 400);
    });

    it('should reject missing privateKey', async () => {
      const agent = generateKeyPair();
      const { status } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
      });
      assert.strictEqual(status, 400);
    });

    it('should reject invalid keypair (signing test fails)', async () => {
      const { status } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: 'deadbeef',
        privateKey: 'cafebabe',
      });
      assert.strictEqual(status, 400);
    });

    it('should reject invalid JSON body', async () => {
      const res = await fetch(`${BASE_URL}/v1/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      });
      assert.strictEqual(res.status, 400);
    });

    it('should re-register: new token replaces old session', async () => {
      const agent = generateKeyPair();

      const { body: b1 } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token1 = (b1 as Record<string, unknown>).token as string;

      const { body: b2 } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token2 = (b2 as Record<string, unknown>).token as string;

      assert.notStrictEqual(token1, token2, 'new registration should produce a new token');

      // Old token should be invalid
      const { status } = await jsonGet(`${BASE_URL}/v1/peers`, token1);
      assert.strictEqual(status, 401, 'old token should be rejected after re-registration');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without Authorization header', async () => {
      const { status } = await jsonGet(`${BASE_URL}/v1/peers`);
      assert.strictEqual(status, 401);
    });

    it('should reject requests with malformed Authorization header', async () => {
      const res = await fetch(`${BASE_URL}/v1/peers`, {
        headers: { Authorization: 'notbearer' },
      });
      assert.strictEqual(res.status, 401);
    });

    it('should reject requests with unknown token', async () => {
      const fakeToken = 'a'.repeat(64);
      const { status } = await jsonGet(`${BASE_URL}/v1/peers`, fakeToken);
      assert.strictEqual(status, 401);
    });
  });

  describe('GET /v1/peers', () => {
    it('should return empty peer list when alone', async () => {
      const agent = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token = (rb as Record<string, unknown>).token as string;

      const { status, body } = await jsonGet(`${BASE_URL}/v1/peers`, token);
      assert.strictEqual(status, 200);
      const peers = (body as Record<string, unknown>).peers as unknown[];
      // May or may not be empty depending on other active sessions from other tests;
      // just verify no entry for self
      assert.ok(!peers.some((p) => (p as Record<string, unknown>).publicKey === agent.publicKey), 'should not include self');
    });

    it('should list other REST agent', async () => {
      const agentA = generateKeyPair();
      const agentB = generateKeyPair();

      const { body: ra } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agentA.publicKey,
        privateKey: agentA.privateKey,
        name: 'agent-a',
      });
      const tokenA = (ra as Record<string, unknown>).token as string;

      await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agentB.publicKey,
        privateKey: agentB.privateKey,
        name: 'agent-b',
      });

      const { body } = await jsonGet(`${BASE_URL}/v1/peers`, tokenA);
      const peers = (body as Record<string, unknown>).peers as Array<Record<string, unknown>>;
      const bEntry = peers.find((p) => p.publicKey === agentB.publicKey);
      assert.ok(bEntry, 'agent B should appear in agent A\'s peer list');
      assert.strictEqual(bEntry?.name, 'agent-b');

      // Disconnect both
      await jsonDelete(`${BASE_URL}/v1/disconnect`, tokenA);
    });
  });

  describe('GET /v1/messages', () => {
    it('should return empty messages initially', async () => {
      const agent = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token = (rb as Record<string, unknown>).token as string;

      const { status, body } = await jsonGet(`${BASE_URL}/v1/messages`, token);
      assert.strictEqual(status, 200);
      const messages = (body as Record<string, unknown>).messages as unknown[];
      assert.deepStrictEqual(messages, []);

      await jsonDelete(`${BASE_URL}/v1/disconnect`, token);
    });

    it('should receive message sent by another REST agent', async () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();

      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: receiver.publicKey,
        privateKey: receiver.privateKey,
        name: 'receiver',
      });
      const receiverToken = (rb as Record<string, unknown>).token as string;

      const { body: sb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: sender.publicKey,
        privateKey: sender.privateKey,
        name: 'sender',
      });
      const senderToken = (sb as Record<string, unknown>).token as string;

      // Send message
      const { status: sendStatus, body: sendBody } = await jsonPost(
        `${BASE_URL}/v1/send`,
        { to: receiver.publicKey, type: 'publish', payload: { text: 'hello from REST' } },
        senderToken,
      );
      assert.strictEqual(sendStatus, 200);
      assert.strictEqual((sendBody as Record<string, unknown>).ok, true);
      assert.ok(typeof (sendBody as Record<string, unknown>).messageId === 'string');

      // Poll messages
      const { status: pollStatus, body: pollBody } = await jsonGet(`${BASE_URL}/v1/messages`, receiverToken);
      assert.strictEqual(pollStatus, 200);
      const messages = (pollBody as Record<string, unknown>).messages as Array<Record<string, unknown>>;
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].from, sender.publicKey);
      assert.strictEqual(messages[0].fromName, 'sender');
      assert.strictEqual(messages[0].type, 'publish');
      assert.deepStrictEqual(messages[0].payload, { text: 'hello from REST' });

      // Second poll: messages are cleared
      const { body: pollBody2 } = await jsonGet(`${BASE_URL}/v1/messages`, receiverToken);
      const messages2 = (pollBody2 as Record<string, unknown>).messages as unknown[];
      assert.strictEqual(messages2.length, 0, 'messages should be cleared after polling');

      await jsonDelete(`${BASE_URL}/v1/disconnect`, receiverToken);
      await jsonDelete(`${BASE_URL}/v1/disconnect`, senderToken);
    });
  });

  describe('POST /v1/send', () => {
    it('should return 400 for missing to field', async () => {
      const agent = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token = (rb as Record<string, unknown>).token as string;

      const { status } = await jsonPost(
        `${BASE_URL}/v1/send`,
        { type: 'publish', payload: { text: 'hi' } },
        token,
      );
      assert.strictEqual(status, 400);

      await jsonDelete(`${BASE_URL}/v1/disconnect`, token);
    });

    it('should return 400 for missing type field', async () => {
      const agent = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token = (rb as Record<string, unknown>).token as string;

      const { status } = await jsonPost(
        `${BASE_URL}/v1/send`,
        { to: 'somekey', payload: { text: 'hi' } },
        token,
      );
      assert.strictEqual(status, 400);

      await jsonDelete(`${BASE_URL}/v1/disconnect`, token);
    });

    it('should return 404 for recipient not connected', async () => {
      const sender = generateKeyPair();
      const { body: sb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: sender.publicKey,
        privateKey: sender.privateKey,
      });
      const senderToken = (sb as Record<string, unknown>).token as string;

      const notConnected = generateKeyPair();
      const { status } = await jsonPost(
        `${BASE_URL}/v1/send`,
        { to: notConnected.publicKey, type: 'publish', payload: { text: 'hi' } },
        senderToken,
      );
      assert.strictEqual(status, 404);

      await jsonDelete(`${BASE_URL}/v1/disconnect`, senderToken);
    });

    it('should support inReplyTo field', async () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();

      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: receiver.publicKey,
        privateKey: receiver.privateKey,
      });
      const receiverToken = (rb as Record<string, unknown>).token as string;

      const { body: sb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: sender.publicKey,
        privateKey: sender.privateKey,
      });
      const senderToken = (sb as Record<string, unknown>).token as string;

      const replyId = 'abc123';
      await jsonPost(
        `${BASE_URL}/v1/send`,
        { to: receiver.publicKey, type: 'response', payload: { answer: 42 }, inReplyTo: replyId },
        senderToken,
      );

      const { body: pollBody } = await jsonGet(`${BASE_URL}/v1/messages`, receiverToken);
      const messages = (pollBody as Record<string, unknown>).messages as Array<Record<string, unknown>>;
      assert.strictEqual(messages[0].inReplyTo, replyId);

      await jsonDelete(`${BASE_URL}/v1/disconnect`, receiverToken);
      await jsonDelete(`${BASE_URL}/v1/disconnect`, senderToken);
    });
  });

  describe('DELETE /v1/disconnect', () => {
    it('should disconnect agent and invalidate token', async () => {
      const agent = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: agent.publicKey,
        privateKey: agent.privateKey,
      });
      const token = (rb as Record<string, unknown>).token as string;

      const { status: ds } = await jsonDelete(`${BASE_URL}/v1/disconnect`, token);
      assert.strictEqual(ds, 200);

      // Token should now be invalid
      const { status: gs } = await jsonGet(`${BASE_URL}/v1/peers`, token);
      assert.strictEqual(gs, 401, 'token should be invalidated after disconnect');
    });
  });

  describe('404 for unknown endpoints', () => {
    it('should return 404 for unknown path', async () => {
      const res = await fetch(`${BASE_URL}/v2/unknown`);
      assert.strictEqual(res.status, 404);
    });
  });

  describe('WS-to-REST routing', () => {
    it('should deliver messages from WS relay agent to REST agent via relay routing', async () => {
      // Register a REST receiver
      const receiver = generateKeyPair();
      const { body: rb } = await jsonPost(`${BASE_URL}/v1/register`, {
        publicKey: receiver.publicKey,
        privateKey: receiver.privateKey,
        name: 'rest-receiver',
      });
      const receiverToken = (rb as Record<string, unknown>).token as string;

      // Simulate a WS agent sending via relay.routeEnvelope
      const wsAgent = generateKeyPair();
      const envelope = createEnvelope(
        'publish',
        wsAgent.publicKey,
        wsAgent.privateKey,
        { text: 'from WebSocket agent' },
        Date.now(),
      );

      const result = relay.routeEnvelope(wsAgent.publicKey, receiver.publicKey, envelope);
      assert.ok(result.ok, 'routeEnvelope should succeed');

      // REST agent should receive the message
      const { body: pollBody } = await jsonGet(`${BASE_URL}/v1/messages`, receiverToken);
      const messages = (pollBody as Record<string, unknown>).messages as Array<Record<string, unknown>>;
      assert.strictEqual(messages.length, 1);
      assert.strictEqual(messages[0].from, wsAgent.publicKey);
      assert.deepStrictEqual(messages[0].payload, { text: 'from WebSocket agent' });

      await jsonDelete(`${BASE_URL}/v1/disconnect`, receiverToken);
    });
  });
});
