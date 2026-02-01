import type { Capability } from './capability.js';

/**
 * Payload for 'announce' messages.
 * An agent publishes its capabilities and metadata to the network.
 */
export interface AnnouncePayload {
  /** Capabilities this agent offers */
  capabilities: Capability[];
  /** Optional metadata about the agent */
  metadata?: {
    /** Human-readable agent name */
    name?: string;
    /** Agent software version */
    version?: string;
  };
}

/**
 * Payload for 'discover' messages.
 * An agent queries the network to find peers with specific capabilities.
 */
export interface DiscoverPayload {
  /** Query parameters for discovery */
  query: {
    /** Filter by capability name */
    capabilityName?: string;
    /** Filter by capability tag */
    tag?: string;
  };
}

/**
 * Payload for responses to 'discover' messages.
 * Returns a list of peers matching the discovery query.
 */
export interface DiscoverResponsePayload {
  /** Peers matching the discovery query */
  peers: Array<{
    /** Public key of the peer */
    publicKey: string;
    /** Capabilities the peer offers */
    capabilities: Capability[];
    /** Optional metadata about the peer */
    metadata?: {
      /** Human-readable peer name */
      name?: string;
      /** Peer software version */
      version?: string;
    };
  }>;
}
