/**
 * Peer discovery message types for the Agora network.
 */

/**
 * Request peer list from relay
 */
export interface PeerListRequestPayload {
  /** Optional filters */
  filters?: {
    /** Only peers seen in last N ms */
    activeWithin?: number;
    /** Maximum peers to return */
    limit?: number;
  };
}

/**
 * Relay responds with connected peers
 */
export interface PeerListResponsePayload {
  /** List of known peers */
  peers: Array<{
    /** Peer's Ed25519 public key */
    publicKey: string;
    /** Optional metadata (if peer announced) */
    metadata?: {
      name?: string;
      version?: string;
      capabilities?: string[];
    };
    /** Last seen timestamp (ms) */
    lastSeen: number;
  }>;
  /** Total peer count (may be > peers.length if limited) */
  totalPeers: number;
  /** Relay's public key (for trust verification) */
  relayPublicKey: string;
}

/**
 * Agent recommends another agent
 */
export interface PeerReferralPayload {
  /** Referred peer's public key */
  publicKey: string;
  /** Optional endpoint (if known) */
  endpoint?: string;
  /** Optional metadata */
  metadata?: {
    name?: string;
    version?: string;
    capabilities?: string[];
  };
  /** Referrer's comment */
  comment?: string;
  /** Trust hint (RFC-001 integration) */
  trustScore?: number;
}

/**
 * Validate PeerListRequestPayload
 */
export function validatePeerListRequest(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    errors.push('Payload must be an object');
    return { valid: false, errors };
  }

  const p = payload as Record<string, unknown>;

  if (p.filters !== undefined) {
    if (typeof p.filters !== 'object' || p.filters === null) {
      errors.push('filters must be an object');
    } else {
      const filters = p.filters as Record<string, unknown>;
      if (filters.activeWithin !== undefined && typeof filters.activeWithin !== 'number') {
        errors.push('filters.activeWithin must be a number');
      }
      if (filters.limit !== undefined && typeof filters.limit !== 'number') {
        errors.push('filters.limit must be a number');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate PeerListResponsePayload
 */
export function validatePeerListResponse(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    errors.push('Payload must be an object');
    return { valid: false, errors };
  }

  const p = payload as Record<string, unknown>;

  if (!Array.isArray(p.peers)) {
    errors.push('peers must be an array');
  } else {
    p.peers.forEach((peer, index) => {
      if (typeof peer !== 'object' || peer === null) {
        errors.push(`peers[${index}] must be an object`);
        return;
      }
      const peerObj = peer as Record<string, unknown>;
      if (typeof peerObj.publicKey !== 'string') {
        errors.push(`peers[${index}].publicKey must be a string`);
      }
      if (typeof peerObj.lastSeen !== 'number') {
        errors.push(`peers[${index}].lastSeen must be a number`);
      }
    });
  }

  if (typeof p.totalPeers !== 'number') {
    errors.push('totalPeers must be a number');
  }

  if (typeof p.relayPublicKey !== 'string') {
    errors.push('relayPublicKey must be a string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate PeerReferralPayload
 */
export function validatePeerReferral(payload: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (typeof payload !== 'object' || payload === null) {
    errors.push('Payload must be an object');
    return { valid: false, errors };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.publicKey !== 'string') {
    errors.push('publicKey must be a string');
  }

  if (p.endpoint !== undefined && typeof p.endpoint !== 'string') {
    errors.push('endpoint must be a string');
  }

  if (p.comment !== undefined && typeof p.comment !== 'string') {
    errors.push('comment must be a string');
  }

  if (p.trustScore !== undefined && typeof p.trustScore !== 'number') {
    errors.push('trustScore must be a number');
  }

  return { valid: errors.length === 0, errors };
}
