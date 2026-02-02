import { EventEmitter } from 'node:events';
import type { KeyPair } from '../identity/keypair.js';
import type { Envelope } from '../message/envelope.js';
import type { AnnouncePayload } from '../registry/messages.js';
import { PeerServer } from './server.js';
import { PeerClient } from './client.js';

/**
 * Peer information with public key
 */
export interface PeerInfo {
  publicKey: string;
  metadata?: {
    name?: string;
    version?: string;
  };
}

/**
 * Events emitted by PeerManager
 */
export interface PeerManagerEvents {
  'peer-connected': (publicKey: string) => void;
  'peer-disconnected': (publicKey: string) => void;
  'message-received': (envelope: Envelope, fromPublicKey: string) => void;
  'error': (error: Error) => void;
}

/**
 * Manages both server (incoming connections) and client (outbound connections)
 */
export class PeerManager extends EventEmitter {
  private server: PeerServer | null = null;
  private clients = new Map<string, PeerClient>();
  private identity: KeyPair;
  private announcePayload: AnnouncePayload;

  constructor(identity: KeyPair, announcePayload: AnnouncePayload) {
    super();
    this.identity = identity;
    this.announcePayload = announcePayload;
  }

  /**
   * Start listening for incoming peer connections
   * @param port - Port to listen on
   */
  async start(port: number): Promise<void> {
    if (this.server) {
      throw new Error('Server already started');
    }

    this.server = new PeerServer(this.identity, this.announcePayload);

    // Forward server events
    this.server.on('peer-connected', (publicKey, _peer) => {
      this.emit('peer-connected', publicKey);
    });

    this.server.on('peer-disconnected', (publicKey) => {
      this.emit('peer-disconnected', publicKey);
    });

    this.server.on('message-received', (envelope, fromPublicKey) => {
      this.emit('message-received', envelope, fromPublicKey);
    });

    this.server.on('error', (error) => {
      this.emit('error', error);
    });

    await this.server.start(port);
  }

  /**
   * Stop the server and disconnect all clients
   */
  async stop(): Promise<void> {
    // Disconnect all clients
    for (const client of this.clients.values()) {
      client.disconnect();
    }
    this.clients.clear();

    // Stop server
    if (this.server) {
      await this.server.stop();
      this.server = null;
    }
  }

  /**
   * Connect to a peer at the given URL
   * @param url - WebSocket URL of the peer (e.g., ws://localhost:8080)
   */
  connect(url: string): void {
    // Check if already connected to this URL
    if (this.clients.has(url)) {
      return;
    }

    const client = new PeerClient(url, this.identity, this.announcePayload);

    // Forward client events
    client.on('connected', (publicKey) => {
      this.emit('peer-connected', publicKey);
    });

    client.on('disconnected', () => {
      const publicKey = client.getPeerPublicKey();
      if (publicKey) {
        this.emit('peer-disconnected', publicKey);
      }
    });

    client.on('message-received', (envelope) => {
      const publicKey = client.getPeerPublicKey();
      if (publicKey) {
        this.emit('message-received', envelope, publicKey);
      }
    });

    client.on('error', (error) => {
      this.emit('error', error);
    });

    this.clients.set(url, client);
    client.connect();
  }

  /**
   * Broadcast a message to all connected peers (both incoming and outgoing)
   * @param envelope - The envelope to broadcast
   */
  broadcast(envelope: Envelope): void {
    // Broadcast to server peers
    if (this.server) {
      this.server.broadcast(envelope);
    }

    // Broadcast to client peers
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        client.send(envelope);
      }
    }
  }

  /**
   * Get list of all connected peers with their public keys
   * @returns Array of peer information
   */
  getPeers(): PeerInfo[] {
    const peers: PeerInfo[] = [];

    // Get server peers
    if (this.server) {
      for (const [publicKey, peer] of this.server.getPeers()) {
        peers.push({
          publicKey,
          metadata: peer.metadata,
        });
      }
    }

    // Get client peers
    for (const client of this.clients.values()) {
      if (client.isConnected()) {
        const publicKey = client.getPeerPublicKey();
        if (publicKey) {
          // Avoid duplicates (same peer might be connected via both server and client)
          if (!peers.find(p => p.publicKey === publicKey)) {
            peers.push({ publicKey });
          }
        }
      }
    }

    return peers;
  }

  /**
   * Send a message to a specific peer by public key
   * @param publicKey - The peer's public key
   * @param envelope - The envelope to send
   * @returns true if sent successfully, false otherwise
   */
  send(publicKey: string, envelope: Envelope): boolean {
    // Try to send via server
    if (this.server && this.server.send(publicKey, envelope)) {
      return true;
    }

    // Try to send via clients
    for (const client of this.clients.values()) {
      if (client.getPeerPublicKey() === publicKey && client.isConnected()) {
        return client.send(envelope);
      }
    }

    return false;
  }
}
