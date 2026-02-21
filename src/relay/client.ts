import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { verifyEnvelope, type Envelope } from '../message/envelope.js';
import type { RelayClientMessage, RelayServerMessage, RelayPeer } from './types.js';

/**
 * Configuration for RelayClient
 */
export interface RelayClientConfig {
  /** WebSocket URL of the relay server */
  relayUrl: string;
  /** Agent's public key */
  publicKey: string;
  /** Agent's private key (for signing) */
  privateKey: string;
  /** Optional name for this agent */
  name?: string;
  /** Keepalive ping interval in milliseconds (default: 30000) */
  pingInterval?: number;
  /** Maximum reconnection delay in milliseconds (default: 60000) */
  maxReconnectDelay?: number;
}

/**
 * Events emitted by RelayClient
 */
export interface RelayClientEvents {
  /** Emitted when successfully connected and registered */
  'connected': () => void;
  /** Emitted when disconnected from relay */
  'disconnected': () => void;
  /** Emitted when a verified message is received */
  'message': (envelope: Envelope, from: string, fromName?: string) => void;
  /** Emitted when a peer comes online */
  'peer_online': (peer: RelayPeer) => void;
  /** Emitted when a peer goes offline */
  'peer_offline': (peer: RelayPeer) => void;
  /** Emitted on errors */
  'error': (error: Error) => void;
}

/**
 * Persistent WebSocket client for the Agora relay server.
 * Maintains a long-lived connection, handles reconnection, and routes messages.
 */
export class RelayClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private config: RelayClientConfig;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private pingInterval: NodeJS.Timeout | null = null;
  private isConnected = false;
  private isRegistered = false;
  private shouldReconnect = true;
  private onlinePeers = new Map<string, RelayPeer>();
  /** Peers for which the relay stores messages (always considered reachable). */
  private storedForPeers = new Set<string>();

  constructor(config: RelayClientConfig) {
    super();
    this.config = {
      pingInterval: 30000,
      maxReconnectDelay: 60000,
      ...config,
    };
  }

  /**
   * Connect to the relay server
   */
  async connect(): Promise<void> {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.shouldReconnect = true;
    return this.doConnect();
  }

  /**
   * Disconnect from the relay server
   */
  disconnect(): void {
    this.shouldReconnect = false;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Check if currently connected and registered
   */
  connected(): boolean {
    return this.isConnected && this.isRegistered;
  }

  /**
   * Send a message to a specific peer
   */
  async send(to: string, envelope: Envelope): Promise<{ ok: boolean; error?: string }> {
    if (!this.connected()) {
      return { ok: false, error: 'Not connected to relay' };
    }

    const message: RelayClientMessage = {
      type: 'message',
      to,
      envelope,
    };

    try {
      this.ws!.send(JSON.stringify(message));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Broadcast a message to all connected peers
   */
  async broadcast(envelope: Envelope): Promise<{ ok: boolean; error?: string }> {
    if (!this.connected()) {
      return { ok: false, error: 'Not connected to relay' };
    }

    const message: RelayClientMessage = {
      type: 'broadcast',
      envelope,
    };

    try {
      this.ws!.send(JSON.stringify(message));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Get list of currently online peers
   */
  getOnlinePeers(): RelayPeer[] {
    return Array.from(this.onlinePeers.values());
  }

  /**
   * Check if a specific peer is online or has relay storage (always reachable)
   */
  isPeerOnline(publicKey: string): boolean {
    return this.onlinePeers.has(publicKey) || this.storedForPeers.has(publicKey);
  }

  /**
   * Internal: Perform connection
   */
  private async doConnect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.config.relayUrl);
        let resolved = false;

        const resolveOnce = (callback: () => void): void => {
          if (!resolved) {
            resolved = true;
            callback();
          }
        };

        this.ws.on('open', () => {
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.startPingInterval();

          // Send registration message
          const registerMsg: RelayClientMessage = {
            type: 'register',
            publicKey: this.config.publicKey,
            name: this.config.name,
          };
          this.ws!.send(JSON.stringify(registerMsg));
        });

        this.ws.on('message', (data: WebSocket.Data) => {
          try {
            const msg = JSON.parse(data.toString()) as RelayServerMessage;
            this.handleMessage(msg);

            // Resolve promise on successful registration
            if (msg.type === 'registered' && !resolved) {
              resolveOnce(() => resolve());
            }
          } catch (err) {
            this.emit('error', new Error(`Failed to parse message: ${err instanceof Error ? err.message : String(err)}`));
          }
        });

        this.ws.on('close', () => {
          this.isConnected = false;
          this.isRegistered = false;
          this.cleanup();
          this.emit('disconnected');

          if (this.shouldReconnect) {
            this.scheduleReconnect();
          }

          if (!resolved) {
            resolveOnce(() => reject(new Error('Connection closed before registration')));
          }
        });

        this.ws.on('error', (err) => {
          this.emit('error', err);
          if (!resolved) {
            resolveOnce(() => reject(err));
          }
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Handle incoming message from relay
   */
  private handleMessage(msg: RelayServerMessage): void {
    switch (msg.type) {
      case 'registered':
        this.isRegistered = true;
        if (msg.peers) {
          // Populate initial peer list; track any that have relay storage
          for (const peer of msg.peers) {
            this.onlinePeers.set(peer.publicKey, peer);
            if (peer.storedFor) {
              this.storedForPeers.add(peer.publicKey);
            }
          }
        }
        // Offline stored-for peers: the relay buffers messages for them even when offline
        if (msg.storedPeers) {
          for (const peer of msg.storedPeers) {
            this.storedForPeers.add(peer.publicKey);
          }
        }
        this.emit('connected');
        break;

      case 'message':
        if (msg.envelope && msg.from) {
          // Verify envelope signature
          const verification = verifyEnvelope(msg.envelope);
          if (!verification.valid) {
            this.emit('error', new Error(`Invalid envelope signature: ${verification.reason}`));
            return;
          }

          // Verify sender matches 'from' field
          if (msg.envelope.sender !== msg.from) {
            this.emit('error', new Error('Envelope sender does not match relay from field'));
            return;
          }

          // Emit verified message
          this.emit('message', msg.envelope, msg.from, msg.name);
        }
        break;

      case 'peer_online':
        if (msg.publicKey) {
          const peer: RelayPeer = {
            publicKey: msg.publicKey,
            name: msg.name,
            storedFor: msg.storedFor,
          };
          this.onlinePeers.set(msg.publicKey, peer);
          if (msg.storedFor) {
            this.storedForPeers.add(msg.publicKey);
          }
          this.emit('peer_online', peer);
        }
        break;

      case 'peer_offline':
        if (msg.publicKey) {
          const peer = this.onlinePeers.get(msg.publicKey);
          if (peer) {
            this.onlinePeers.delete(msg.publicKey);
            // If the relay stores messages for this peer, keep it in storedForPeers
            // so isPeerOnline() continues to return true.
            if (msg.storedFor) {
              this.storedForPeers.add(msg.publicKey);
            }
            this.emit('peer_offline', peer);
          }
        }
        break;

      case 'error':
        this.emit('error', new Error(`Relay error: ${msg.message || 'Unknown error'}`));
        break;

      case 'pong':
        // Keepalive response, no action needed
        break;

      default:
        // Unknown message type, ignore
        break;
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 60s (max)
    const delay = Math.min(
      1000 * Math.pow(2, this.reconnectAttempts),
      this.config.maxReconnectDelay!
    );

    this.reconnectAttempts++;

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      if (this.shouldReconnect) {
        this.doConnect().catch((err) => {
          this.emit('error', err);
        });
      }
    }, delay);
  }

  /**
   * Start periodic ping messages
   */
  private startPingInterval(): void {
    this.stopPingInterval();
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        const ping: RelayClientMessage = { type: 'ping' };
        this.ws.send(JSON.stringify(ping));
      }
    }, this.config.pingInterval!);
  }

  /**
   * Stop ping interval
   */
  private stopPingInterval(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    this.stopPingInterval();
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    this.onlinePeers.clear();
    // Clear stored-for peers; they will be re-populated from the next 'registered' message.
    this.storedForPeers.clear();
  }
}
