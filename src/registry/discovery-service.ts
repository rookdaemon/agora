import { createEnvelope, type Envelope } from '../message/envelope.js';
import { PeerStore } from './peer-store.js';
import type { Capability } from './capability.js';
import type { Peer } from './peer.js';
import type {
  CapabilityAnnouncePayload,
  CapabilityQueryPayload,
  CapabilityResponsePayload,
} from './messages.js';

/**
 * DiscoveryService manages capability-based peer discovery.
 * It maintains a local index of peer capabilities and handles
 * capability announce, query, and response messages.
 */
export class DiscoveryService {
  constructor(
    private peerStore: PeerStore,
    private identity: { publicKey: string; privateKey: string }
  ) {}

  /**
   * Announce own capabilities to the network.
   * Creates a capability_announce envelope that can be broadcast to peers.
   * 
   * @param capabilities - List of capabilities this agent offers
   * @param metadata - Optional metadata about this agent
   * @returns A signed capability_announce envelope
   */
  announce(
    capabilities: Capability[],
    metadata?: { name?: string; version?: string }
  ): Envelope<CapabilityAnnouncePayload> {
    const payload: CapabilityAnnouncePayload = {
      publicKey: this.identity.publicKey,
      capabilities,
      metadata: metadata ? {
        ...metadata,
        lastSeen: Date.now(),
      } : {
        lastSeen: Date.now(),
      },
    };

    return createEnvelope(
      'capability_announce',
      this.identity.publicKey,
      this.identity.privateKey,
      payload
    );
  }

  /**
   * Handle an incoming capability_announce message.
   * Updates the peer store with the announced capabilities.
   * 
   * @param envelope - The capability_announce envelope to process
   */
  handleAnnounce(envelope: Envelope<CapabilityAnnouncePayload>): void {
    const { payload } = envelope;
    
    const peer: Peer = {
      publicKey: payload.publicKey,
      capabilities: payload.capabilities,
      lastSeen: payload.metadata?.lastSeen || envelope.timestamp,
      metadata: payload.metadata ? {
        name: payload.metadata.name,
        version: payload.metadata.version,
      } : undefined,
    };

    this.peerStore.addOrUpdatePeer(peer);
  }

  /**
   * Create a capability query payload.
   * 
   * @param queryType - Type of query: 'name', 'tag', or 'schema'
   * @param query - The query value (capability name, tag, or schema)
   * @param filters - Optional filters (limit, minTrustScore)
   * @returns A capability_query payload
   */
  query(
    queryType: 'name' | 'tag' | 'schema',
    query: string | object,
    filters?: { limit?: number; minTrustScore?: number }
  ): CapabilityQueryPayload {
    return {
      queryType,
      query,
      filters,
    };
  }

  /**
   * Handle an incoming capability_query message.
   * Searches the local peer store and returns matching peers.
   * 
   * @param envelope - The capability_query envelope to process
   * @returns A capability_response envelope with matching peers
   */
  handleQuery(
    envelope: Envelope<CapabilityQueryPayload>
  ): Envelope<CapabilityResponsePayload> {
    const { payload } = envelope;
    let peers: Peer[] = [];

    // Execute query based on type
    if (payload.queryType === 'name' && typeof payload.query === 'string') {
      peers = this.peerStore.findByCapability(payload.query);
    } else if (payload.queryType === 'tag' && typeof payload.query === 'string') {
      peers = this.peerStore.findByTag(payload.query);
    } else if (payload.queryType === 'schema') {
      // Schema-based matching is deferred to Phase 2b
      // For now, return empty results
      peers = [];
    }

    // Apply filters
    const limit = payload.filters?.limit;
    const totalMatches = peers.length;
    
    if (limit !== undefined && limit > 0) {
      peers = peers.slice(0, limit);
    }

    // Transform peers to response format
    const responsePeers = peers.map(peer => ({
      publicKey: peer.publicKey,
      capabilities: peer.capabilities,
      metadata: peer.metadata ? {
        name: peer.metadata.name,
        version: peer.metadata.version,
        lastSeen: peer.lastSeen,
      } : {
        lastSeen: peer.lastSeen,
      },
      // Trust score integration deferred to Phase 2b (RFC-001)
      trustScore: undefined,
    }));

    const responsePayload: CapabilityResponsePayload = {
      queryId: envelope.id,
      peers: responsePeers,
      totalMatches,
    };

    return createEnvelope(
      'capability_response',
      this.identity.publicKey,
      this.identity.privateKey,
      responsePayload,
      envelope.id // inReplyTo
    );
  }

  /**
   * Remove peers that haven't been seen within the specified time window.
   * 
   * @param maxAgeMs - Maximum age in milliseconds
   * @returns Number of peers removed
   */
  pruneStale(maxAgeMs: number): number {
    return this.peerStore.prune(maxAgeMs);
  }
}
