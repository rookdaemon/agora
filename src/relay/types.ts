import type { Envelope } from '../message/envelope';

/**
 * Messages sent from client to relay server
 */
export interface RelayClientMessage {
  type: 'register' | 'message' | 'ping';
  publicKey?: string;
  to?: string;
  envelope?: Envelope;
}

/**
 * Messages received from relay server
 */
export interface RelayServerMessage {
  type: 'registered' | 'message' | 'error' | 'pong' | 'peer_online' | 'peer_offline';
  publicKey?: string;
  sessionId?: string;
  from?: string;
  envelope?: Envelope;
  peers?: Array<{ publicKey: string }>;
  code?: string;
  message?: string;
}

/**
 * Peer presence information
 */
export interface RelayPeer {
  publicKey: string;
}
