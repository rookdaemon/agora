#!/usr/bin/env node

import { parseArgs } from 'node:util';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { loadPeerConfig, savePeerConfig, initPeerConfig } from './transport/peer-config';
import { sendToPeer, decodeInboundEnvelope, type PeerConfig } from './transport/http';
import { sendViaRelay } from './transport/relay';
import type { MessageType } from './message/envelope';
import type { AnnouncePayload } from './registry/messages';
import {
  getProfileConfigPath,
  listProfiles,
  loadAgoraConfig,
  exportConfig,
  importConfig,
  saveAgoraConfig,
  type ExportedConfig,
} from './config';
import { PeerServer } from './peer/server';
import { RelayServer } from './relay/server';
import { RelayClient } from './relay/client';
import { PeerDiscoveryService } from './discovery/peer-discovery';
import { getDefaultBootstrapRelay } from './discovery/bootstrap';
import { compactInlineReferences, expand, expandInlineReferences, resolveBroadcastName } from './utils';
import { ReputationStore } from './reputation/store';
import { createVerification } from './reputation/verification';
import { createCommit, createReveal, verifyReveal } from './reputation/commit-reveal';
import { computeTrustScore } from './reputation/scoring';

interface CliOptions {
  config?: string;
  profile?: string;
  pretty?: boolean;
}

type ConfigPeer = ReturnType<typeof loadPeerConfig>['peers'][string];

function resolvePeerEntry(peers: Record<string, ConfigPeer>, identifier: string): { key: string; peer: ConfigPeer } | undefined {
  const expanded = expand(identifier, peers);
  if (expanded && peers[expanded]) {
    return { key: expanded, peer: peers[expanded] };
  }

  const direct = peers[identifier];
  if (direct) {
    return { key: identifier, peer: direct };
  }

  for (const [key, peer] of Object.entries(peers)) {
    if (peer.publicKey === identifier || peer.name === identifier) {
      return { key, peer };
    }
  }

  return undefined;
}

function compactPayloadTextReferences(payload: unknown, peers: Record<string, ConfigPeer>): unknown {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  if ('text' in payload && typeof (payload as Record<string, unknown>).text === 'string') {
    return {
      ...(payload as Record<string, unknown>),
      text: compactInlineReferences((payload as { text: string }).text, peers),
    };
  }
  return payload;
}

/**
 * Get the config file path from CLI options, environment, or default.
 */
function getConfigPath(options: CliOptions): string {
  if (options.config) {
    return resolve(options.config);
  }
  return getProfileConfigPath(options.profile);
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

  // Add/update the peer (canonical key is full public key)
  const existingByPubKey = Object.entries(config.peers).find(([, peer]) => peer.publicKey === pubkey);
  if (existingByPubKey && existingByPubKey[0] !== pubkey) {
    delete config.peers[existingByPubKey[0]];
  }

  config.peers[pubkey] = {
    publicKey: pubkey,
    name,
  };

  if (url && token) {
    config.peers[pubkey].url = url;
    config.peers[pubkey].token = token;
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

  const peerRef = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  const resolved = resolvePeerEntry(config.peers, peerRef);
  if (!resolved) {
    console.error(`Error: Peer '${peerRef}' not found.`);
    process.exit(1);
  }

  delete config.peers[resolved.key];
  savePeerConfig(configPath, config);
  output({ 
    status: 'removed',
    name: peerRef 
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
    relayUrl = typeof config.relay === 'string' ? config.relay : config.relay.url;
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

  // Resolve broadcast name
  const broadcastName = resolveBroadcastName(config, undefined);

  // Connect to relay
  const relayClient = new RelayClient({
    relayUrl,
    publicKey: config.identity.publicKey,
    privateKey: config.identity.privateKey,
    name: broadcastName,
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
          config.peers[peer.publicKey] = {
            publicKey: peer.publicKey,
            name: peer.metadata?.name,
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
async function handleSend(args: string[], options: CliOptions & { type?: string; payload?: string; direct?: boolean; 'relay-only'?: boolean }): Promise<void> {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora send <name> <message> OR agora send <name> --type <type> --payload <json>');
    process.exit(1);
  }

  const peerRef = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  const resolved = resolvePeerEntry(config.peers, peerRef);
  if (!resolved) {
    console.error(`Error: Peer '${peerRef}' not found.`);
    process.exit(1);
  }

  const peer = resolved.peer;

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
    messagePayload = { text: expandInlineReferences(args.slice(1).join(' '), config.peers) };
  }

  const isDirect = options.direct === true;
  const isRelayOnly = options['relay-only'] === true;

  // Validate flag combination
  if (isDirect && isRelayOnly) {
    console.error('Error: --direct and --relay-only are mutually exclusive.');
    process.exit(1);
  }

  // --direct requires the peer to have a URL
  if (isDirect && !peer.url) {
    console.error(`Error: --direct requested but peer '${peerRef}' has no URL configured.`);
    process.exit(1);
  }

  // Whether to attempt HTTP transport for this send
  const shouldTryHttp = peer.url && !isRelayOnly;
  const hasRelay = config.relay;

  // Send the message
  try {
    if (shouldTryHttp) {
      // Use HTTP transport
      const transportConfig = {
        identity: config.identity,
        peers: new Map<string, PeerConfig>([[peer.publicKey, {
          url: peer.url!,
          token: peer.token,
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
          peer: peerRef,
          type: messageType,
          transport: 'http',
          httpStatus: result.status
        }, options.pretty || false);
        return;
      }

      // HTTP failed
      if (isDirect) {
        // --direct: do not fall back to relay
        output({ 
          status: 'failed',
          peer: peerRef,
          type: messageType,
          transport: 'http',
          httpStatus: result.status,
          error: result.error
        }, options.pretty || false);
        process.exit(1);
      }

      // Fall through to relay if available
      if (!hasRelay || !config.relay) {
        output({ 
          status: 'failed',
          peer: peerRef,
          type: messageType,
          transport: 'http',
          httpStatus: result.status,
          error: result.error
        }, options.pretty || false);
        process.exit(1);
      }
    }

    // Use relay transport (relay-only mode, or HTTP failed with relay available, or no URL)
    if (hasRelay && config.relay) {
      // Extract URL from relay (string or object)
      const relayUrl = typeof config.relay === 'string' ? config.relay : config.relay.url;
      const relayConfig = {
        identity: config.identity,
        relayUrl,
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
          peer: peerRef,
          type: messageType,
          transport: 'relay'
        }, options.pretty || false);
      } else {
        output({ 
          status: 'failed',
          peer: peerRef,
          type: messageType,
          transport: 'relay',
          error: result.error
        }, options.pretty || false);
        process.exit(1);
      }
    } else if (!shouldTryHttp) {
      // Neither HTTP nor relay available
      console.error(`Error: Peer '${peerRef}' unreachable. No HTTP endpoint and no relay configured.`);
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
      from: result.envelope.from,
      to: result.envelope.to,
      type: result.envelope.type,
      payload: compactPayloadTextReferences(result.envelope.payload, config.peers),
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

// ---------------------------------------------------------------------------
// Profile & config transfer commands
// ---------------------------------------------------------------------------

/**
 * Handle the `agora config profiles` command.
 */
function handleConfigProfiles(options: CliOptions): void {
  const profiles = listProfiles();
  if (profiles.length === 0) {
    output({ profiles: [], message: 'No profiles found. Run `agora init` first.' }, options.pretty || false);
    return;
  }
  output({ profiles }, options.pretty || false);
}

/**
 * Handle the `agora config export` command.
 */
function handleConfigExport(options: CliOptions & { 'include-identity'?: boolean; output?: string }): void {
  const configPath = getConfigPath(options);
  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadAgoraConfig(configPath);
  const exported = exportConfig(config, { includeIdentity: options['include-identity'] });

  if (options.output) {
    const outPath = resolve(options.output);
    const dir = dirname(outPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(outPath, JSON.stringify(exported, null, 2) + '\n', 'utf-8');
    output({ status: 'exported', path: outPath, peerCount: Object.keys(exported.peers).length, includesIdentity: !!exported.identity }, options.pretty || false);
  } else {
    // Write to stdout for piping
    console.log(JSON.stringify(exported, null, 2));
  }
}

/**
 * Handle the `agora config import` command.
 */
function handleConfigImport(
  args: string[],
  options: CliOptions & { 'overwrite-identity'?: boolean; 'overwrite-relay'?: boolean; 'dry-run'?: boolean },
): void {
  if (args.length < 1) {
    console.error('Error: Missing import file. Usage: agora config import <file> [--overwrite-identity] [--overwrite-relay] [--dry-run]');
    process.exit(1);
  }

  const importPath = resolve(args[0]);
  if (!existsSync(importPath)) {
    console.error(`Error: Import file not found: ${importPath}`);
    process.exit(1);
  }

  let incoming: ExportedConfig;
  try {
    incoming = JSON.parse(readFileSync(importPath, 'utf-8')) as ExportedConfig;
  } catch {
    console.error(`Error: Invalid JSON in import file: ${importPath}`);
    process.exit(1);
  }

  if (incoming.version !== 1) {
    console.error(`Error: Unsupported export version: ${(incoming as unknown as Record<string, unknown>).version}`);
    process.exit(1);
  }

  const configPath = getConfigPath(options);

  // If target config doesn't exist, initialize it first
  if (!existsSync(configPath)) {
    ensureConfigDir(configPath);
    initPeerConfig(configPath);
  }

  const config = loadAgoraConfig(configPath);
  const result = importConfig(config, incoming, {
    overwriteIdentity: options['overwrite-identity'],
    overwriteRelay: options['overwrite-relay'],
  });

  if (!options['dry-run']) {
    saveAgoraConfig(configPath, config);
  }

  output({
    status: options['dry-run'] ? 'dry-run' : 'imported',
    configPath,
    peersAdded: result.peersAdded.length,
    peersSkipped: result.peersSkipped.length,
    identityImported: result.identityImported,
    relayImported: result.relayImported,
  }, options.pretty || false);
}

/**
 * Handle the `agora peers copy` command.
 * Copy a peer from one profile to another.
 */
function handlePeersCopy(
  args: string[],
  options: CliOptions & { from?: string; to?: string },
): void {
  if (args.length < 1) {
    console.error('Error: Missing peer name. Usage: agora peers copy <name> --from <profile> --to <profile>');
    console.error('  Profile names: "default" or a named profile. Omit for the current --profile / default.');
    process.exit(1);
  }

  const peerRef = args[0];
  const fromProfile = options.from;
  const toProfile = options.to;

  // Resolve source config
  const fromPath = fromProfile !== undefined
    ? getProfileConfigPath(fromProfile)
    : getConfigPath(options);

  if (!existsSync(fromPath)) {
    console.error(`Error: Source config not found: ${fromPath}`);
    process.exit(1);
  }

  // Resolve target config
  const toPath = toProfile !== undefined
    ? getProfileConfigPath(toProfile)
    : getConfigPath(options);

  if (fromPath === toPath) {
    console.error('Error: Source and target profiles are the same.');
    process.exit(1);
  }

  // Load source and resolve peer
  const sourceConfig = loadPeerConfig(fromPath);
  const resolved = resolvePeerEntry(sourceConfig.peers, peerRef);
  if (!resolved) {
    console.error(`Error: Peer '${peerRef}' not found in source config (${fromPath}).`);
    process.exit(1);
  }

  // Ensure target exists
  if (!existsSync(toPath)) {
    ensureConfigDir(toPath);
    initPeerConfig(toPath);
  }

  const targetConfig = loadPeerConfig(toPath);

  // Copy peer (overwrite if already present)
  targetConfig.peers[resolved.key] = { ...resolved.peer };
  savePeerConfig(toPath, targetConfig);

  output({
    status: 'copied',
    peer: resolved.peer.name || resolved.key,
    publicKey: resolved.peer.publicKey,
    from: fromPath,
    to: toPath,
  }, options.pretty || false);
}

/**
 * Handle the `agora announce` command.
 * Disabled to enforce strict peer-to-peer semantics.
 */
async function handleAnnounce(options: CliOptions & { name?: string; version?: string }): Promise<void> {
  void options;
  console.error('Error: `agora announce` is disabled. Agora now supports strict peer-to-peer only (no all/broadcast).');
  console.error('Use: agora send <peer> --type announce --payload <json>');
  process.exit(1);
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

  const peerRef = args[0];
  const configPath = getConfigPath(options);

  if (!existsSync(configPath)) {
    console.error('Error: Config file not found. Run `agora init` first.');
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  const resolved = resolvePeerEntry(config.peers, peerRef);
  if (!resolved) {
    console.error(`Error: Peer '${peerRef}' not found.`);
    process.exit(1);
  }

  const peer = resolved.peer;

  if (!peer.url) {
    console.error(`Error: Peer '${peerRef}' has no URL configured. Cannot diagnose.`);
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
    peer: peerRef,
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
  
  // Resolve server name using priority: CLI --name, config.relay.name, config.identity.name, default
  const serverName = resolveBroadcastName(config, options.name) || 'agora-server';

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
      from: envelope.from,
      to: envelope.to,
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
 * Get the reputation store file path.
 */
function getReputationStorePath(): string {
  return resolve(homedir(), '.local', 'share', 'agora', 'reputation.jsonl');
}

/**
 * Handle the `agora reputation verify` command.
 * Creates a verification record for another agent's output.
 */
async function handleReputationVerify(
  args: string[],
  options: CliOptions & {
    target?: string;
    domain?: string;
    verdict?: string;
    confidence?: string;
    evidence?: string;
  }
): Promise<void> {
  if (!options.target || !options.domain || !options.verdict) {
    console.error('Error: Missing required options');
    console.error('Usage: agora reputation verify --target <id> --domain <domain> --verdict <correct|incorrect|disputed> --confidence <0-1> [--evidence <url>]');
    process.exit(1);
  }

  // Validate verdict
  if (!['correct', 'incorrect', 'disputed'].includes(options.verdict)) {
    console.error('Error: verdict must be one of: correct, incorrect, disputed');
    process.exit(1);
  }

  // Parse confidence
  const confidence = options.confidence ? parseFloat(options.confidence) : 1.0;
  if (isNaN(confidence) || confidence < 0 || confidence > 1) {
    console.error('Error: confidence must be a number between 0 and 1');
    process.exit(1);
  }

  // Load config
  const configPath = getConfigPath(options);
  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found at ${configPath}. Run 'agora init' first.`);
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  // Create verification
  const verification = createVerification(
    config.identity.publicKey,
    config.identity.privateKey,
    options.target,
    options.domain,
    options.verdict as 'correct' | 'incorrect' | 'disputed',
    confidence,
    Date.now(),
    options.evidence
  );

  // Save to reputation store
  const storePath = getReputationStorePath();
  const store = new ReputationStore(storePath);
  await store.addVerification(verification);

  output({
    status: 'verification_created',
    id: verification.id,
    verifier: verification.verifier,
    target: verification.target,
    domain: verification.domain,
    verdict: verification.verdict,
    confidence: verification.confidence,
    timestamp: verification.timestamp,
  }, options.pretty || false);
}

/**
 * Handle the `agora reputation commit` command.
 * Creates a commitment to a prediction before outcome is known.
 */
async function handleReputationCommit(
  args: string[],
  options: CliOptions & {
    domain?: string;
    prediction?: string;
    expiry?: string;
  }
): Promise<void> {
  if (!options.domain || !options.prediction) {
    console.error('Error: Missing required options');
    console.error('Usage: agora reputation commit --domain <domain> --prediction <text> [--expiry <milliseconds>]');
    console.error('Example: agora reputation commit --domain weather_forecast --prediction "It will rain tomorrow" --expiry 86400000');
    process.exit(1);
  }

  // Parse expiry (default 24 hours)
  const expiryMs = options.expiry ? parseInt(options.expiry, 10) : 86400000;
  if (isNaN(expiryMs) || expiryMs <= 0) {
    console.error('Error: expiry must be a positive number (milliseconds)');
    process.exit(1);
  }

  // Load config
  const configPath = getConfigPath(options);
  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found at ${configPath}. Run 'agora init' first.`);
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  // Create commit
  const commit = createCommit(
    config.identity.publicKey,
    config.identity.privateKey,
    options.domain,
    options.prediction,
    Date.now(),
    expiryMs
  );

  // Save to reputation store
  const storePath = getReputationStorePath();
  const store = new ReputationStore(storePath);
  await store.addCommit(commit);

  output({
    status: 'commitment_created',
    id: commit.id,
    agent: commit.agent,
    domain: commit.domain,
    commitment: commit.commitment,
    timestamp: commit.timestamp,
    expiry: commit.expiry,
    note: 'Store this ID to reveal the prediction after expiry',
  }, options.pretty || false);
}

/**
 * Handle the `agora reputation reveal` command.
 * Reveals a prediction and outcome after commitment expiry.
 */
async function handleReputationReveal(
  args: string[],
  options: CliOptions & {
    'commit-id'?: string;
    prediction?: string;
    outcome?: string;
    evidence?: string;
  }
): Promise<void> {
  if (!options['commit-id'] || !options.prediction || !options.outcome) {
    console.error('Error: Missing required options');
    console.error('Usage: agora reputation reveal --commit-id <id> --prediction <text> --outcome <text> [--evidence <url>]');
    process.exit(1);
  }

  // Load config
  const configPath = getConfigPath(options);
  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found at ${configPath}. Run 'agora init' first.`);
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);

  // Load commit from store
  const storePath = getReputationStorePath();
  const store = new ReputationStore(storePath);
  const commit = await store.getCommit(options['commit-id']);

  if (!commit) {
    console.error(`Error: Commitment ${options['commit-id']} not found in local store`);
    process.exit(1);
  }

  // Create reveal
  const reveal = createReveal(
    config.identity.publicKey,
    config.identity.privateKey,
    options['commit-id'],
    options.prediction,
    options.outcome,
    Date.now(),
    options.evidence
  );
  
  // Verify the reveal against the commit
  const verification = verifyReveal(commit, reveal);
  if (!verification.valid) {
    console.error(`Error: Reveal verification failed: ${verification.reason}`);
    process.exit(1);
  }

  // Save to reputation store
  await store.addReveal(reveal);

  output({
    status: 'prediction_revealed',
    id: reveal.id,
    agent: reveal.agent,
    commitmentId: reveal.commitmentId,
    prediction: reveal.prediction,
    outcome: reveal.outcome,
    timestamp: reveal.timestamp,
    verified: true,
  }, options.pretty || false);
}

/**
 * Handle the `agora reputation query` command.
 * Queries reputation score for an agent in a domain.
 */
async function handleReputationQuery(
  args: string[],
  options: CliOptions & {
    agent?: string;
    domain?: string;
  }
): Promise<void> {
  if (!options.domain) {
    console.error('Error: Missing required option: --domain');
    console.error('Usage: agora reputation query --domain <domain> [--agent <pubkey>]');
    console.error('If --agent is omitted, shows reputation for current agent');
    process.exit(1);
  }

  // Load config
  const configPath = getConfigPath(options);
  if (!existsSync(configPath)) {
    console.error(`Error: Config file not found at ${configPath}. Run 'agora init' first.`);
    process.exit(1);
  }

  const config = loadPeerConfig(configPath);
  const agent = options.agent || config.identity.publicKey;

  // Load reputation store
  const storePath = getReputationStorePath();
  const store = new ReputationStore(storePath);
  const verifications = await store.getVerificationsByDomain(options.domain);

  // Filter verifications for this agent
  const agentVerifications = verifications.filter(v => v.target === agent);

  // Compute trust score
  const score = computeTrustScore(agent, options.domain, agentVerifications, Date.now());

  output({
    agent: score.agent,
    domain: score.domain,
    score: score.score,
    verificationCount: score.verificationCount,
    lastVerified: score.lastVerified,
    lastVerifiedDate: score.lastVerified > 0 ? new Date(score.lastVerified).toISOString() : 'never',
    topVerifiers: score.topVerifiers,
  }, options.pretty || false);
}

/**
 * Parse CLI arguments and route to appropriate handler.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: agora <command> [options]');
    console.error('Commands: init, whoami, status, peers, config, send, decode, serve, diagnose, relay, reputation');
    console.error('Global: --profile <name> (or --as <name>) to select a named profile');
    console.error('  peers subcommands: add, list, remove, discover, copy');
    console.error('  config subcommands: profiles, export, import');
    console.error('  reputation subcommands: verify, commit, reveal, query');
    process.exit(1);
  }

  // Parse global options
  const parsed = parseArgs({
    args,
    options: {
      config: { type: 'string' },
      profile: { type: 'string' },
      as: { type: 'string' },
      pretty: { type: 'boolean' },
      // Config transfer options
      'include-identity': { type: 'boolean' },
      'overwrite-identity': { type: 'boolean' },
      'overwrite-relay': { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      output: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
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
      // Reputation options
      target: { type: 'string' },
      domain: { type: 'string' },
      verdict: { type: 'string' },
      confidence: { type: 'string' },
      evidence: { type: 'string' },
      prediction: { type: 'string' },
      expiry: { type: 'string' },
      'commit-id': { type: 'string' },
      outcome: { type: 'string' },
      agent: { type: 'string' },
      direct: { type: 'boolean' },
      'relay-only': { type: 'boolean' },
    },
    strict: false,
    allowPositionals: true,
  });

  const command = parsed.positionals[0];
  const subcommand = parsed.positionals[1];
  const remainingArgs = parsed.positionals.slice(2);

  // --as is an alias for --profile
  const profileValue = typeof parsed.values.profile === 'string'
    ? parsed.values.profile
    : typeof parsed.values.as === 'string'
      ? parsed.values.as
      : undefined;

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
    // Config transfer options
    'include-identity'?: boolean;
    'overwrite-identity'?: boolean;
    'overwrite-relay'?: boolean;
    'dry-run'?: boolean;
    output?: string;
    from?: string;
    to?: string;
    // Reputation options
    target?: string;
    domain?: string;
    verdict?: string;
    confidence?: string;
    evidence?: string;
    prediction?: string;
    outcome?: string;
    expiry?: string;
    'commit-id'?: string;
    agent?: string;
    direct?: boolean;
    'relay-only'?: boolean;
  } = {
    config: typeof parsed.values.config === 'string' ? parsed.values.config : undefined,
    profile: profileValue,
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
    // Reputation options
    target: typeof parsed.values.target === 'string' ? parsed.values.target : undefined,
    domain: typeof parsed.values.domain === 'string' ? parsed.values.domain : undefined,
    verdict: typeof parsed.values.verdict === 'string' ? parsed.values.verdict : undefined,
    confidence: typeof parsed.values.confidence === 'string' ? parsed.values.confidence : undefined,
    evidence: typeof parsed.values.evidence === 'string' ? parsed.values.evidence : undefined,
    prediction: typeof parsed.values.prediction === 'string' ? parsed.values.prediction : undefined,
    expiry: typeof parsed.values.expiry === 'string' ? parsed.values.expiry : undefined,
    'commit-id': typeof parsed.values['commit-id'] === 'string' ? parsed.values['commit-id'] : undefined,
    outcome: typeof parsed.values.outcome === 'string' ? parsed.values.outcome : undefined,
    agent: typeof parsed.values.agent === 'string' ? parsed.values.agent : undefined,
    direct: typeof parsed.values.direct === 'boolean' ? parsed.values.direct : undefined,
    'relay-only': typeof parsed.values['relay-only'] === 'boolean' ? parsed.values['relay-only'] : undefined,
    'include-identity': typeof parsed.values['include-identity'] === 'boolean' ? parsed.values['include-identity'] : undefined,
    'overwrite-identity': typeof parsed.values['overwrite-identity'] === 'boolean' ? parsed.values['overwrite-identity'] : undefined,
    'overwrite-relay': typeof parsed.values['overwrite-relay'] === 'boolean' ? parsed.values['overwrite-relay'] : undefined,
    'dry-run': typeof parsed.values['dry-run'] === 'boolean' ? parsed.values['dry-run'] : undefined,
    output: typeof parsed.values.output === 'string' ? parsed.values.output : undefined,
    from: typeof parsed.values.from === 'string' ? parsed.values.from : undefined,
    to: typeof parsed.values.to === 'string' ? parsed.values.to : undefined,
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
          case 'copy':
            handlePeersCopy(remainingArgs, options);
            break;
          default:
            console.error('Error: Unknown peers subcommand. Use: add, list, remove, discover, copy');
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
      case 'config':
        switch (subcommand) {
          case 'profiles':
            handleConfigProfiles(options);
            break;
          case 'export':
            handleConfigExport(options);
            break;
          case 'import':
            handleConfigImport(remainingArgs, options);
            break;
          default:
            console.error('Error: Unknown config subcommand. Use: profiles, export, import');
            process.exit(1);
        }
        break;
      case 'reputation':
        switch (subcommand) {
          case 'verify':
            await handleReputationVerify(remainingArgs, options);
            break;
          case 'commit':
            await handleReputationCommit(remainingArgs, options);
            break;
          case 'reveal':
            await handleReputationReveal(remainingArgs, options);
            break;
          case 'query':
            await handleReputationQuery(remainingArgs, options);
            break;
          default:
            console.error('Error: Unknown reputation subcommand. Use: verify, commit, reveal, query');
            process.exit(1);
        }
        break;
      default:
        console.error(`Error: Unknown command '${command}'. Use: init, whoami, status, peers, config, send, decode, serve, diagnose, relay, reputation`);
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
