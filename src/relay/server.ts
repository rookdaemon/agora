import { EventEmitter } from 'node:events';
import { WebSocketServer, WebSocket } from 'ws';
import { verifyEnvelope, type Envelope } from '../message/envelope.js';

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
}

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

          // Find recipient
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
              envelope: envelope,
            };
            recipient.socket.send(JSON.stringify(relayMessage));
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
}
