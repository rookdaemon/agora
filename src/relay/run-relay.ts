/**
 * run-relay.ts — Start Agora relay: WebSocket server and optional REST API.
 *
 * When REST is enabled, starts:
 *   1. WebSocket relay (RelayServer) on wsPort
 *   2. REST API server (Express) on restPort
 *
 * Environment variables:
 *   RELAY_PORT               — WebSocket relay port (default: 3002); alias: PORT
 *   REST_PORT                — REST API port (default: 3001)
 *   JWT_SECRET               — Secret for JWT session tokens (alias: AGORA_RELAY_JWT_SECRET)
 *   AGORA_JWT_EXPIRY_SECONDS — JWT expiry in seconds (default: 3600)
 *   MAX_PEERS                — Maximum concurrent registered peers (default: 100)
 *   MESSAGE_TTL_MS           — Message buffer TTL in ms (default: 86400000 = 24h)
 *   RATE_LIMIT_RPM           — REST API requests per minute per IP (default: 60)
 *   ALLOWED_ORIGINS          — CORS origins, comma-separated or * (default: *)
 */

import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { RelayServer, type RelayServerOptions } from './server';
import {
  createEnvelope,
  verifyEnvelope,
  type Envelope,
  type MessageType,
} from '../message/envelope';
import { createRestRouter, type CreateEnvelopeFn } from './rest-api';
import { MessageBuffer } from './message-buffer';
import type { RestSession } from './rest-api';

/** Wrapper so REST API can pass string type; createEnvelope expects MessageType */
const createEnvelopeForRest: CreateEnvelopeFn = (
  type,
  sender,
  privateKey,
  payload,
  timestamp,
  inReplyTo
) =>
  createEnvelope(
    type as MessageType,
    sender,
    privateKey,
    payload,
    timestamp ?? Date.now(),
    inReplyTo
  );

export interface RunRelayOptions {
  /** WebSocket port (default from RELAY_PORT or PORT env, or 3002) */
  wsPort?: number;
  /** REST API port (default from REST_PORT env, or 3001). Ignored if enableRest is false. */
  restPort?: number;
  /** Enable REST API (requires JWT_SECRET or AGORA_RELAY_JWT_SECRET). Default: true if secret is set. */
  enableRest?: boolean;
  /** Relay server options (identity, storagePeers, storageDir) */
  relayOptions?: RelayServerOptions;
}

/**
 * Start WebSocket relay and optionally REST API.
 * Returns { relay, httpServer } where httpServer is set only when REST is enabled.
 */
export async function runRelay(options: RunRelayOptions = {}): Promise<{
  relay: RelayServer;
  httpServer?: http.Server;
}> {
  const wsPort = options.wsPort ?? parseInt(
    process.env.RELAY_PORT ?? process.env.PORT ?? '3002', 10
  );
  const jwtSecret = process.env.JWT_SECRET ?? process.env.AGORA_RELAY_JWT_SECRET;
  const enableRest =
    options.enableRest ??
    (typeof jwtSecret === 'string' && jwtSecret.length > 0);

  const maxPeers = parseInt(process.env.MAX_PEERS ?? '100', 10);
  const relayOptions: RelayServerOptions = { ...options.relayOptions, maxPeers };

  const relay = new RelayServer(relayOptions);
  await relay.start(wsPort);

  if (!enableRest) {
    return { relay };
  }

  if (!jwtSecret) {
    await relay.stop();
    throw new Error(
      'JWT_SECRET (or AGORA_RELAY_JWT_SECRET) environment variable is required when REST API is enabled'
    );
  }

  // Expose jwtSecret via env so jwt-auth.ts can read it (it reads AGORA_RELAY_JWT_SECRET)
  if (!process.env.AGORA_RELAY_JWT_SECRET) {
    process.env.AGORA_RELAY_JWT_SECRET = jwtSecret;
  }

  const restPort = options.restPort ?? parseInt(process.env.REST_PORT ?? '3001', 10);
  const messageTtlMs = parseInt(process.env.MESSAGE_TTL_MS ?? '86400000', 10);
  const messageBuffer = new MessageBuffer({ ttlMs: messageTtlMs });
  const restSessions = new Map<string, RestSession>();

  const allowedOrigins = process.env.ALLOWED_ORIGINS ?? '*';
  const corsOrigins = allowedOrigins === '*'
    ? '*'
    : allowedOrigins.split(',').map((o) => o.trim()).filter((o) => o.length > 0);

  const app = express();
  app.use(cors({
    origin: corsOrigins,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }));
  app.use(express.json());

  const verifyForRest = (envelope: unknown): { valid: boolean; reason?: string } =>
    verifyEnvelope(envelope as Envelope);

  const rateLimitRpm = parseInt(process.env.RATE_LIMIT_RPM ?? '60', 10);
  const router = createRestRouter(
    relay as Parameters<typeof createRestRouter>[0],
    messageBuffer,
    restSessions,
    createEnvelopeForRest,
    verifyForRest,
    rateLimitRpm
  );
  app.use(router);

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  const httpServer = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    httpServer.listen(restPort, () => resolve());
    httpServer.on('error', reject);
  });

  return { relay, httpServer };
}
