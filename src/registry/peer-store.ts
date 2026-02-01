import type { Peer } from './peer.js';

/**
 * In-memory store for known peers on the network
 */
export class PeerStore {
  private peers: Map<string, Peer> = new Map();

  /**
   * Add or update a peer in the store.
   * If a peer with the same publicKey exists, it will be updated.
   * 
   * @param peer - The peer to add or update
   */
  addOrUpdatePeer(peer: Peer): void {
    this.peers.set(peer.publicKey, peer);
  }

  /**
   * Remove a peer from the store.
   * 
   * @param publicKey - The public key of the peer to remove
   * @returns true if the peer was removed, false if it didn't exist
   */
  removePeer(publicKey: string): boolean {
    return this.peers.delete(publicKey);
  }

  /**
   * Get a peer by their public key.
   * 
   * @param publicKey - The public key of the peer to retrieve
   * @returns The peer if found, undefined otherwise
   */
  getPeer(publicKey: string): Peer | undefined {
    return this.peers.get(publicKey);
  }

  /**
   * Find all peers that offer a specific capability by name.
   * 
   * @param name - The capability name to search for
   * @returns Array of peers that have a capability with the given name
   */
  findByCapability(name: string): Peer[] {
    const result: Peer[] = [];
    
    for (const peer of this.peers.values()) {
      const hasCapability = peer.capabilities.some(cap => cap.name === name);
      if (hasCapability) {
        result.push(peer);
      }
    }
    
    return result;
  }

  /**
   * Find all peers that have capabilities with a specific tag.
   * 
   * @param tag - The tag to search for
   * @returns Array of peers that have at least one capability with the given tag
   */
  findByTag(tag: string): Peer[] {
    const result: Peer[] = [];
    
    for (const peer of this.peers.values()) {
      const hasTag = peer.capabilities.some(cap => cap.tags.includes(tag));
      if (hasTag) {
        result.push(peer);
      }
    }
    
    return result;
  }

  /**
   * Get all peers in the store.
   * 
   * @returns Array of all peers
   */
  allPeers(): Peer[] {
    return Array.from(this.peers.values());
  }

  /**
   * Remove peers that haven't been seen within the specified time window.
   * 
   * @param maxAgeMs - Maximum age in milliseconds. Peers older than this will be removed.
   * @returns Number of peers removed
   */
  prune(maxAgeMs: number): number {
    const now = Date.now();
    const cutoff = now - maxAgeMs;
    let removed = 0;
    
    for (const [publicKey, peer] of this.peers.entries()) {
      if (peer.lastSeen < cutoff) {
        this.peers.delete(publicKey);
        removed++;
      }
    }
    
    return removed;
  }
}
