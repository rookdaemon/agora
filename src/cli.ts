#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadPeerConfig, savePeerConfig, initPeerConfig } from './transport/peer-config.js';
import { sendToPeer, decodeInboundEnvelope, type PeerConfig } from './transport/http.js';
import type { MessageType } from './message/envelope.js';
import type { AnnouncePayload } from './registry/messages.js';
import { PeerServer } from './peer/server.js';

interface CliOptions {
  config?: string;
  pretty?: boolean;
}

/**
 * Get the config file path from CLI options, environment, or default.
 */
function getConfigPath(options: CliOptions): string {
  if (options.config) {
    return resolve(options.config);
  }
  if (process.env.AGORA_CONFIG) {
    return resolve(process.env.AGORA_CONFIG);
  }
  return resolve(homedir(), '.config', 'agora', 'config.json');
}

/**
 * Ensure the config directory exists.
 */
function ensureConfigDir(configPath: string): void {
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Output data as JSON or pretty format.
 */
function output(data: unknown, pretty: boolean): void {
  if (pretty) {
    // Pretty output for humans
    if (typeof data === 'object' && data !== null) {
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          console.log(`${key}:`);
          for (const item of value) {
            if (typeof item === 'object' && item !== null) {
              const entries = Object.entries(item);
              console.log(`  - ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')}`);
            } else {
              console.log(`  - ${item}`);
            }
          }
        } else if (typeof value === 'object' && value !== null) {
          console.log(`${key}:`);
          for (const [k, v] of Object.entries(value)) {
            console.log(`  ${k}: ${v}`);
          }
        } else {
          console.log(`${key}: ${value}`);
        }
      }
    } else {
      console.log(data);
    }
  } else {
    // JSON output for programmatic use
    console.log(JSON.stringify(data, null, 2));
  }
}

/**
 * Handle the `agora init` command.
 */
function handleInit(options: CliOptions): void {
  const configPath = getConfigPath(options);
  ensureConfigDir(configPath);

  if (existsSync(configPath)) {
    const config = loadPeerConfig(configPath);
    output({ 
      status: 'already_initialized',
      publicKey: config.identity.publicKey,
      configPath 
    }, options.pretty || false);
    process.exit(0);
  }

  const config = initPeerConfig(configPath);
  output({ 
    status: 'initialized',
    publicKey: config.identity.publicKey,
    configPath 
  }, options.pretty || false);
}

/**
 * Handle the `agora whoami` command.
 */
function handleWhoami(options: CliOptions): void {
  const configPath = getConfigPath(options);
  
  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  output({ 
    publicKey: config.identity.publicKey,
    configPath 
  }, options.pretty || false);
}

/**
 * Handle the `agora peers add` command.
 */
function handlePeersAdd(args: string[], options: CliOptions & { url?: string; token?: string; pubkey?: string }): void {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora peers add <name> --url <url> --token <token> --pubkey <pubkey>');
    process.exit(1);
  }

  const name = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const url = options.url;
  const token = options.token;
  const pubkey = options.pubkey;

  if (!url || !token || !pubkey) {
    console.error('Error: Missing required options. Usage: agora peers add <name> --url <url> --token <token> --pubkey <pubkey>');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  // Add the peer (name is optional but set for clarity)
  config.peers[name] = {
    url,
    token,
    publicKey: pubkey,
    name, // Set name to match the key for consistency
  };

  savePeerConfig(configPath, config);
  output({ 
    status: 'added',
    name,
    url,
    publicKey: pubkey
  }, options.pretty || false);
}

/**
 * Handle the `agora peers list` command.
 */
function handlePeersList(options: CliOptions): void {
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const peers = Object.entries(config.peers).map(([key, peer]) => ({
    name: peer.name || key,
    url: peer.url,
    publicKey: peer.publicKey,
  }));

  output({ peers }, options.pretty || false);
}

/**
 * Handle the `agora peers remove` command.
 */
function handlePeersRemove(args: string[], options: CliOptions): void {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora peers remove <name>');
    process.exit(1);
  }

  const name = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  if (!config.peers[name]) {
    console.error(`Error: Peer '${name}' not found.`);
    process.exit(1);
  }

  delete config.peers[name];
  savePeerConfig(configPath, config);
  output({ 
    status: 'removed',
    name 
  }, options.pretty || false);
}

/**
 * Handle the `agora send` command.
 */
async function handleSend(args: string[], options: CliOptions & { type?: string; payload?: string }): Promise<void> {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora send <name> <message> OR agora send <name> --type <type> --payload <json>');
    process.exit(1);
  }

  const name = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  if (!config.peers[name]) {
    console.error(`Error: Peer '${name}' not found.`);
    process.exit(1);
  }

  const peer = config.peers[name];

  let messageType: MessageType;
  let messagePayload: unknown;

  if (options.type && options.payload) {
    // Typed message - validate it's a valid MessageType
    const validTypes: MessageType[] = ['announce', 'discover', 'request', 'response', 'publish', 'subscribe', 'verify', 'ack', 'error'];
    if (!validTypes.includes(options.type as MessageType)) {
      console.error(`Error: Invalid message type '${options.type}'. Valid types: ${validTypes.join(', ')}`);
      process.exit(1);
    }
    messageType = options.type as MessageType;
    try {
      messagePayload = JSON.parse(options.payload);
    } catch {
      console.error('Error: Invalid JSON payload.');
      process.exit(1);
    }
  } else {
    // Text message - use 'publish' type with text payload
    if (args.length < 2) {
      console.error('Error: Missing message text. Usage: agora send <name> <message>');
      process.exit(1);
    }
    messageType = 'publish';
    messagePayload = { text: args.slice(1).join(' ') };
  }

  // Create transport config
  const transportConfig = {
    identity: config.identity,
    peers: new Map<string, PeerConfig>([[peer.publicKey, {
      url: peer.url,
      token: peer.token,
      publicKey: peer.publicKey,
    }]]),
  };

  // Send the message
  try {
    const result = await sendToPeer(
      transportConfig,
      peer.publicKey,
      messageType,
      messagePayload
    );

    if (result.ok) {
      output({ 
        status: 'sent',
        peer: name,
        type: messageType,
        httpStatus: result.status
      }, options.pretty || false);
    } else {
      output({ 
        status: 'failed',
        peer: name,
        type: messageType,
        httpStatus: result.status,
        error: result.error
      }, options.pretty || false);
      process.exit(1);
    }
  } catch (e) {
    console.error('Error sending message:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

/**
 * Handle the `agora decode` command.
 */
function handleDecode(args: string[], options: CliOptions): void {
  if (args.length < 1) {
    console.error('Error: Missing message. Usage: agora decode <message>');
    process.exit(1);
  }

  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const peers = new Map<string, PeerConfig>();
  for (const [, val] of Object.entries(config.peers)) {
    peers.set(val.publicKey, val);
  }

  const message = args.join(' ');
  const result = decodeInboundEnvelope(message, peers);

  if (result.ok) {
    output({
      status: 'verified',
      sender: result.envelope.sender,
      type: result.envelope.type,
      payload: result.envelope.payload,
      id: result.envelope.id,
      timestamp: result.envelope.timestamp,
      inReplyTo: result.envelope.inReplyTo || null,
    }, options.pretty || false);
  } else {
    output({
      status: 'failed',
      reason: result.reason,
    }, options.pretty || false);
    process.exit(1);
  }
}

/**
 * Handle the `agora status` command.
 */
function handleStatus(options: CliOptions): void {
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const peerCount = Object.keys(config.peers).length;

  output({
    identity: config.identity.publicKey,
    configPath,
    peerCount,
    peers: Object.keys(config.peers),
  }, options.pretty || false);
}

/**
 * Handle the `agora announce` command.
 * Broadcasts an announce message to all configured peers.
 */
async function handleAnnounce(options: CliOptions & { name?: string; version?: string }): Promise<void> {
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const peerCount = Object.keys(config.peers).length;

  if (peerCount === 0) {
    console.error('Error: No peers configured. Use `agora peers add` to add peers first.');
    process.exit(1);
  }

  // Create announce payload
  const announcePayload: AnnouncePayload = {
    capabilities: [],
    metadata: {
      name: options.name || 'agora-node',
      version: options.version || '0.1.0',
    },
  };

  // Create transport config
  const peers = new Map<string, PeerConfig>();
  for (const [, peer] of Object.entries(config.peers)) {
    peers.set(peer.publicKey, {
      url: peer.url,
      token: peer.token,
      publicKey: peer.publicKey,
    });
  }

  const transportConfig = {
    identity: config.identity,
    peers,
  };

  // Send announce to all peers
  const results: Array<{ peer: string; status: string; httpStatus?: number; error?: string }> = [];

  for (const [name, peer] of Object.entries(config.peers)) {
    try {
      const result = await sendToPeer(
        transportConfig,
        peer.publicKey,
        'announce',
        announcePayload
      );

      if (result.ok) {
        results.push({
          peer: name,
          status: 'sent',
          httpStatus: result.status,
        });
      } else {
        results.push({
          peer: name,
          status: 'failed',
          httpStatus: result.status,
          error: result.error,
        });
      }
    } catch (e) {
      results.push({
        peer: name,
        status: 'error',
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  output({ results }, options.pretty || false);
}

/**
 * Handle the `agora serve` command.
 * Starts a persistent WebSocket server for incoming peer connections.
 */
async function handleServe(options: CliOptions & { port?: string; name?: string }): Promise<void> {
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const port = parseInt(options.port || '9473', 10);
  const serverName = options.name || 'agora-server';

  // Create announce payload
  const announcePayload: AnnouncePayload = {
    capabilities: [],
    metadata: {
      name: serverName,
      version: '0.1.0',
    },
  };

  // Create and configure PeerServer
  const server = new PeerServer(config.identity, announcePayload);

  // Setup event listeners
  server.on('peer-connected', (publicKey, peer) => {
    const peerName = peer.metadata?.name || publicKey.substring(0, 16);
    console.log(`[${new Date().toISOString()}] Peer connected: ${peerName} (${publicKey})`);
  });

  server.on('peer-disconnected', (publicKey) => {
    console.log(`[${new Date().toISOString()}] Peer disconnected: ${publicKey}`);
  });

  server.on('message-received', (envelope, fromPublicKey) => {
    console.log(`[${new Date().toISOString()}] Message from ${fromPublicKey}:`);
    console.log(JSON.stringify({
      id: envelope.id,
      type: envelope.type,
      sender: envelope.sender,
      timestamp: envelope.timestamp,
      payload: envelope.payload,
    }, null, 2));
  });

  server.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Error:`, error.message);
  });

  // Start the server
  try {
    await server.start(port);
    console.log(`[${new Date().toISOString()}] Agora server started`);
    console.log(`  Name: ${serverName}`);
    console.log(`  Public Key: ${config.identity.publicKey}`);
    console.log(`  WebSocket Port: ${port}`);
    console.log(`  Listening for peer connections...`);
    console.log('');
    console.log('Press Ctrl+C to stop the server');

    // Keep the process alive
    process.on('SIGINT', async () => {
      console.log(`\n[${new Date().toISOString()}] Shutting down server...`);
      await server.stop();
      console.log('Server stopped');
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log(`\n[${new Date().toISOString()}] Shutting down server...`);
      await server.stop();
      console.log('Server stopped');
      process.exit(0);
    });
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

/**
 * Parse CLI arguments and route to appropriate handler.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: agora <command> [options]');
    console.error('Commands: init, whoami, status, peers, announce, send, decode, serve');
    process.exit(1);
  }

  // Parse global options
  const parsed = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      pretty: { type: 'boolean' },
      url: { type: 'string' },
      token: { type: 'string' },
      pubkey: { type: 'string' },
      type: { type: 'string' },
      payload: { type: 'string' },
      name: { type: 'string' },
      version: { type: 'string' },
      port: { type: 'string' },
    },
    strict: false,
    allowPositionals: true,
  });

  const command = parsed.positionals[0];
  const subcommand = parsed.positionals[1];
  const remainingArgs = parsed.positionals.slice(2);

  const options: CliOptions & { type?: string; payload?: string; url?: string; token?: string; pubkey?: string; name?: string; version?: string; port?: string } = {
    config: typeof parsed.values.config === 'string' ? parsed.values.config : undefined,
    pretty: typeof parsed.values.pretty === 'boolean' ? parsed.values.pretty : undefined,
    type: typeof parsed.values.type === 'string' ? parsed.values.type : undefined,
    payload: typeof parsed.values.payload === 'string' ? parsed.values.payload : undefined,
    url: typeof parsed.values.url === 'string' ? parsed.values.url : undefined,
    token: typeof parsed.values.token === 'string' ? parsed.values.token : undefined,
    pubkey: typeof parsed.values.pubkey === 'string' ? parsed.values.pubkey : undefined,
    name: typeof parsed.values.name === 'string' ? parsed.values.name : undefined,
    version: typeof parsed.values.version === 'string' ? parsed.values.version : undefined,
    port: typeof parsed.values.port === 'string' ? parsed.values.port : undefined,
  };

  try {
    switch (command) {
      case 'init':
        handleInit(options);
        break;
      case 'whoami':
        handleWhoami(options);
        break;
      case 'status':
        handleStatus(options);
        break;
      case 'announce':
        await handleAnnounce(options);
        break;
      case 'peers':
        switch (subcommand) {
          case 'add':
            handlePeersAdd(remainingArgs, options);
            break;
          case 'list':
          case undefined:
            // Allow 'agora peers' to work like 'agora peers list'
            handlePeersList(options);
            break;
          case 'remove':
            handlePeersRemove(remainingArgs, options);
            break;
          default:
            console.error('Error: Unknown peers subcommand. Use: add, list, remove');
            process.exit(1);
        }
        break;
      case 'send':
        await handleSend([subcommand, ...remainingArgs], options);
        break;
      case 'decode':
        handleDecode([subcommand, ...remainingArgs].filter(Boolean), options);
        break;
      case 'serve':
        await handleServe(options);
        break;
      default:
        console.error(`Error: Unknown command '${command}'. Use: init, whoami, status, peers, announce, send, decode, serve`);
        process.exit(1);
    }
  } catch (e) {
    console.error('Error:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
