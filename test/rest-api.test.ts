/**
 * Integration tests for the REST API server.
 *
 * These tests exercise all five endpoints:
 *   POST   /v1/register
 *   POST   /v1/send
 *   GET    /v1/peers
 *   GET    /v1/messages
 *   DELETE /v1/disconnect
 *
 * The tests do NOT require a running WebSocket relay — they use the
 * RestApiServer directly, exercising the Express app via node:http.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { generateKeyPair } from '../src/identity/keypair.js';
import { RelayServer } from '../src/relay/server.js';

// --------------------------------------------------------------------------
// Tiny HTTP helper — avoids pulling in a test HTTP client dependency
// --------------------------------------------------------------------------

interface HttpResponse {
  status: number;
  body: unknown;
}

function request(
  base: string,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string } = {},
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, base);
    const bodyStr = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    if (bodyStr) headers['Content-Length'] = String(Buffer.byteLength(bodyStr));

    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path: url.pathname, method, headers },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: data });
          }
        });
      },
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// --------------------------------------------------------------------------
// Tests
// --------------------------------------------------------------------------

const TEST_PORT = 19871;
const BASE = `http://127.0.0.1:${TEST_PORT}`;

describe('REST API', () => {
  let relay: RelayServer;

  before(async () => {
    relay = new RelayServer();
    // Start WebSocket relay
    await relay.start(19872);
    // Start REST API alongside
    await relay.startRestApi(TEST_PORT);
  });

  after(async () => {
    await relay.stop();
  });

  // -------------------------------------------------------------------------
  // POST /v1/register
  // -------------------------------------------------------------------------

  describe('POST /v1/register', () => {
    it('registers a valid agent and returns a token', async () => {
      const kp = generateKeyPair();
      const res = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp.publicKey, privateKey: kp.privateKey, name: 'test-agent' },
      });

      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(typeof body.token === 'string', 'should return a token string');
      assert.ok(typeof body.expiresAt === 'number', 'should return expiresAt number');
    });

    it('rejects registration with missing publicKey', async () => {
      const res = await request(BASE, 'POST', '/v1/register', {
        body: { privateKey: 'abc123' },
      });
      assert.equal(res.status, 400);
    });

    it('rejects registration with missing privateKey', async () => {
      const kp = generateKeyPair();
      const res = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp.publicKey },
      });
      assert.equal(res.status, 400);
    });

    it('rejects registration with mismatched key pair', async () => {
      const kp1 = generateKeyPair();
      const kp2 = generateKeyPair();
      const res = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp1.publicKey, privateKey: kp2.privateKey },
      });
      assert.equal(res.status, 400);
      const body = res.body as Record<string, unknown>;
      assert.ok(typeof body.error === 'string');
    });
  });

  // -------------------------------------------------------------------------
  // Auth middleware
  // -------------------------------------------------------------------------

  describe('auth middleware', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await request(BASE, 'GET', '/v1/peers');
      assert.equal(res.status, 401);
    });

    it('rejects requests with invalid token', async () => {
      const res = await request(BASE, 'GET', '/v1/peers', { token: 'not-a-valid-token' });
      assert.equal(res.status, 401);
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/peers
  // -------------------------------------------------------------------------

  describe('GET /v1/peers', () => {
    it('returns a list of peers for an authenticated agent', async () => {
      const kp = generateKeyPair();
      const reg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      });
      const token = (reg.body as Record<string, unknown>).token as string;

      const res = await request(BASE, 'GET', '/v1/peers', { token });
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(Array.isArray(body.peers), 'should return a peers array');
    });
  });

  // -------------------------------------------------------------------------
  // GET /v1/messages
  // -------------------------------------------------------------------------

  describe('GET /v1/messages', () => {
    it('returns an empty message list initially', async () => {
      const kp = generateKeyPair();
      const reg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      });
      const token = (reg.body as Record<string, unknown>).token as string;

      const res = await request(BASE, 'GET', '/v1/messages', { token });
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(Array.isArray(body.messages), 'messages should be an array');
      assert.equal((body.messages as unknown[]).length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // POST /v1/send
  // -------------------------------------------------------------------------

  describe('POST /v1/send', () => {
    it('delivers a message from one REST client to another REST client', async () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();

      // Register both agents
      const senderReg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: sender.publicKey, privateKey: sender.privateKey, name: 'sender' },
      });
      const senderToken = (senderReg.body as Record<string, unknown>).token as string;

      await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: receiver.publicKey, privateKey: receiver.privateKey, name: 'receiver' },
      });

      // Send message
      const sendRes = await request(BASE, 'POST', '/v1/send', {
        token: senderToken,
        body: {
          to: receiver.publicKey,
          type: 'publish',
          payload: { text: 'Hello from REST' },
        },
      });
      assert.equal(sendRes.status, 200);
      const sendBody = sendRes.body as Record<string, unknown>;
      assert.equal(sendBody.ok, true);
      assert.ok(typeof sendBody.messageId === 'string', 'should return a messageId');
    });

    it('returns 404 when peer is not found', async () => {
      const sender = generateKeyPair();
      const reg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: sender.publicKey, privateKey: sender.privateKey },
      });
      const token = (reg.body as Record<string, unknown>).token as string;

      const res = await request(BASE, 'POST', '/v1/send', {
        token,
        body: {
          to: 'nonexistent-public-key',
          type: 'publish',
          payload: { text: 'Hello?' },
        },
      });
      assert.equal(res.status, 404);
    });

    it('returns 400 when required fields are missing', async () => {
      const sender = generateKeyPair();
      const reg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: sender.publicKey, privateKey: sender.privateKey },
      });
      const token = (reg.body as Record<string, unknown>).token as string;

      const res = await request(BASE, 'POST', '/v1/send', {
        token,
        body: { type: 'publish', payload: {} }, // missing 'to'
      });
      assert.equal(res.status, 400);
    });

    it('allows inReplyTo field', async () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();

      const senderReg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: sender.publicKey, privateKey: sender.privateKey },
      });
      const senderToken = (senderReg.body as Record<string, unknown>).token as string;

      await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: receiver.publicKey, privateKey: receiver.privateKey },
      });

      const res = await request(BASE, 'POST', '/v1/send', {
        token: senderToken,
        body: {
          to: receiver.publicKey,
          type: 'response',
          payload: { text: 'Reply' },
          inReplyTo: 'some-message-id',
        },
      });
      assert.equal(res.status, 200);
    });
  });

  // -------------------------------------------------------------------------
  // Message polling (REST → REST)
  // -------------------------------------------------------------------------

  describe('message polling (REST → REST)', () => {
    it('receiver can poll and retrieve a message sent by another REST client', async () => {
      const sender = generateKeyPair();
      const receiver = generateKeyPair();

      const senderReg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: sender.publicKey, privateKey: sender.privateKey, name: 'alice' },
      });
      const senderToken = (senderReg.body as Record<string, unknown>).token as string;

      const receiverReg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: receiver.publicKey, privateKey: receiver.privateKey, name: 'bob' },
      });
      const receiverToken = (receiverReg.body as Record<string, unknown>).token as string;

      // Send message
      await request(BASE, 'POST', '/v1/send', {
        token: senderToken,
        body: { to: receiver.publicKey, type: 'publish', payload: { text: 'Hello Bob' } },
      });

      // Poll messages
      const pollRes = await request(BASE, 'GET', '/v1/messages', { token: receiverToken });
      assert.equal(pollRes.status, 200);
      const pollBody = pollRes.body as Record<string, unknown>;
      const messages = pollBody.messages as Array<Record<string, unknown>>;
      assert.equal(messages.length, 1);
      assert.equal(messages[0].from, sender.publicKey);
      assert.equal(messages[0].type, 'publish');
      const payload = messages[0].payload as Record<string, unknown>;
      assert.equal(payload.text, 'Hello Bob');

      // Queue should be cleared after polling
      const pollRes2 = await request(BASE, 'GET', '/v1/messages', { token: receiverToken });
      const pollBody2 = pollRes2.body as Record<string, unknown>;
      assert.equal((pollBody2.messages as unknown[]).length, 0);
    });
  });

  // -------------------------------------------------------------------------
  // DELETE /v1/disconnect
  // -------------------------------------------------------------------------

  describe('DELETE /v1/disconnect', () => {
    it('disconnects the agent and invalidates the token', async () => {
      const kp = generateKeyPair();
      const reg = await request(BASE, 'POST', '/v1/register', {
        body: { publicKey: kp.publicKey, privateKey: kp.privateKey },
      });
      const token = (reg.body as Record<string, unknown>).token as string;

      // Disconnect
      const disconnectRes = await request(BASE, 'DELETE', '/v1/disconnect', { token });
      assert.equal(disconnectRes.status, 200);
      assert.equal((disconnectRes.body as Record<string, unknown>).ok, true);

      // Token should no longer be valid
      const afterRes = await request(BASE, 'GET', '/v1/peers', { token });
      assert.equal(afterRes.status, 401);
    });
  });
});
