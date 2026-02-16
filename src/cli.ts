#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadPeerConfig, savePeerConfig, initPeerConfig } from './transport/peer-config.js';
import { sendToPeer, decodeInboundEnvelope, type PeerConfig } from './transport/http.js';
import { sendViaRelay } from './transport/relay.js';
import type { MessageType } from './message/envelope.js';
import type { AnnouncePayload } from './registry/messages.js';
import { PeerServer } from './peer/server.js';
import { RelayServer } from './relay/server.js';
import { RelayClient } from './relay/client.js';
import { PeerDiscoveryService } from './discovery/peer-discovery.js';
import { getDefaultBootstrapRelay } from './discovery/bootstrap.js';

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
    console.error('Error: Missing peer name. Usage: agora peers add <name> --pubkey <pubkey> [--url <url> --token <token>]');
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

  if (!pubkey) {
    console.error('Error: Missing required --pubkey option.');
    process.exit(1);
  }

  // Validate that if one of url/token is provided, both must be
  if ((url && !token) || (!url && token)) {
    console.error('Error: Both --url and --token must be provided together.');
    process.exit(1);
  }

  // Check if we have HTTP transport or relay
  const config = loadPeerConfig(configPath);
  const hasHttpConfig = url && token;
  const hasRelay = config.relay;

  if (!hasHttpConfig && !hasRelay) {
    console.error('Error: Either (--url and --token) must be provided, or relay must be configured in config file.');
    process.exit(1);
  }

  // Add the peer
  config.peers[name] = {
    publicKey: pubkey,
    name, // Set name to match the key for consistency
  };

  if (url && token) {
    config.peers[name].url = url;
    config.peers[name].token = token;
  }

  savePeerConfig(configPath, config);
  
  const outputData: Record<string, unknown> = { 
    status: 'added',
    name,
    publicKey: pubkey
  };
  
  if (url) {
    outputData.url = url;
  }
  
  output(outputData, options.pretty || false);
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
 * Handle the `agora peers discover` command.
 */
async function handlePeersDiscover(
  options: CliOptions & { 
    relay?: string; 
    'relay-pubkey'?: string;
    limit?: string;
    'active-within'?: string;
    save?: boolean;
  }
): Promise<void> {
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  // Determine relay configuration
  let relayUrl: string;
  let relayPublicKey: string | undefined;

  if (options.relay) {
    // Use custom relay from command line
    relayUrl = options.relay;
    relayPublicKey = options['relay-pubkey'];
  } else if (config.relay) {
    // Use relay from config
    relayUrl = config.relay;
    // TODO: Add relayPublicKey to config schema in future
    relayPublicKey = undefined;
  } else {
    // Use default bootstrap relay
    const bootstrap = getDefaultBootstrapRelay();
    relayUrl = bootstrap.relayUrl;
    relayPublicKey = bootstrap.relayPublicKey;
  }

  // Parse filters
  const filters: { activeWithin?: number; limit?: number } = {};
  if (options['active-within']) {
    const ms = parseInt(options['active-within'], 10);
    if (isNaN(ms) || ms <= 0) {
      console.error('Error: --active-within must be a positive number (milliseconds)');
      process.exit(1);
    }
    filters.activeWithin = ms;
  }
  if (options.limit) {
    const limit = parseInt(options.limit, 10);
    if (isNaN(limit) || limit <= 0) {
      console.error('Error: --limit must be a positive number');
      process.exit(1);
    }
    filters.limit = limit;
  }

  // Connect to relay
  const relayClient = new RelayClient({
    relayUrl,
    publicKey: config.identity.publicKey,
    privateKey: config.identity.privateKey,
  });

  try {
    // Connect
    await relayClient.connect();

    // Create discovery service
    const discoveryService = new PeerDiscoveryService({
      publicKey: config.identity.publicKey,
      privateKey: config.identity.privateKey,
      relayClient,
      relayPublicKey,
    });

    // Discover peers
    const peerList = await discoveryService.discoverViaRelay(Object.keys(filters).length > 0 ? filters : undefined);

    if (!peerList) {
      output({
        status: 'no_response',
        message: 'No response from relay',
      }, options.pretty || false);
      process.exit(1);
    }

    // Save to config if requested
    if (options.save) {
      let savedCount = 0;
      for (const peer of peerList.peers) {
        // Only save if not already in config
        const existing = Object.values(config.peers).find(p => p.publicKey === peer.publicKey);
        if (!existing) {
          const peerName = peer.metadata?.name || `peer-${peer.publicKey.substring(0, 8)}`;
          config.peers[peerName] = {
            publicKey: peer.publicKey,
            name: peerName,
          };
          savedCount++;
        }
      }
      if (savedCount > 0) {
        savePeerConfig(configPath, config);
      }

      output({
        status: 'discovered',
        totalPeers: peerList.totalPeers,
        peersReturned: peerList.peers.length,
        peersSaved: savedCount,
        relayPublicKey: peerList.relayPublicKey,
        peers: peerList.peers.map(p => ({
          publicKey: p.publicKey,
          name: p.metadata?.name,
          version: p.metadata?.version,
          lastSeen: p.lastSeen,
        })),
      }, options.pretty || false);
    } else {
      output({
        status: 'discovered',
        totalPeers: peerList.totalPeers,
        peersReturned: peerList.peers.length,
        relayPublicKey: peerList.relayPublicKey,
        peers: peerList.peers.map(p => ({
          publicKey: p.publicKey,
          name: p.metadata?.name,
          version: p.metadata?.version,
          lastSeen: p.lastSeen,
        })),
      }, options.pretty || false);
    }
  } catch (e) {
    console.error('Error discovering peers:', e instanceof Error ? e.message : String(e));
    process.exit(1);
  } finally {
    relayClient.disconnect();
  }
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

  // Determine transport method: HTTP or relay
  const hasHttpTransport = peer.url && peer.token;
  const hasRelay = config.relay;

  // Send the message
  try {
    if (hasHttpTransport) {
      // Use HTTP transport (existing behavior)
      // Non-null assertion: we know url and token are strings here
      const transportConfig = {
        identity: config.identity,
        peers: new Map<string, PeerConfig>([[peer.publicKey, {
          url: peer.url!,
          token: peer.token!,
          publicKey: peer.publicKey,
        }]]),
      };

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
          transport: 'http',
          httpStatus: result.status
        }, options.pretty || false);
      } else {
        output({ 
          status: 'failed',
          peer: name,
          type: messageType,
          transport: 'http',
          httpStatus: result.status,
          error: result.error
        }, options.pretty || false);
        process.exit(1);
      }
    } else if (hasRelay) {
      // Use relay transport
      // Non-null assertion: we know relay is a string here
      const relayConfig = {
        identity: config.identity,
        relayUrl: config.relay!,
      };

      const result = await sendViaRelay(
        relayConfig,
        peer.publicKey,
        messageType,
        messagePayload
      );

      if (result.ok) {
        output({ 
          status: 'sent',
          peer: name,
          type: messageType,
          transport: 'relay'
        }, options.pretty || false);
      } else {
        output({ 
          status: 'failed',
          peer: name,
          type: messageType,
          transport: 'relay',
          error: result.error
        }, options.pretty || false);
        process.exit(1);
      }
    } else {
      // Neither HTTP nor relay available
      console.error(`Error: Peer '${name}' unreachable. No HTTP endpoint and no relay configured.`);
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
    // Only add peers with HTTP config to the map for decoding
    if (val.url && val.token) {
      peers.set(val.publicKey, {
        url: val.url,
        token: val.token,
        publicKey: val.publicKey,
      });
    }
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
    relay: config.relay || 'not configured',
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

  // Send announce to all peers
  const results: Array<{ peer: string; status: string; transport?: string; httpStatus?: number; error?: string }> = [];

  for (const [name, peer] of Object.entries(config.peers)) {
    const hasHttpTransport = peer.url && peer.token;
    const hasRelay = config.relay;

    try {
      if (hasHttpTransport) {
        // Use HTTP transport
        const peers = new Map<string, PeerConfig>();
        peers.set(peer.publicKey, {
          url: peer.url!,
          token: peer.token!,
          publicKey: peer.publicKey,
        });

        const transportConfig = {
          identity: config.identity,
          peers,
        };

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
            transport: 'http',
            httpStatus: result.status,
          });
        } else {
          results.push({
            peer: name,
            status: 'failed',
            transport: 'http',
            httpStatus: result.status,
            error: result.error,
          });
        }
      } else if (hasRelay) {
        // Use relay transport
        const relayConfig = {
          identity: config.identity,
          relayUrl: config.relay!,
        };

        const result = await sendViaRelay(
          relayConfig,
          peer.publicKey,
          'announce',
          announcePayload
        );

        if (result.ok) {
          results.push({
            peer: name,
            status: 'sent',
            transport: 'relay',
          });
        } else {
          results.push({
            peer: name,
            status: 'failed',
            transport: 'relay',
            error: result.error,
          });
        }
      } else {
        results.push({
          peer: name,
          status: 'unreachable',
          error: 'No HTTP endpoint and no relay configured',
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
 * Handle the `agora diagnose` command.
 * Run diagnostic checks on a peer (ping, workspace, tools).
 */
async function handleDiagnose(args: string[], options: CliOptions & { checks?: string }): Promise<void> {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora diagnose <name> [--checks <comma-separated-list>]');
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

  if (!peer.url) {
    console.error(`Error: Peer '${name}' has no URL configured. Cannot diagnose.`);
    process.exit(1);
  }

  // Parse checks parameter
  const checksParam = options.checks || 'ping';
  const requestedChecks = checksParam.split(',').map(c => c.trim());
  
  // Validate check types
  const validChecks = ['ping', 'workspace', 'tools'];
  for (const check of requestedChecks) {
    if (!validChecks.includes(check)) {
      console.error(`Error: Invalid check type '${check}'. Valid checks: ${validChecks.join(', ')}`);
      process.exit(1);
    }
  }

  // Result structure
  interface CheckResult {
    ok: boolean;
    latency_ms?: number;
    error?: string;
    implemented?: boolean;
    [key: string]: unknown;
  }
  
  const result: {
    peer: string;
    status: string;
    checks: Record<string, CheckResult>;
    timestamp: string;
  } = {
    peer: name,
    status: 'unknown',
    checks: {},
    timestamp: new Date().toISOString(),
  };

  // Run ping check
  if (requestedChecks.includes('ping')) {
    const startTime = Date.now();
    try {
      // Add timeout to prevent hanging on unreachable peers
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      
      const response = await fetch(peer.url, {
        method: 'GET',
        headers: peer.token ? { 'Authorization': `Bearer ${peer.token}` } : {},
        signal: controller.signal,
      });
      
      clearTimeout(timeout);
      const latency = Date.now() - startTime;
      
      if (response.ok || response.status === 404 || response.status === 405) {
        // 404 or 405 means the endpoint exists but GET isn't supported - that's OK for a ping
        result.checks.ping = { ok: true, latency_ms: latency };
      } else {
        result.checks.ping = { ok: false, latency_ms: latency, error: `HTTP ${response.status}` };
      }
    } catch (err) {
      const latency = Date.now() - startTime;
      result.checks.ping = { 
        ok: false, 
        latency_ms: latency,
        error: err instanceof Error ? err.message : String(err) 
      };
    }
  }

  // Run workspace check
  if (requestedChecks.includes('workspace')) {
    // This is a placeholder - actual implementation would depend on peer's diagnostic protocol
    result.checks.workspace = { 
      ok: false,
      implemented: false,
      error: 'Workspace check requires peer diagnostic protocol support' 
    };
  }

  // Run tools check
  if (requestedChecks.includes('tools')) {
    // This is a placeholder - actual implementation would depend on peer's diagnostic protocol
    result.checks.tools = { 
      ok: false,
      implemented: false,
      error: 'Tools check requires peer diagnostic protocol support' 
    };
  }

  // Determine overall status - only consider implemented checks
  const implementedChecks = Object.values(result.checks).filter(
    check => check.implemented !== false
  );
  
  if (implementedChecks.length === 0) {
    result.status = 'unknown';
  } else {
    const allOk = implementedChecks.every(check => check.ok);
    const anyOk = implementedChecks.some(check => check.ok);
    result.status = allOk ? 'healthy' : anyOk ? 'degraded' : 'unhealthy';
  }

  output(result, options.pretty || false);
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
  
  // Validate port
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port number '${options.port}'. Port must be between 1 and 65535.`);
    process.exit(1);
  }
  
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
 * Handle the `agora relay` command.
 * Starts a WebSocket relay server for routing messages between agents.
 */
async function handleRelay(options: CliOptions & { port?: string }): Promise<void> {
  const port = parseInt(options.port || '9474', 10);
  
  // Validate port
  if (isNaN(port) || port < 1 || port > 65535) {
    console.error(`Error: Invalid port number '${options.port}'. Port must be between 1 and 65535.`);
    process.exit(1);
  }

  // Create and configure RelayServer
  const server = new RelayServer();

  // Setup event listeners
  server.on('agent-registered', (publicKey) => {
    console.log(`[${new Date().toISOString()}] Agent registered: ${publicKey}`);
  });

  server.on('agent-disconnected', (publicKey) => {
    console.log(`[${new Date().toISOString()}] Agent disconnected: ${publicKey}`);
  });

  server.on('message-relayed', (from, to, envelope) => {
    console.log(`[${new Date().toISOString()}] Message relayed: ${from.substring(0, 16)}... → ${to.substring(0, 16)}... (type: ${envelope.type})`);
  });

  server.on('error', (error) => {
    console.error(`[${new Date().toISOString()}] Error:`, error.message);
  });

  // Start the server
  try {
    await server.start(port);
    console.log(`[${new Date().toISOString()}] Agora relay server started`);
    console.log(`  WebSocket Port: ${port}`);
    console.log(`  Connected agents: 0`);
    console.log(`  Listening for agent connections...`);
    console.log('');
    console.log('Press Ctrl+C to stop the relay');

    // Shared shutdown handler
    const shutdown = async (): Promise<void> => {
      console.log(`\n[${new Date().toISOString()}] Shutting down relay...`);
      await server.stop();
      console.log('Relay stopped');
      process.exit(0);
    };

    // Keep the process alive
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (error) {
    console.error('Failed to start relay:', error instanceof Error ? error.message : String(error));
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
    console.error('Commands: init, whoami, status, peers, announce, send, decode, serve, diagnose, relay');
    console.error('  peers subcommands: add, list, remove, discover');
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
      checks: { type: 'string' },
      relay: { type: 'string' },
      'relay-pubkey': { type: 'string' },
      limit: { type: 'string' },
      'active-within': { type: 'string' },
      save: { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });

  const command = parsed.positionals[0];
  const subcommand = parsed.positionals[1];
  const remainingArgs = parsed.positionals.slice(2);

  const options: CliOptions & { 
    type?: string; 
    payload?: string; 
    url?: string; 
    token?: string; 
    pubkey?: string; 
    name?: string; 
    version?: string; 
    port?: string; 
    checks?: string;
    relay?: string;
    'relay-pubkey'?: string;
    limit?: string;
    'active-within'?: string;
    save?: boolean;
  } = {
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
    checks: typeof parsed.values.checks === 'string' ? parsed.values.checks : undefined,
    relay: typeof parsed.values.relay === 'string' ? parsed.values.relay : undefined,
    'relay-pubkey': typeof parsed.values['relay-pubkey'] === 'string' ? parsed.values['relay-pubkey'] : undefined,
    limit: typeof parsed.values.limit === 'string' ? parsed.values.limit : undefined,
    'active-within': typeof parsed.values['active-within'] === 'string' ? parsed.values['active-within'] : undefined,
    save: typeof parsed.values.save === 'boolean' ? parsed.values.save : undefined,
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
      case 'diagnose':
        await handleDiagnose([subcommand, ...remainingArgs].filter(Boolean), options);
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
          case 'discover':
            await handlePeersDiscover(options);
            break;
          default:
            console.error('Error: Unknown peers subcommand. Use: add, list, remove, discover');
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
      case 'relay':
        await handleRelay(options);
        break;
      default:
        console.error(`Error: Unknown command '${command}'. Use: init, whoami, status, peers, announce, send, decode, serve, diagnose, relay`);
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
