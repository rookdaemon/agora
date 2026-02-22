import type { Capability } from './capability';

/**
 * A peer is an agent on the network
 */
export interface Peer {
  /** Identity (hex-encoded ed25519 public key) */
  publicKey: string;
  /** Capabilities this peer offers */
  capabilities: Capability[];
  /** Unix timestamp (ms) when this peer was last seen */
  lastSeen: number;
  /** Optional metadata about the peer */
  metadata?: {
    /** Human-readable alias */
    name?: string;
    /** Agent software version */
    version?: string;
  };
}
