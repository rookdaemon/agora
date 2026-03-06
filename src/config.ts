import { readFileSync, existsSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
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
    for (const [key, entry] of Object.entries(config.peers)) {
      const peer = entry as Record<string, unknown>;
      if (peer && typeof peer.publicKey === 'string') {
        peers[peer.publicKey as string] = {
          publicKey: peer.publicKey as string,
          url: typeof peer.url === 'string' ? peer.url : undefined,
          token: typeof peer.token === 'string' ? peer.token : undefined,
          name: typeof peer.name === 'string' ? peer.name : (key !== peer.publicKey ? key : undefined),
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

// ---------------------------------------------------------------------------
// Profile support
// ---------------------------------------------------------------------------

/**
 * Base directory for agora config: AGORA_CONFIG_DIR env or ~/.config/agora
 */
export function getConfigDir(): string {
  if (process.env.AGORA_CONFIG_DIR) {
    return resolve(process.env.AGORA_CONFIG_DIR);
  }
  return resolve(homedir(), '.config', 'agora');
}

/**
 * Resolve the config path for a given profile name.
 *   - undefined / "default"  → ~/.config/agora/config.json  (existing behaviour)
 *   - "stefan"               → ~/.config/agora/profiles/stefan/config.json
 */
export function getProfileConfigPath(profile?: string): string {
  if (process.env.AGORA_CONFIG) {
    return resolve(process.env.AGORA_CONFIG);
  }
  const base = getConfigDir();
  if (!profile || profile === 'default') {
    return join(base, 'config.json');
  }
  return join(base, 'profiles', profile, 'config.json');
}

/**
 * List available profiles.
 * Returns an array of profile names. "default" is included if config.json exists.
 */
export function listProfiles(): string[] {
  const base = getConfigDir();
  const profiles: string[] = [];

  // Default profile
  if (existsSync(join(base, 'config.json'))) {
    profiles.push('default');
  }

  // Named profiles
  const profilesDir = join(base, 'profiles');
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && existsSync(join(profilesDir, entry.name, 'config.json'))) {
        profiles.push(entry.name);
      }
    }
  }

  return profiles;
}

// ---------------------------------------------------------------------------
// Export / Import
// ---------------------------------------------------------------------------

export interface ExportedConfig {
  /** Schema version for forward-compat */
  version: 1;
  identity?: AgoraIdentity;
  peers: Record<string, AgoraPeerConfig>;
  relay?: RelayConfig;
}

export interface ImportResult {
  peersAdded: string[];
  peersSkipped: string[];
  identityImported: boolean;
  relayImported: boolean;
}

/**
 * Export the config (or just peers) as a portable JSON object.
 */
export function exportConfig(
  config: AgoraConfig,
  opts: { includeIdentity?: boolean } = {},
): ExportedConfig {
  const exported: ExportedConfig = {
    version: 1,
    peers: Object.fromEntries(
      Object.entries(config.peers).map(([k, v]) => [k, { ...v }]),
    ),
  };
  if (opts.includeIdentity) {
    exported.identity = { ...config.identity };
  }
  if (config.relay) {
    exported.relay = { ...config.relay };
  }
  return exported;
}

/**
 * Import peers (and optionally identity/relay) into an existing config.
 * Merges peers by public key — existing peers are NOT overwritten.
 */
export function importConfig(
  target: AgoraConfig,
  incoming: ExportedConfig,
  opts: { overwriteIdentity?: boolean; overwriteRelay?: boolean } = {},
): ImportResult {
  const result: ImportResult = {
    peersAdded: [],
    peersSkipped: [],
    identityImported: false,
    relayImported: false,
  };

  // Merge peers
  for (const [key, peer] of Object.entries(incoming.peers)) {
    if (target.peers[key]) {
      result.peersSkipped.push(key);
    } else {
      target.peers[key] = { ...peer };
      result.peersAdded.push(key);
    }
  }

  // Identity
  if (opts.overwriteIdentity && incoming.identity) {
    target.identity = { ...incoming.identity };
    result.identityImported = true;
  }

  // Relay
  if (opts.overwriteRelay && incoming.relay) {
    target.relay = { ...incoming.relay };
    result.relayImported = true;
  }

  return result;
}

/**
 * Save an AgoraConfig to disk (creates parent dirs as needed).
 */
export function saveAgoraConfig(path: string, config: AgoraConfig): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const raw: Record<string, unknown> = {
    identity: config.identity,
    peers: config.peers,
  };
  if (config.relay) {
    raw.relay = config.relay;
  }
  writeFileSync(path, JSON.stringify(raw, null, 2) + '\n', 'utf-8');
}
