/**
 * rest-api.ts — Express router implementing the Agora relay REST API.
 *
 * Endpoints:
 *   POST   /v1/register   — Register agent, obtain JWT session token
 *   POST   /v1/send       — Send message to a peer (requires auth)
 *   GET    /v1/peers      — List online peers (requires auth)
 *   GET    /v1/messages   — Poll for new inbound messages (requires auth)
 *   DELETE /v1/disconnect — Invalidate token and disconnect (requires auth)
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import {
  createToken,
  revokeToken,
  requireAuth,
  type AuthenticatedRequest,
} from './jwt-auth';
import { MessageBuffer, type BufferedMessage } from './message-buffer';

const apiRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — try again later' },
});

/**
 * A session for a REST-connected agent.
 * privateKey is held only in memory and never logged or persisted.
 */
export interface RestSession {
  publicKey: string;
  privateKey: string;
  name?: string;
  metadata?: { version?: string; capabilities?: string[] };
  registeredAt: number;
  expiresAt: number;
  token: string;
}

function pruneExpiredSessions(
  sessions: Map<string, RestSession>,
  buffer: MessageBuffer
): void {
  const now = Date.now();
  for (const [publicKey, session] of sessions) {
    if (session.expiresAt <= now) {
      sessions.delete(publicKey);
      buffer.delete(publicKey);
    }
  }
}

/**
 * Minimal interface for the relay server that the REST API depends on.
 */
export interface RelayInterface {
  getAgents(): Map<
    string,
    {
      publicKey: string;
      name?: string;
      lastSeen: number;
      metadata?: { version?: string; capabilities?: string[] };
      socket: unknown;
    }
  >;
  on(
    event: 'message-relayed',
    handler: (from: string, to: string, envelope: unknown) => void
  ): void;
}

/**
 * Envelope creation function interface (matches createEnvelope from message/envelope).
 */
export type CreateEnvelopeFn = (
  type: string,
  sender: string,
  privateKey: string,
  payload: unknown,
  timestamp?: number,
  inReplyTo?: string
) => {
  id: string;
  type: string;
  sender: string;
  timestamp: number;
  payload: unknown;
  signature: string;
  inReplyTo?: string;
};

/**
 * Envelope verification function interface.
 */
export type VerifyEnvelopeFn = (envelope: unknown) => {
  valid: boolean;
  reason?: string;
};

/**
 * Create the REST API router.
 */
export function createRestRouter(
  relay: RelayInterface,
  buffer: MessageBuffer,
  sessions: Map<string, RestSession>,
  createEnv: CreateEnvelopeFn,
  verifyEnv: VerifyEnvelopeFn
): Router {
  const router = Router();
  router.use(apiRateLimit);

  relay.on('message-relayed', (from, to, envelope) => {
    if (!sessions.has(to)) return;
    const agentMap = relay.getAgents();
    const senderAgent = agentMap.get(from);
    const env = envelope as {
      id: string;
      type: string;
      payload: unknown;
      timestamp: number;
      inReplyTo?: string;
    };
    const msg: BufferedMessage = {
      id: env.id,
      from,
      fromName: senderAgent?.name,
      type: env.type,
      payload: env.payload,
      timestamp: env.timestamp,
      inReplyTo: env.inReplyTo,
    };
    buffer.add(to, msg);
  });

  router.post('/v1/register', async (req: Request, res: Response) => {
    const { publicKey, privateKey, name, metadata } = req.body as {
      publicKey?: string;
      privateKey?: string;
      name?: string;
      metadata?: { version?: string; capabilities?: string[] };
    };

    if (!publicKey || typeof publicKey !== 'string') {
      res.status(400).json({ error: 'publicKey is required' });
      return;
    }
    if (!privateKey || typeof privateKey !== 'string') {
      res.status(400).json({ error: 'privateKey is required' });
      return;
    }

    const testEnvelope = createEnv(
      'announce',
      publicKey,
      privateKey,
      { challenge: 'register' },
      Date.now()
    );
    const verification = verifyEnv(testEnvelope);
    if (!verification.valid) {
      res
        .status(400)
        .json({ error: 'Key pair verification failed: ' + verification.reason });
      return;
    }

    const { token, expiresAt } = createToken({ publicKey, name });
    pruneExpiredSessions(sessions, buffer);

    const session: RestSession = {
      publicKey,
      privateKey,
      name,
      metadata,
      registeredAt: Date.now(),
      expiresAt,
      token,
    };
    sessions.set(publicKey, session);

    const wsAgents = relay.getAgents();
    const peers: Array<{ publicKey: string; name?: string; lastSeen: number }> = [];
    for (const agent of wsAgents.values()) {
      if (agent.publicKey !== publicKey) {
        peers.push({
          publicKey: agent.publicKey,
          name: agent.name,
          lastSeen: agent.lastSeen,
        });
      }
    }
    for (const s of sessions.values()) {
      if (s.publicKey !== publicKey && !wsAgents.has(s.publicKey)) {
        peers.push({
          publicKey: s.publicKey,
          name: s.name,
          lastSeen: s.registeredAt,
        });
      }
    }

    res.json({ token, expiresAt, peers });
  });

  router.post(
    '/v1/send',
    requireAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      const { to, type, payload, inReplyTo } = req.body as {
        to?: string;
        type?: string;
        payload?: unknown;
        inReplyTo?: string;
      };

      if (!to || typeof to !== 'string') {
        res.status(400).json({ error: 'to is required' });
        return;
      }
      if (!type || typeof type !== 'string') {
        res.status(400).json({ error: 'type is required' });
        return;
      }
      if (payload === undefined) {
        res.status(400).json({ error: 'payload is required' });
        return;
      }

      const senderPublicKey = req.agent!.publicKey;
      const session = sessions.get(senderPublicKey);
      if (!session) {
        res.status(401).json({ error: 'Session not found — please re-register' });
        return;
      }

      const envelope = createEnv(
        type,
        senderPublicKey,
        session.privateKey,
        payload,
        Date.now(),
        inReplyTo
      );

      const wsAgents = relay.getAgents();
      const wsRecipient = wsAgents.get(to);
      if (wsRecipient && wsRecipient.socket) {
        const ws = wsRecipient.socket as { readyState: number; send(data: string): void };
        const OPEN = 1;
        if (ws.readyState !== OPEN) {
          res.status(503).json({ error: 'Recipient connection is not open' });
          return;
        }
        try {
          const relayMsg = JSON.stringify({
            type: 'message',
            from: senderPublicKey,
            name: session.name,
            envelope,
          });
          ws.send(relayMsg);
          res.json({ ok: true, envelopeId: envelope.id });
          return;
        } catch (err) {
          res.status(500).json({
            error:
              'Failed to deliver message: ' +
              (err instanceof Error ? err.message : String(err)),
          });
          return;
        }
      }

      const restRecipient = sessions.get(to);
      if (restRecipient) {
        const senderAgent = wsAgents.get(senderPublicKey);
        const msg: BufferedMessage = {
          id: envelope.id,
          from: senderPublicKey,
          fromName: session.name ?? senderAgent?.name,
          type: envelope.type,
          payload: envelope.payload,
          timestamp: envelope.timestamp,
          inReplyTo: envelope.inReplyTo,
        };
        buffer.add(to, msg);
        res.json({ ok: true, envelopeId: envelope.id });
        return;
      }

      res.status(404).json({ error: 'Recipient not connected' });
    }
  );

  router.get(
    '/v1/peers',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const callerPublicKey = req.agent!.publicKey;
      const wsAgents = relay.getAgents();
      const peerList: Array<{
        publicKey: string;
        name?: string;
        lastSeen: number;
        metadata?: { version?: string; capabilities?: string[] };
      }> = [];

      for (const agent of wsAgents.values()) {
        if (agent.publicKey !== callerPublicKey) {
          peerList.push({
            publicKey: agent.publicKey,
            name: agent.name,
            lastSeen: agent.lastSeen,
            metadata: agent.metadata,
          });
        }
      }

      for (const s of sessions.values()) {
        if (s.publicKey !== callerPublicKey && !wsAgents.has(s.publicKey)) {
          peerList.push({
            publicKey: s.publicKey,
            name: s.name,
            lastSeen: s.registeredAt,
            metadata: s.metadata,
          });
        }
      }

      res.json({ peers: peerList });
    }
  );

  router.get(
    '/v1/messages',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const publicKey = req.agent!.publicKey;
      const sinceRaw = req.query.since as string | undefined;
      const limitRaw = req.query.limit as string | undefined;

      const since = sinceRaw ? parseInt(sinceRaw, 10) : undefined;
      const limit = Math.min(limitRaw ? parseInt(limitRaw, 10) : 50, 100);

      let messages = buffer.get(publicKey, since);
      const hasMore = messages.length > limit;
      if (hasMore) {
        messages = messages.slice(0, limit);
      }

      if (since === undefined) {
        buffer.clear(publicKey);
      }

      res.json({ messages, hasMore });
    }
  );

  router.delete(
    '/v1/disconnect',
    requireAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const publicKey = req.agent!.publicKey;
      const authHeader = req.headers.authorization!;
      const token = authHeader.slice(7);

      revokeToken(token);
      sessions.delete(publicKey);
      buffer.delete(publicKey);

      res.json({ ok: true });
    }
  );

  return router;
}
