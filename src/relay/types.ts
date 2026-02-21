import type { Envelope } from '../message/envelope.js';

/**
 * Messages sent from client to relay server
 */
export interface RelayClientMessage {
  type: 'register' | 'message' | 'broadcast' | 'ping';
  publicKey?: string;
  name?: string;
  to?: string;
  envelope?: Envelope;
}

/**
 * Messages received from relay server
 */
export interface RelayServerMessage {
  type: 'registered' | 'message' | 'error' | 'pong' | 'peer_online' | 'peer_offline';
  publicKey?: string;
  name?: string;
  from?: string;
  envelope?: Envelope;
  peers?: Array<{ publicKey: string; name?: string; storedFor?: boolean }>;
  /** Peers that are offline but the relay stores messages for (store-and-forward) */
  storedPeers?: Array<{ publicKey: string }>;
  /** True when the peer referenced by this event has relay storage enabled */
  storedFor?: boolean;
  code?: string;
  message?: string;
}

/**
 * Peer presence information
 */
export interface RelayPeer {
  publicKey: string;
  name?: string;
  /** True when the relay stores messages for this peer (store-and-forward) */
  storedFor?: boolean;
}
