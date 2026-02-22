import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import type { KeyPair } from '../identity/keypair';
import type { Envelope } from '../message/envelope';
import { createEnvelope, verifyEnvelope } from '../message/envelope';
import type { AnnouncePayload } from '../registry/messages';

/**
 * Represents a connected peer
 */
export interface ConnectedPeer {
  /** Peer's public key */
  publicKey: string;
  /** WebSocket connection */
  socket: WebSocket;
  /** Whether the peer has been announced */
  announced: boolean;
  /** Peer metadata from announce message */
  metadata?: {
    name?: string;
    version?: string;
  };
}

/**
 * Events emitted by PeerServer
 */
export interface PeerServerEvents {
  'peer-connected': (publicKey: string, peer: ConnectedPeer) => void;
  'peer-disconnected': (publicKey: string) => void;
  'message-received': (envelope: Envelope, fromPublicKey: string) => void;
  'error': (error: Error) => void;
}

/**
 * WebSocket server for accepting peer connections
 */
export class PeerServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private peers = new Map<string, ConnectedPeer>();
  private identity: KeyPair;
  private announcePayload: AnnouncePayload;

  constructor(identity: KeyPair, announcePayload: AnnouncePayload) {
    super();
    this.identity = identity;
    this.announcePayload = announcePayload;
  }

  /**
   * Start the WebSocket server
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port });

        this.wss.on('error', (error) => {
          this.emit('error', error);
          reject(error);
        });

        this.wss.on('listening', () => {
          resolve();
        });

        this.wss.on('connection', (socket: WebSocket) => {
          this.handleConnection(socket);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Stop the WebSocket server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Close all peer connections
      for (const peer of this.peers.values()) {
        peer.socket.close();
      }
      this.peers.clear();

      this.wss.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.wss = null;
          resolve();
        }
      });
    });
  }

  /**
   * Get all connected peers
   */
  getPeers(): Map<string, ConnectedPeer> {
    return new Map(this.peers);
  }

  /**
   * Send a message to a specific peer
   */
  send(publicKey: string, envelope: Envelope): boolean {
    const peer = this.peers.get(publicKey);
    if (!peer || peer.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      peer.socket.send(JSON.stringify(envelope));
      return true;
    } catch (error) {
      this.emit('error', error as Error);
      return false;
    }
  }

  /**
   * Broadcast a message to all connected peers
   */
  broadcast(envelope: Envelope): void {
    for (const [publicKey, peer] of this.peers) {
      if (peer.socket.readyState === WebSocket.OPEN) {
        this.send(publicKey, envelope);
      }
    }
  }

  /**
   * Handle incoming connection
   */
  private handleConnection(socket: WebSocket): void {
    let peerPublicKey: string | null = null;

    // Send announce message immediately
    const announceEnvelope = createEnvelope(
      'announce',
      this.identity.publicKey,
      this.identity.privateKey,
      this.announcePayload
    );
    socket.send(JSON.stringify(announceEnvelope));

    socket.on('message', (data: Buffer) => {
      try {
        const envelope = JSON.parse(data.toString()) as Envelope;

        // Verify envelope signature
        const verification = verifyEnvelope(envelope);
        if (!verification.valid) {
          // Drop invalid messages
          return;
        }

        // First message should be an announce
        if (!peerPublicKey) {
          if (envelope.type === 'announce') {
            peerPublicKey = envelope.sender;
            const payload = envelope.payload as AnnouncePayload;
            
            const peer: ConnectedPeer = {
              publicKey: peerPublicKey,
              socket,
              announced: true,
              metadata: payload.metadata,
            };

            this.peers.set(peerPublicKey, peer);
            this.emit('peer-connected', peerPublicKey, peer);
          }
          return;
        }

        // Verify the message is from the announced peer
        if (envelope.sender !== peerPublicKey) {
          // Drop messages from wrong sender
          return;
        }

        // Emit message-received event
        this.emit('message-received', envelope, peerPublicKey);
      } catch {
        // Invalid JSON or other parsing errors - drop the message
      }
    });

    socket.on('close', () => {
      if (peerPublicKey) {
        this.peers.delete(peerPublicKey);
        this.emit('peer-disconnected', peerPublicKey);
      }
    });

    socket.on('error', (error) => {
      this.emit('error', error);
    });
  }
}
