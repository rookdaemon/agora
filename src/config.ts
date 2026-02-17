import { readFileSync, existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';

/**
 * Normalized relay configuration (supports both string and object in config file).
 */
export interface RelayConfig {
  url: string;
  autoConnect: boolean;
  name?: string;
  reconnectMaxMs?: number;
}

/**
 * Peer entry in config (webhook URL, token, public key).
 */
export interface AgoraPeerConfig {
  publicKey: string;
  /** Webhook URL (undefined for relay-only peers) */
  url?: string;
  /** Webhook auth token (undefined for relay-only peers) */
  token?: string;
  name?: string;
}

/**
 * Identity with optional display name (e.g. for relay registration).
 */
export interface AgoraIdentity {
  publicKey: string;
  privateKey: string;
  name?: string;
}

/**
 * Canonical Agora configuration shape.
 * Use loadAgoraConfig() to load from file with normalized relay.
 */
export interface AgoraConfig {
  identity: AgoraIdentity;
  peers: Record<string, AgoraPeerConfig>;
  relay?: RelayConfig;
}

/**
 * Default config file path: AGORA_CONFIG env or ~/.config/agora/config.json
 */
export function getDefaultConfigPath(): string {
  if (process.env.AGORA_CONFIG) {
    return resolve(process.env.AGORA_CONFIG);
  }
  return resolve(homedir(), '.config', 'agora', 'config.json');
}

/**
 * Parse and normalize config from a JSON object (shared by sync and async loaders).
 */
function parseConfig(config: Record<string, unknown>): AgoraConfig {
  const rawIdentity = config.identity as Record<string, unknown> | undefined;
  if (!rawIdentity?.publicKey || !rawIdentity?.privateKey) {
    throw new Error('Invalid config: missing identity.publicKey or identity.privateKey');
  }
  const identity: AgoraIdentity = {
    publicKey: rawIdentity.publicKey as string,
    privateKey: rawIdentity.privateKey as string,
    name: typeof rawIdentity.name === 'string' ? rawIdentity.name : undefined,
  };

  const peers: Record<string, AgoraPeerConfig> = {};
  if (config.peers && typeof config.peers === 'object') {
    for (const [name, entry] of Object.entries(config.peers)) {
      const peer = entry as Record<string, unknown>;
      if (peer && typeof peer.publicKey === 'string') {
        peers[name] = {
          publicKey: peer.publicKey as string,
          url: typeof peer.url === 'string' ? peer.url : undefined,
          token: typeof peer.token === 'string' ? peer.token : undefined,
          name: typeof peer.name === 'string' ? peer.name : undefined,
        };
      }
    }
  }

  let relay: RelayConfig | undefined;
  const rawRelay = config.relay;
  if (typeof rawRelay === 'string') {
    relay = { url: rawRelay, autoConnect: true };
  } else if (rawRelay && typeof rawRelay === 'object') {
    const r = rawRelay as Record<string, unknown>;
    if (typeof r.url === 'string') {
      relay = {
        url: r.url,
        autoConnect: typeof r.autoConnect === 'boolean' ? r.autoConnect : true,
        name: typeof r.name === 'string' ? r.name : undefined,
        reconnectMaxMs: typeof r.reconnectMaxMs === 'number' ? r.reconnectMaxMs : undefined,
      };
    }
  }

  return {
    identity,
    peers,
    ...(relay ? { relay } : {}),
  };
}

/**
 * Load and normalize Agora configuration from a JSON file (sync).
 * Supports relay as string (backward compat) or object { url?, autoConnect?, name?, reconnectMaxMs? }.
 *
 * @param path - Config file path; defaults to getDefaultConfigPath()
 * @returns Normalized AgoraConfig
 * @throws Error if file doesn't exist or config is invalid
 */
export function loadAgoraConfig(path?: string): AgoraConfig {
  const configPath = path ?? getDefaultConfigPath();

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found at ${configPath}. Run 'npx @rookdaemon/agora init' first.`);
  }

  const content = readFileSync(configPath, 'utf-8');
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  return parseConfig(config);
}

/**
 * Load and normalize Agora configuration from a JSON file (async).
 *
 * @param path - Config file path; defaults to getDefaultConfigPath()
 * @returns Normalized AgoraConfig
 * @throws Error if file doesn't exist or config is invalid
 */
export async function loadAgoraConfigAsync(path?: string): Promise<AgoraConfig> {
  const configPath = path ?? getDefaultConfigPath();

  let content: string;
  try {
    content = await readFile(configPath, 'utf-8');
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === 'ENOENT') {
      throw new Error(`Config file not found at ${configPath}. Run 'npx @rookdaemon/agora init' first.`);
    }
    throw err;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(content) as Record<string, unknown>;
  } catch {
    throw new Error(`Invalid JSON in config file: ${configPath}`);
  }

  return parseConfig(config);
}
