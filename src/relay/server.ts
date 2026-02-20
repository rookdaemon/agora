import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyEnvelope, createEnvelope, type Envelope } from '../message/envelope.js';
import type { PeerListRequestPayload, PeerListResponsePayload } from '../message/types/peer-discovery.js';

/**
 * Represents a connected agent in the relay
 */
interface ConnectedAgent {
  /** Agent's public key */
  publicKey: string;
  /** Optional agent name */
  name?: string;
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
 * Delivery handler for REST agents: called when a message is routed to them.
 */
export type RestAgentDeliveryHandler = (envelope: Envelope, from: string, fromName?: string) => void;

/**
 * Events emitted by RelayServer
 */
export interface RelayServerEvents {
  'agent-registered': (publicKey: string) => void;
  'agent-disconnected': (publicKey: string) => void;
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
export class RelayServer extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private agents = new Map<string, ConnectedAgent>();
  private identity?: { publicKey: string; privateKey: string };
  private restAgents = new Map<string, RestAgentDeliveryHandler>();

  constructor(identity?: { publicKey: string; privateKey: string }) {
    super();
    this.identity = identity;
  }

  /**
   * Start the relay server
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ port });
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

      // Close all agent connections
      for (const agent of this.agents.values()) {
        agent.socket.close();
      }
      this.agents.clear();

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
   * Get all connected agents
   */
  getAgents(): Map<string, ConnectedAgent> {
    return new Map(this.agents);
  }

  /**
   * Register a REST agent to receive messages routed to its public key.
   * Call unregisterRestAgent when the session ends.
   */
  registerRestAgent(publicKey: string, handler: RestAgentDeliveryHandler): void {
    this.restAgents.set(publicKey, handler);
  }

  /**
   * Unregister a REST agent (e.g. on disconnect or session expiry).
   */
  unregisterRestAgent(publicKey: string): void {
    this.restAgents.delete(publicKey);
  }

  /**
   * Route a pre-signed envelope from a REST agent to a recipient.
   * Verifies the envelope and delivers it to a WebSocket or REST agent.
   * Returns ok:false if the recipient is not connected.
   */
  routeEnvelope(from: string, to: string, envelope: Envelope, fromName?: string): { ok: boolean; error?: string } {
    // Verify envelope integrity
    const verification = verifyEnvelope(envelope);
    if (!verification.valid) {
      return { ok: false, error: `Invalid envelope: ${verification.reason || 'verification failed'}` };
    }

    if (envelope.sender !== from) {
      return { ok: false, error: 'Envelope sender does not match from field' };
    }

    // Try REST agent first
    const restHandler = this.restAgents.get(to);
    if (restHandler) {
      const senderAgent = this.agents.get(from);
      restHandler(envelope, from, fromName ?? senderAgent?.name);
      this.emit('message-relayed', from, to, envelope);
      return { ok: true };
    }

    // Try WebSocket agent
    const recipient = this.agents.get(to);
    if (!recipient || recipient.socket.readyState !== WebSocket.OPEN) {
      return { ok: false, error: 'Recipient not connected' };
    }

    const relayMessage = {
      type: 'message',
      from,
      name: fromName,
      envelope,
    };
    try {
      recipient.socket.send(JSON.stringify(relayMessage));
      this.emit('message-relayed', from, to, envelope);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /**
   * Handle incoming connection
   */
  private handleConnection(socket: WebSocket): void {
    let agentPublicKey: string | null = null;

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
          const name = msg.name;
          agentPublicKey = publicKey;
          const agent: ConnectedAgent = {
            publicKey,
            name,
            socket,
            lastSeen: Date.now(),
          };

          this.agents.set(publicKey, agent);
          this.emit('agent-registered', publicKey);

          // Send registration confirmation with list of online peers
          const peers = Array.from(this.agents.values())
            .filter(a => a.publicKey !== publicKey)
            .map(a => ({ publicKey: a.publicKey, name: a.name }));
          
          socket.send(JSON.stringify({ 
            type: 'registered',
            publicKey,
            peers,
          }));

          // Notify other agents that this agent is now online
          this.broadcastPeerEvent('peer_online', publicKey, name);
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
          if (envelope.sender !== agentPublicKey) {
            this.sendError(socket, 'Envelope sender does not match registered public key');
            return;
          }

          // Update lastSeen timestamp
          const senderAgent = this.agents.get(agentPublicKey);
          if (senderAgent) {
            senderAgent.lastSeen = Date.now();
          }

          // Handle peer_list_request directed at relay
          if (envelope.type === 'peer_list_request' && this.identity && msg.to === this.identity.publicKey) {
            this.handlePeerListRequest(envelope as Envelope<PeerListRequestPayload>, socket, agentPublicKey);
            return;
          }

          // Find recipient (WebSocket or REST)
          const restHandler = this.restAgents.get(msg.to);
          if (restHandler) {
            const senderAgentRef = this.agents.get(agentPublicKey);
            restHandler(envelope, agentPublicKey, senderAgentRef?.name);
            this.emit('message-relayed', agentPublicKey, msg.to, envelope);
            return;
          }

          const recipient = this.agents.get(msg.to);
          if (!recipient || recipient.socket.readyState !== WebSocket.OPEN) {
            this.sendError(socket, 'Recipient not connected');
            return;
          }

          // Forward envelope to recipient wrapped in relay message format
          try {
            const senderAgent = this.agents.get(agentPublicKey);
            const relayMessage = {
              type: 'message',
              from: agentPublicKey,
              name: senderAgent?.name,
              envelope,
            };
            recipient.socket.send(JSON.stringify(relayMessage));
            this.emit('message-relayed', agentPublicKey, msg.to, envelope);
          } catch (err) {
            this.sendError(socket, 'Failed to relay message');
            this.emit('error', err as Error);
          }
          return;
        }

        // Handle broadcast: same validation as message, then forward to all other agents
        if (msg.type === 'broadcast') {
          if (!msg.envelope || typeof msg.envelope !== 'object') {
            this.sendError(socket, 'Invalid broadcast: missing or invalid "envelope" field');
            return;
          }

          const envelope = msg.envelope as Envelope;

          const verification = verifyEnvelope(envelope);
          if (!verification.valid) {
            this.sendError(socket, `Invalid envelope: ${verification.reason || 'verification failed'}`);
            return;
          }

          if (envelope.sender !== agentPublicKey) {
            this.sendError(socket, 'Envelope sender does not match registered public key');
            return;
          }

          // Update lastSeen timestamp
          const senderAgentBroadcast = this.agents.get(agentPublicKey);
          if (senderAgentBroadcast) {
            senderAgentBroadcast.lastSeen = Date.now();
          }

          const senderAgent = this.agents.get(agentPublicKey);
          const relayMessage = {
            type: 'message' as const,
            from: agentPublicKey,
            name: senderAgent?.name,
            envelope,
          };
          const messageStr = JSON.stringify(relayMessage);

          for (const agent of this.agents.values()) {
            if (agent.publicKey !== agentPublicKey && agent.socket.readyState === WebSocket.OPEN) {
              try {
                agent.socket.send(messageStr);
              } catch (err) {
                this.emit('error', err as Error);
              }
            }
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
      if (agentPublicKey) {
        const agent = this.agents.get(agentPublicKey);
        const agentName = agent?.name;
        this.agents.delete(agentPublicKey);
        this.emit('agent-disconnected', agentPublicKey);
        
        // Notify other agents that this agent went offline
        this.broadcastPeerEvent('peer_offline', agentPublicKey, agentName);
      }
    });

    socket.on('error', (error) => {
      this.emit('error', error);
    });
  }

  /**
   * Send an error message to a client
   */
  private sendError(socket: WebSocket, message: string): void {
    try {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'error', message }));
      }
    } catch (err) {
      // Log errors when sending error messages, but don't propagate to avoid cascading failures
      this.emit('error', new Error(`Failed to send error message: ${err instanceof Error ? err.message : String(err)}`));
    }
  }

  /**
   * Broadcast a peer event to all connected agents
   */
  private broadcastPeerEvent(eventType: 'peer_online' | 'peer_offline', publicKey: string, name?: string): void {
    const message = {
      type: eventType,
      publicKey,
      name,
    };
    const messageStr = JSON.stringify(message);

    for (const agent of this.agents.values()) {
      // Don't send the event to the agent it's about
      if (agent.publicKey !== publicKey && agent.socket.readyState === WebSocket.OPEN) {
        try {
          agent.socket.send(messageStr);
        } catch (err) {
          this.emit('error', new Error(`Failed to send ${eventType} event: ${err instanceof Error ? err.message : String(err)}`));
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

    let peers = Array.from(this.agents.values());

    // Filter out requester first
    peers = peers.filter(p => p.publicKey !== requesterPublicKey);

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
        metadata: p.name || p.metadata ? {
          name: p.name,
          version: p.metadata?.version,
          capabilities: p.metadata?.capabilities,
          } : undefined,
          lastSeen: p.lastSeen,
        })),
      totalPeers: this.agents.size - 1, // Exclude requester from count
      relayPublicKey: this.identity.publicKey,
    };

    // Create signed envelope
    const responseEnvelope = createEnvelope(
      'peer_list_response',
      this.identity.publicKey,
      this.identity.privateKey,
      response,
      Date.now(),
      envelope.id // Reply to the request
    );

    // Send response
    const relayMessage = {
      type: 'message',
      from: this.identity.publicKey,
      name: 'relay',
      envelope: responseEnvelope,
    };

    try {
      socket.send(JSON.stringify(relayMessage));
    } catch (err) {
      this.emit('error', new Error(`Failed to send peer list response: ${err instanceof Error ? err.message : String(err)}`));
    }
  }
}
