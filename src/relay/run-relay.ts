/**
 * run-relay.ts — Start Agora relay: WebSocket server and optional REST API.
 *
 * When REST is enabled, starts:
 *   1. WebSocket relay (RelayServer) on wsPort
 *   2. REST API server (Express) on restPort (default wsPort + 1)
 *
 * Environment variables (when REST enabled):
 *   AGORA_RELAY_JWT_SECRET   — Required for REST (JWT signing)
 *   AGORA_JWT_EXPIRY_SECONDS — JWT expiry in seconds (default: 3600)
 *   PORT                     — WebSocket port (default: 3001); REST uses PORT+1
 */

import http from 'node:http';
import express from 'express';
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
  /** WebSocket port (default from PORT env or 3001) */
  wsPort?: number;
  /** REST API port (default: wsPort + 1). Ignored if enableRest is false. */
  restPort?: number;
  /** Enable REST API (requires AGORA_RELAY_JWT_SECRET). Default: true if AGORA_RELAY_JWT_SECRET is set. */
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
  const wsPort = options.wsPort ?? parseInt(process.env.PORT ?? '3001', 10);
  const enableRest =
    options.enableRest ??
    (typeof process.env.AGORA_RELAY_JWT_SECRET === 'string' &&
      process.env.AGORA_RELAY_JWT_SECRET.length > 0);

  const relay = new RelayServer(options.relayOptions);
  await relay.start(wsPort);

  if (!enableRest) {
    return { relay };
  }

  if (!process.env.AGORA_RELAY_JWT_SECRET) {
    await relay.stop();
    throw new Error(
      'AGORA_RELAY_JWT_SECRET environment variable is required when REST API is enabled'
    );
  }

  const restPort = options.restPort ?? wsPort + 1;
  const messageBuffer = new MessageBuffer();
  const restSessions = new Map<string, RestSession>();

  const app = express();
  app.use(express.json());

  const verifyForRest = (envelope: unknown): { valid: boolean; reason?: string } =>
    verifyEnvelope(envelope as Envelope);

  const router = createRestRouter(
    relay as Parameters<typeof createRestRouter>[0],
    messageBuffer,
    restSessions,
    createEnvelopeForRest,
    verifyForRest
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
