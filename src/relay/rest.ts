import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createEnvelope } from '../message/envelope.js';
import type { MessageType, Envelope } from '../message/envelope.js';
import type { RelayServer } from './server.js';

/**
 * A queued message waiting to be polled by a REST agent.
 */
export interface RestMessage {
  id: string;
  from: string;
  fromName?: string;
  type: string;
  payload: unknown;
  timestamp: number;
  inReplyTo?: string;
}

/**
 * An active REST API session.
 */
interface RestSession {
  publicKey: string;
  /** Private key held in memory for this session; used to sign outbound envelopes. */
  privateKey: string;
  name?: string;
  metadata?: { version?: string; capabilities?: string[] };
  token: string;
  expiresAt: number;
  messages: RestMessage[];
}

/**
 * HTTP REST API server that enables non-WebSocket clients (e.g. Python agents)
 * to interact with the Agora relay using standard HTTP.
 *
 * Endpoints:
 *   POST   /v1/register    – Register with public+private key, get session token
 *   POST   /v1/send        – Send a signed message to a peer
 *   GET    /v1/peers       – List online peers (WebSocket + REST)
 *   GET    /v1/messages    – Poll for queued messages
 *   DELETE /v1/disconnect  – End the session
 */
export class RestApiServer {
  private server: ReturnType<typeof createServer> | null = null;
  private sessions = new Map<string, RestSession>();
  private relay: RelayServer;
  private tokenTtlMs: number;

  constructor(relay: RelayServer, tokenTtlMs = 3_600_000) {
    this.relay = relay;
    this.tokenTtlMs = tokenTtlMs;
  }

  /**
   * Start the REST API HTTP server on the given port.
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('error', reject);
      this.server.listen(port, () => resolve());
    });
  }

  /**
   * Stop the HTTP server and clean up all sessions.
   */
  async stop(): Promise<void> {
    for (const session of this.sessions.values()) {
      this.relay.unregisterRestAgent(session.publicKey);
    }
    this.sessions.clear();

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Main HTTP request dispatcher.
   */
  private handleRequest(req: IncomingMessage, res: ServerResponse): void {
    const url = req.url ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'POST' && url === '/v1/register') {
      this.readBody(req, res, (body) => this.handleRegister(body, res));
    } else if (method === 'POST' && url === '/v1/send') {
      const session = this.authenticate(req, res);
      if (!session) return;
      this.readBody(req, res, (body) => this.handleSend(body, session, res));
    } else if (method === 'GET' && url === '/v1/peers') {
      const session = this.authenticate(req, res);
      if (!session) return;
      this.handlePeers(session, res);
    } else if (method === 'GET' && url === '/v1/messages') {
      const session = this.authenticate(req, res);
      if (!session) return;
      this.handleMessages(session, res);
    } else if (method === 'DELETE' && url === '/v1/disconnect') {
      const session = this.authenticate(req, res);
      if (!session) return;
      this.handleDisconnect(session, res);
    } else {
      this.sendJson(res, 404, { error: 'Not found' });
    }
  }

  /**
   * POST /v1/register
   * Body: { publicKey, privateKey, name?, metadata? }
   * Response: { token, expiresAt, peers }
   */
  private handleRegister(body: Record<string, unknown>, res: ServerResponse): void {
    const publicKey = body.publicKey;
    const privateKey = body.privateKey;

    if (typeof publicKey !== 'string' || !publicKey) {
      this.sendJson(res, 400, { error: 'Missing or invalid publicKey' });
      return;
    }
    if (typeof privateKey !== 'string' || !privateKey) {
      this.sendJson(res, 400, { error: 'Missing or invalid privateKey' });
      return;
    }

    // Validate that the private key can actually sign (basic sanity check)
    try {
      createEnvelope('publish', publicKey, privateKey, { _check: true }, Date.now());
    } catch {
      this.sendJson(res, 400, { error: 'Invalid keypair: signing test failed' });
      return;
    }

    const name = typeof body.name === 'string' ? body.name : undefined;
    const metadata = body.metadata && typeof body.metadata === 'object' && !Array.isArray(body.metadata)
      ? body.metadata as { version?: string; capabilities?: string[] }
      : undefined;

    // Re-register: remove old session for this publicKey if any
    for (const [token, s] of this.sessions.entries()) {
      if (s.publicKey === publicKey) {
        this.relay.unregisterRestAgent(publicKey);
        this.sessions.delete(token);
        break;
      }
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = Date.now() + this.tokenTtlMs;

    const session: RestSession = {
      publicKey,
      privateKey,
      name,
      metadata,
      token,
      expiresAt,
      messages: [],
    };
    this.sessions.set(token, session);

    // Register with relay so WS agents can route messages here
    this.relay.registerRestAgent(publicKey, (envelope: Envelope, from: string, fromName?: string) => {
      const msg: RestMessage = {
        id: envelope.id,
        from,
        fromName,
        type: envelope.type,
        payload: envelope.payload,
        timestamp: envelope.timestamp,
        inReplyTo: envelope.inReplyTo,
      };
      session.messages.push(msg);
    });

    // Build peer list for response (WS agents + other REST agents)
    const peers = this.buildPeerList(publicKey);

    this.sendJson(res, 200, { token, expiresAt, peers });
  }

  /**
   * POST /v1/send
   * Body: { to, type, payload, inReplyTo? }
   * Response: { ok, messageId }
   */
  private handleSend(body: Record<string, unknown>, session: RestSession, res: ServerResponse): void {
    const to = body.to;
    const type = body.type;
    const payload = body.payload;

    if (typeof to !== 'string' || !to) {
      this.sendJson(res, 400, { error: 'Missing or invalid to' });
      return;
    }
    if (typeof type !== 'string' || !type) {
      this.sendJson(res, 400, { error: 'Missing or invalid type' });
      return;
    }
    if (payload === undefined || payload === null) {
      this.sendJson(res, 400, { error: 'Missing payload' });
      return;
    }

    const inReplyTo = typeof body.inReplyTo === 'string' ? body.inReplyTo : undefined;

    let envelope: Envelope;
    try {
      envelope = createEnvelope(
        type as MessageType,
        session.publicKey,
        session.privateKey,
        payload,
        Date.now(),
        inReplyTo,
      );
    } catch {
      this.sendJson(res, 500, { error: 'Failed to create envelope' });
      return;
    }

    const result = this.relay.routeEnvelope(session.publicKey, to, envelope, session.name);
    if (!result.ok) {
      this.sendJson(res, 404, { error: result.error ?? 'Recipient not connected' });
      return;
    }

    this.sendJson(res, 200, { ok: true, messageId: envelope.id });
  }

  /**
   * GET /v1/peers
   * Response: { peers }
   */
  private handlePeers(session: RestSession, res: ServerResponse): void {
    const peers = this.buildPeerList(session.publicKey);
    this.sendJson(res, 200, { peers });
  }

  /**
   * GET /v1/messages
   * Returns queued messages and clears the queue.
   * Response: { messages }
   */
  private handleMessages(session: RestSession, res: ServerResponse): void {
    const messages = session.messages.splice(0);
    this.sendJson(res, 200, { messages });
  }

  /**
   * DELETE /v1/disconnect
   * Response: { ok }
   */
  private handleDisconnect(session: RestSession, res: ServerResponse): void {
    this.relay.unregisterRestAgent(session.publicKey);
    this.sessions.delete(session.token);
    this.sendJson(res, 200, { ok: true });
  }

  /**
   * Build the peer list visible to an agent (excludes the agent itself).
   */
  private buildPeerList(excludePublicKey: string): Array<{
    publicKey: string;
    name?: string;
    lastSeen: number;
    metadata?: { version?: string; capabilities?: string[] };
  }> {
    const now = Date.now();
    const peers: Array<{ publicKey: string; name?: string; lastSeen: number; metadata?: { version?: string; capabilities?: string[] } }> = [];

    // WebSocket agents
    for (const agent of this.relay.getAgents().values()) {
      if (agent.publicKey !== excludePublicKey) {
        peers.push({
          publicKey: agent.publicKey,
          name: agent.name,
          lastSeen: agent.lastSeen,
          metadata: agent.metadata,
        });
      }
    }

    // Other REST agents
    for (const s of this.sessions.values()) {
      if (s.publicKey !== excludePublicKey) {
        peers.push({
          publicKey: s.publicKey,
          name: s.name,
          lastSeen: now,
          metadata: s.metadata,
        });
      }
    }

    return peers;
  }

  /**
   * Authenticate a request using "Authorization: Bearer <token>".
   * Returns the session on success, sends a 401 and returns null on failure.
   */
  private authenticate(req: IncomingMessage, res: ServerResponse): RestSession | null {
    const authHeader = req.headers['authorization'] ?? '';
    const match = /^Bearer ([0-9a-f]{64})$/i.exec(authHeader);
    if (!match) {
      this.sendJson(res, 401, { error: 'Missing or invalid Authorization header' });
      return null;
    }

    const token = match[1];
    const session = this.sessions.get(token);
    if (!session) {
      this.sendJson(res, 401, { error: 'Invalid or expired token' });
      return null;
    }

    if (Date.now() > session.expiresAt) {
      this.relay.unregisterRestAgent(session.publicKey);
      this.sessions.delete(token);
      this.sendJson(res, 401, { error: 'Session expired' });
      return null;
    }

    return session;
  }

  /**
   * Read and parse the JSON request body.
   * Calls callback with the parsed object, or sends a 400 on error.
   */
  private readBody(req: IncomingMessage, res: ServerResponse, callback: (body: Record<string, unknown>) => void): void {
    let raw = '';
    let responded = false;

    req.on('data', (chunk: Buffer) => {
      raw += chunk.toString();
    });
    req.on('end', () => {
      if (responded) return;
      responded = true;
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        this.sendJson(res, 400, { error: 'Invalid JSON body' });
        return;
      }
      callback(body);
    });
    req.on('error', () => {
      if (responded) return;
      responded = true;
      this.sendJson(res, 400, { error: 'Failed to read request body' });
    });
  }

  /**
   * Send a JSON response.
   */
  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    const json = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }
}
