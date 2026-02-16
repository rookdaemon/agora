/**
 * Bootstrap configuration for peer discovery on the Agora network.
 * Provides default bootstrap relays for initial network entry.
 */

/**
 * Default bootstrap relay servers
 * These are well-known relays that serve as initial entry points to the network
 */
export const DEFAULT_BOOTSTRAP_RELAYS = [
  {
    url: 'wss://agora-relay.lbsa71.net',
    name: 'Primary Bootstrap Relay',
    // Note: Public key would need to be set when the relay is actually deployed
    // For now, this is a placeholder that would be configured when the relay is running
  },
];

/**
 * Configuration for bootstrap connection
 */
export interface BootstrapConfig {
  /** Bootstrap relay URL */
  relayUrl: string;
  /** Optional relay public key (for verification) */
  relayPublicKey?: string;
  /** Connection timeout in ms (default: 10000) */
  timeout?: number;
}

/**
 * Get default bootstrap relay configuration
 */
export function getDefaultBootstrapRelay(): BootstrapConfig {
  return {
    relayUrl: DEFAULT_BOOTSTRAP_RELAYS[0].url,
    timeout: 10000,
  };
}

/**
 * Parse bootstrap relay URL and optional public key
 */
export function parseBootstrapRelay(url: string, publicKey?: string): BootstrapConfig {
  return {
    relayUrl: url,
    relayPublicKey: publicKey,
    timeout: 10000,
  };
}
