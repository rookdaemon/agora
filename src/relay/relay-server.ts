/**
 * relay-server.ts — Standalone entry point for the Agora relay server.
 *
 * Reads configuration from environment variables and starts:
 *   - WebSocket relay on RELAY_PORT (default: 3002)
 *   - REST API on REST_PORT (default: 3001) when JWT_SECRET is set
 *
 * See README.md for full environment variable documentation.
 */
import { runRelay } from './run-relay.js';

const relay = await runRelay();

const wsPort = parseInt(process.env.RELAY_PORT ?? process.env.PORT ?? '3002', 10);
const jwtSecret = process.env.JWT_SECRET ?? process.env.AGORA_RELAY_JWT_SECRET;
const restPort = parseInt(process.env.REST_PORT ?? '3001', 10);

console.log(`[${new Date().toISOString()}] Agora relay started`);
console.log(`  WebSocket relay: ws://0.0.0.0:${wsPort}`);
if (jwtSecret && relay.httpServer) {
  console.log(`  REST API:        http://0.0.0.0:${restPort}`);
}
console.log('');
console.log('Press Ctrl+C to stop');

const shutdown = async (): Promise<void> => {
  console.log(`\n[${new Date().toISOString()}] Shutting down...`);
  relay.httpServer?.close();
  await relay.relay.stop();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
