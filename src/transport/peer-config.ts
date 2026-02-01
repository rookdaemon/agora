import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateKeyPair } from '../identity/keypair.js';

export interface PeerConfigFile {
  identity: {
    publicKey: string;
    privateKey: string;
  };
  peers: Record<string, {
    url: string;
    token: string;
    publicKey: string;
    name?: string;
  }>;
}

/**
 * Load peer configuration from a JSON file.
 * @param path - Path to the config file
 * @returns The parsed configuration
 * @throws Error if file doesn't exist or contains invalid JSON
 */
export function loadPeerConfig(path: string): PeerConfigFile {
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as PeerConfigFile;
}

/**
 * Save peer configuration to a JSON file.
 * @param path - Path to the config file
 * @param config - The configuration to save
 */
export function savePeerConfig(path: string, config: PeerConfigFile): void {
  const content = JSON.stringify(config, null, 2);
  writeFileSync(path, content, 'utf-8');
}

/**
 * Initialize peer configuration, generating a new keypair if the file doesn't exist.
 * If the file exists, loads and returns it.
 * @param path - Path to the config file
 * @returns The configuration (loaded or newly created)
 */
export function initPeerConfig(path: string): PeerConfigFile {
  if (existsSync(path)) {
    return loadPeerConfig(path);
  }

  // Generate new keypair and create initial config
  const identity = generateKeyPair();
  const config: PeerConfigFile = {
    identity,
    peers: {},
  };

  savePeerConfig(path, config);
  return config;
}
