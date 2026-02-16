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

/**
 * Payload for 'capability_announce' messages.
 * An agent publishes its capabilities to the network.
 */
export interface CapabilityAnnouncePayload {
  /** Agent's Ed25519 public key */
  publicKey: string;
  /** List of capabilities offered */
  capabilities: Capability[];
  /** Optional metadata */
  metadata?: {
    name?: string;
    version?: string;
    lastSeen?: number;
  };
}

/**
 * Payload for 'capability_query' messages.
 * An agent queries the network for peers with specific capabilities.
 */
export interface CapabilityQueryPayload {
  /** Query type: by name, tag, or schema */
  queryType: 'name' | 'tag' | 'schema';
  /** Query value (capability name, tag, or JSON schema) */
  query: string | object;
  /** Optional filters */
  filters?: {
    /** Minimum trust score (RFC-001 integration) */
    minTrustScore?: number;
    /** Maximum results to return */
    limit?: number;
  };
}

/**
 * Payload for 'capability_response' messages.
 * Response to a capability_query with matching peers.
 */
export interface CapabilityResponsePayload {
  /** Query ID this is responding to */
  queryId: string;
  /** Matching peers */
  peers: Array<{
    publicKey: string;
    capabilities: Capability[];
    metadata?: {
      name?: string;
      version?: string;
      lastSeen?: number;
    };
    /** Trust score from RFC-001 (Phase 2b) */
    trustScore?: number;
  }>;
  /** Total matching peers (may be > peers.length if limited) */
  totalMatches: number;
}
