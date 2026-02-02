import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { KeyPair } from '../identity/keypair.js';
import type { Envelope } from '../message/envelope.js';
import { createEnvelope, verifyEnvelope } from '../message/envelope.js';
import type { AnnouncePayload } from '../registry/messages.js';

/**
 * Events emitted by PeerClient
 */
export interface PeerClientEvents {
  'connected': (publicKey: string) => void;
  'disconnected': () => void;
  'message-received': (envelope: Envelope) => void;
  'error': (error: Error) => void;
}

/**
 * WebSocket client for connecting to peers
 */
export class PeerClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private identity: KeyPair;
  private announcePayload: AnnouncePayload;
  private url: string;
  private peerPublicKey: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private baseReconnectDelay = 1000; // 1 second
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private shouldReconnect = true;

  constructor(url: string, identity: KeyPair, announcePayload: AnnouncePayload) {
    super();
    this.url = url;
    this.identity = identity;
    this.announcePayload = announcePayload;
  }

  /**
   * Connect to the peer
   */
  connect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      this.socket = new WebSocket(this.url);

      this.socket.on('open', () => {
        this.reconnectAttempts = 0;
        
        // Send announce message immediately
        const announceEnvelope = createEnvelope(
          'announce',
          this.identity.publicKey,
          this.identity.privateKey,
          this.announcePayload
        );
        this.socket!.send(JSON.stringify(announceEnvelope));
      });

      this.socket.on('message', (data: Buffer) => {
        try {
          const envelope = JSON.parse(data.toString()) as Envelope;

          // Verify envelope signature
          const verification = verifyEnvelope(envelope);
          if (!verification.valid) {
            // Drop invalid messages
            return;
          }

          // First message should be an announce from the peer
          if (!this.peerPublicKey) {
            if (envelope.type === 'announce') {
              this.peerPublicKey = envelope.sender;
              this.emit('connected', this.peerPublicKey);
            }
            return;
          }

          // Verify the message is from the announced peer
          if (envelope.sender !== this.peerPublicKey) {
            // Drop messages from wrong sender
            return;
          }

          // Emit message-received event
          this.emit('message-received', envelope);
        } catch {
          // Invalid JSON or other parsing errors - drop the message
        }
      });

      this.socket.on('close', () => {
        const wasConnected = this.peerPublicKey !== null;
        this.peerPublicKey = null;
        
        if (wasConnected) {
          this.emit('disconnected');
        }

        // Attempt to reconnect with exponential backoff
        if (this.shouldReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
          const delay = this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts);
          this.reconnectAttempts++;
          
          this.reconnectTimeout = setTimeout(() => {
            this.connect();
          }, delay);
        }
      });

      this.socket.on('error', (error) => {
        this.emit('error', error);
      });
    } catch (error) {
      this.emit('error', error as Error);
    }
  }

  /**
   * Disconnect from the peer
   */
  disconnect(): void {
    this.shouldReconnect = false;
    
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.peerPublicKey = null;
  }

  /**
   * Send a message to the peer
   */
  send(envelope: Envelope): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return false;
    }

    try {
      this.socket.send(JSON.stringify(envelope));
      return true;
    } catch (error) {
      this.emit('error', error as Error);
      return false;
    }
  }

  /**
   * Check if connected to peer
   */
  isConnected(): boolean {
    return this.socket !== null && 
           this.socket.readyState === WebSocket.OPEN && 
           this.peerPublicKey !== null;
  }

  /**
   * Get the peer's public key (if connected)
   */
  getPeerPublicKey(): string | null {
    return this.peerPublicKey;
  }
}
