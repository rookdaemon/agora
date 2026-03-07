import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyEnvelope, createEnvelope, type Envelope } from '../message/envelope';
import type { PeerListRequestPayload, PeerListResponsePayload } from '../message/types/peer-discovery';
import { MessageStore } from './store';

interface SenderWindow {
  count: number;
  windowStart: number;
}

export interface RelayRateLimitOptions {
  enabled?: boolean;
  maxMessages?: number;
  windowMs?: number;
}

export interface RelayEnvelopeDedupOptions {
  enabled?: boolean;
  maxIds?: number;
}

/**
 * Represents a connected agent in the relay
 */
interface ConnectedAgent {
  /** Agent's public key */
  publicKey: string;
  /** WebSocket connection */
  socket: WebSocket;
  /** Last seen timestamp (ms) */
  lastSeen: number;
  /** Optional metadata */
  metadata?: {
    version?: string;
    capabilities?: string[];
  };
}

/**
 * Events emitted by RelayServer
 */
export interface RelayServerEvents {
  'agent-registered': (publicKey: string) => void;
  'agent-disconnected': (publicKey: string) => void;
  /** Emitted when a session disconnects (same as agent-disconnected for compatibility) */
  'disconnection': (publicKey: string) => void;
  'message-relayed': (from: string, to: string, envelope: Envelope) => void;
  'error': (error: Error) => void;
}

/**
 * WebSocket relay server for routing messages between agents.
 * 
 * Agents connect to the relay and register with their public key.
 * Messages are routed to recipients based on the 'to' field.
 * All envelopes are verified before being forwarded.
 */
export interface RelayServerOptions {
  /** Optional relay identity for peer_list_request handling */
  identity?: { publicKey: string; privateKey: string };
  /** Public keys that should have messages stored when offline */
  storagePeers?: string[];
  /** Directory for persisting messages for storage peers */
  storageDir?: string;
  /** Maximum number of concurrent registered peers (default: 100) */
  maxPeers?: number;
  /** Per-sender sliding-window message rate limiting */
  rateLimit?: RelayRateLimitOptions;
  /** Envelope ID deduplication options */
  envelopeDedup?: RelayEnvelopeDedupOptions;
}

export class RelayServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  /** publicKey -> sessionId -> ConnectedAgent (multiple sessions per key) */
  private sessions = new Map<string, Map<string, ConnectedAgent>>();
  private identity?: { publicKey: string; privateKey: string };
  private storagePeers: string[] = [];
  private store: MessageStore | null = null;
  private maxPeers: number = 100;
  private readonly senderWindows: Map<string, SenderWindow> = new Map();
  private static readonly MAX_SENDER_ENTRIES = 500;
  private readonly processedEnvelopeIds: Set<string> = new Set();
  private rateLimitEnabled = true;
  private rateLimitMaxMessages = 10;
  private rateLimitWindowMs = 60_000;
  private envelopeDedupEnabled = true;
  private envelopeDedupMaxIds = 1000;

  constructor(options?: { publicKey: string; privateKey: string } | RelayServerOptions) {
    super();
    if (options) {
      if ('identity' in options && options.identity) {
        this.identity = options.identity;
      } else if ('publicKey' in options && 'privateKey' in options) {
        this.identity = { publicKey: options.publicKey, privateKey: options.privateKey };
      }
      const opts = options as RelayServerOptions;
      if (opts.storagePeers?.length && opts.storageDir) {
        this.storagePeers = opts.storagePeers;
        this.store = new MessageStore(opts.storageDir);
      }
      if (opts.maxPeers !== undefined) {
        this.maxPeers = opts.maxPeers;
      }
      if (opts.rateLimit) {
        if (opts.rateLimit.enabled !== undefined) {
          this.rateLimitEnabled = opts.rateLimit.enabled;
        }
        if (opts.rateLimit.maxMessages !== undefined && opts.rateLimit.maxMessages > 0) {
          this.rateLimitMaxMessages = opts.rateLimit.maxMessages;
        }
        if (opts.rateLimit.windowMs !== undefined && opts.rateLimit.windowMs > 0) {
          this.rateLimitWindowMs = opts.rateLimit.windowMs;
        }
      }
      if (opts.envelopeDedup) {
        if (opts.envelopeDedup.enabled !== undefined) {
          this.envelopeDedupEnabled = opts.envelopeDedup.enabled;
        }
        if (opts.envelopeDedup.maxIds !== undefined && opts.envelopeDedup.maxIds > 0) {
          this.envelopeDedupMaxIds = opts.envelopeDedup.maxIds;
        }
      }
    }
  }

  private isRateLimitedSender(senderPublicKey: string): boolean {
    if (!this.rateLimitEnabled) {
      return false;
    }

    const now = Date.now();
    const window = this.senderWindows.get(senderPublicKey);

    if (this.senderWindows.size >= RelayServer.MAX_SENDER_ENTRIES && !window) {
      this.evictOldestSenderWindow();
    }

    if (!window || (now - window.windowStart) > this.rateLimitWindowMs) {
      this.senderWindows.set(senderPublicKey, { count: 1, windowStart: now });
      return false;
    }

    window.count++;
    return window.count > this.rateLimitMaxMessages;
  }

  private evictOldestSenderWindow(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, window] of this.senderWindows.entries()) {
      if (window.windowStart < oldestTime) {
        oldestTime = window.windowStart;
        oldestKey = key;
      }
    }

    if (oldestKey !== null) {
      this.senderWindows.delete(oldestKey);
    }
  }

  private isDuplicateEnvelopeId(envelopeId: string): boolean {
    if (!this.envelopeDedupEnabled) {
      return false;
    }

    if (this.processedEnvelopeIds.has(envelopeId)) {
      return true;
    }

    this.processedEnvelopeIds.add(envelopeId);
    if (this.processedEnvelopeIds.size > this.envelopeDedupMaxIds) {
      const oldest = this.processedEnvelopeIds.values().next().value;
      if (oldest !== undefined) {
        this.processedEnvelopeIds.delete(oldest);
      }
    }

    return false;
  }

  /**
   * Start the relay server
   * @param port - Port to listen on
   * @param host - Optional host (default: all interfaces)
   */
  start(port: number, host?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port, host: host ?? '0.0.0.0' });
        let resolved = false;

        this.wss.on('error', (error) => {
          this.emit('error', error);
          if (!resolved) {
            resolved = true;
            reject(error);
          }
        });

        this.wss.on('listening', () => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
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
   * Stop the relay server
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }

      // Close all agent connections (all sessions)
      for (const sessionMap of this.sessions.values()) {
        for (const agent of sessionMap.values()) {
          agent.socket.close();
        }
      }
      this.sessions.clear();

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
   * Get one connected agent per public key (first session). For backward compatibility.
   */
  getAgents(): Map<string, ConnectedAgent> {
    const out = new Map<string, ConnectedAgent>();
    for (const [key, sessionMap] of this.sessions) {
      const first = sessionMap.values().next().value;
      if (first) out.set(key, first);
    }
    return out;
  }

  /**
   * Handle incoming connection
   */
  private handleConnection(socket: WebSocket): void {
    let agentPublicKey: string | null = null;
    let sessionId: string | null = null;

    socket.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString());

        // Handle registration
        if (msg.type === 'register' && !agentPublicKey) {
          if (!msg.publicKey || typeof msg.publicKey !== 'string') {
            this.sendError(socket, 'Invalid registration: missing or invalid publicKey');
            socket.close();
            return;
          }

          const publicKey = msg.publicKey;
          agentPublicKey = publicKey;
          sessionId = crypto.randomUUID();

          // Allow multiple sessions per publicKey; only enforce max unique peers
          if (!this.sessions.has(publicKey) && this.sessions.size >= this.maxPeers) {
            this.sendError(socket, `Relay is at capacity (max ${this.maxPeers} peers)`);
            socket.close();
            return;
          }

          const agent: ConnectedAgent = {
            publicKey,
            socket,
            lastSeen: Date.now(),
          };

          if (!this.sessions.has(publicKey)) {
            this.sessions.set(publicKey, new Map());
          }
          this.sessions.get(publicKey)!.set(sessionId, agent);
          const isFirstSession = this.sessions.get(publicKey)!.size === 1;

          this.emit('agent-registered', publicKey);

          // Build peers list: one entry per connected publicKey + storage peers
          const peers: Array<{ publicKey: string }> = [];
          for (const [key] of this.sessions) {
            if (key === publicKey) continue;
            peers.push({ publicKey: key });
          }
          for (const storagePeer of this.storagePeers) {
            if (storagePeer !== publicKey && !this.sessions.has(storagePeer)) {
              peers.push({ publicKey: storagePeer });
            }
          }

          socket.send(JSON.stringify({
            type: 'registered',
            publicKey,
            sessionId,
            peers,
          }));

          // Notify other agents only when this is the first session for this peer
          if (isFirstSession) {
            this.broadcastPeerEvent('peer_online', publicKey);
          }

          // Deliver any stored messages for this peer
          if (this.store && this.storagePeers.includes(publicKey)) {
            const queued = this.store.load(publicKey);
            for (const stored of queued) {
              socket.send(JSON.stringify({
                type: 'message',
                from: stored.from,
                envelope: stored.envelope,
              }));
            }
            this.store.clear(publicKey);
          }
          return;
        }

        // Require registration before processing messages
        if (!agentPublicKey) {
          this.sendError(socket, 'Not registered: send registration message first');
          socket.close();
          return;
        }

        // Handle message relay
        if (msg.type === 'message') {
          if (!msg.to || typeof msg.to !== 'string') {
            this.sendError(socket, 'Invalid message: missing or invalid "to" field');
            return;
          }

          if (!msg.envelope || typeof msg.envelope !== 'object') {
            this.sendError(socket, 'Invalid message: missing or invalid "envelope" field');
            return;
          }

          const envelope = msg.envelope as Envelope;

          // Verify envelope signature
          const verification = verifyEnvelope(envelope);
          if (!verification.valid) {
            this.sendError(socket, `Invalid envelope: ${verification.reason || 'verification failed'}`);
            return;
          }

          // Verify sender matches registered agent
          const envelopeFrom = envelope.from;
          if (envelopeFrom !== agentPublicKey) {
            this.sendError(socket, 'Envelope sender does not match registered public key');
            return;
          }

          // Strict p2p routing: envelope.to must include the relay transport recipient.
          if (!Array.isArray(envelope.to) || envelope.to.length === 0 || !envelope.to.includes(msg.to)) {
            this.sendError(socket, 'Envelope recipients do not include requested relay recipient');
            return;
          }

          if (this.isRateLimitedSender(agentPublicKey)) {
            return;
          }

          if (this.isDuplicateEnvelopeId(envelope.id)) {
            return;
          }

          // Update lastSeen for any session of sender
          const senderSessionMap = this.sessions.get(agentPublicKey);
          if (senderSessionMap) {
            for (const a of senderSessionMap.values()) {
              a.lastSeen = Date.now();
            }
          }

          // Handle peer_list_request directed at relay
          if (envelope.type === 'peer_list_request' && this.identity && msg.to === this.identity.publicKey) {
            this.handlePeerListRequest(envelope as Envelope<PeerListRequestPayload>, socket, agentPublicKey);
            return;
          }

          // Find all recipient sessions
          const recipientSessionMap = this.sessions.get(msg.to);
          const openRecipients = recipientSessionMap
            ? Array.from(recipientSessionMap.values()).filter(a => a.socket.readyState === WebSocket.OPEN)
            : [];
          if (openRecipients.length === 0) {
            // If recipient is a storage peer, queue the message
            if (this.store && this.storagePeers.includes(msg.to)) {
              this.store.save(msg.to, {
                from: agentPublicKey,
                envelope,
              });
              this.emit('message-relayed', agentPublicKey, msg.to, envelope);
            } else {
              this.sendError(socket, `Recipient not connected: ${msg.to}`, 'unknown_recipient');
            }
            return;
          }

          // Forward envelope to all sessions of the recipient
          try {
            const relayMessage = {
              type: 'message',
              from: agentPublicKey,
              envelope,
            };
            const messageStr = JSON.stringify(relayMessage);
            for (const recipient of openRecipients) {
              recipient.socket.send(messageStr);
            }
            this.emit('message-relayed', agentPublicKey, msg.to, envelope);
          } catch (err) {
            this.sendError(socket, 'Failed to relay message');
            this.emit('error', err as Error);
          }
          return;
        }

        // Handle ping
        if (msg.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong' }));
          return;
        }

        // Unknown message type
        this.sendError(socket, `Unknown message type: ${msg.type}`);
      } catch (err) {
        // Invalid JSON or other parsing errors
        this.emit('error', new Error(`Message parsing failed: ${err instanceof Error ? err.message : String(err)}`));
        this.sendError(socket, 'Invalid message format');
      }
    });

    socket.on('close', () => {
      if (agentPublicKey && sessionId) {
        const sessionMap = this.sessions.get(agentPublicKey);
        if (sessionMap) {
          sessionMap.delete(sessionId);
          if (sessionMap.size === 0) {
            this.sessions.delete(agentPublicKey);
            this.emit('agent-disconnected', agentPublicKey);
            this.emit('disconnection', agentPublicKey);
            // Storage-enabled peers are always considered connected; skip peer_offline for them
            if (!this.storagePeers.includes(agentPublicKey)) {
              this.broadcastPeerEvent('peer_offline', agentPublicKey);
            }
          }
        }
      }
    });

    socket.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Send an error message to a client
   */
  private sendError(socket: WebSocket, message: string, code?: string): void {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        const payload: { type: 'error'; message: string; code?: string } = { type: 'error', message };
        if (code) payload.code = code;
        socket.send(JSON.stringify(payload));
      }
    } catch (err) {
      // Log errors when sending error messages, but don't propagate to avoid cascading failures
      this.emit('error', new Error(`Failed to send error message: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  /**
   * Broadcast a peer event to all connected agents (all sessions except the one for publicKey)
   */
  private broadcastPeerEvent(eventType: 'peer_online' | 'peer_offline', publicKey: string): void {
    const message = {
      type: eventType,
      publicKey,
    };
    const messageStr = JSON.stringify(message);

    for (const [key, sessionMap] of this.sessions) {
      if (key === publicKey) continue;
      for (const agent of sessionMap.values()) {
        if (agent.socket.readyState === WebSocket.OPEN) {
          try {
            agent.socket.send(messageStr);
          } catch (err) {
            this.emit('error', new Error(`Failed to send ${eventType} event: ${err instanceof Error ? err.message : String(err)}`));
          }
        }
      }
    }
  }

  /**
   * Handle peer list request from an agent
   */
  private handlePeerListRequest(envelope: Envelope<PeerListRequestPayload>, socket: WebSocket, requesterPublicKey: string): void {
    if (!this.identity) {
      this.sendError(socket, 'Relay does not support peer discovery (no identity configured)');
      return;
    }

    const { filters } = envelope.payload;
    const now = Date.now();

    // One entry per publicKey (first session for lastSeen/metadata)
    const peersList: ConnectedAgent[] = [];
    for (const [key, sessionMap] of this.sessions) {
      if (key === requesterPublicKey) continue;
      const first = sessionMap.values().next().value;
      if (first) peersList.push(first);
    }

    let peers = peersList;

    // Apply filters
    if (filters?.activeWithin) {
      peers = peers.filter(p => (now - p.lastSeen) < filters.activeWithin!);
    }

    if (filters?.limit && filters.limit > 0) {
      peers = peers.slice(0, filters.limit);
    }

    // Build response payload
    const response: PeerListResponsePayload = {
      peers: peers.map(p => ({
        publicKey: p.publicKey,
        metadata: p.metadata ? {
          version: p.metadata?.version,
          capabilities: p.metadata?.capabilities,
        } : undefined,
        lastSeen: p.lastSeen,
      })),
      totalPeers: this.sessions.size - (this.sessions.has(requesterPublicKey) ? 1 : 0),
      relayPublicKey: this.identity.publicKey,
    };

    // Create signed envelope
    const responseEnvelope = createEnvelope(
      'peer_list_response',
      this.identity.publicKey,
      this.identity.privateKey,
      response,
      Date.now(),
      envelope.id, // Reply to the request
      [requesterPublicKey]
    );

    // Send response
    const relayMessage = {
      type: 'message',
      from: this.identity.publicKey,
      envelope: responseEnvelope,
    };

    try {
      socket.send(JSON.stringify(relayMessage));
    } catch (err) {
      this.emit('error', new Error(`Failed to send peer list response: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
