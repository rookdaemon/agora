/**
 * Base message structure that all messages must include
 */
export interface BaseMessage {
  id: string;          // UUID v4
  type: string;        // Message type identifier
  from: string;        // Sender's public key (hex)
  timestamp: string;   // ISO 8601 timestamp
  signature: string;   // ed25519 signature (hex)
}

/**
 * Agent announces its identity and capabilities
 */
export interface AnnounceMessage extends BaseMessage {
  type: 'announce';
  payload: {
    capabilities: string[];  // List of capabilities the agent offers
    metadata?: Record<string, unknown>;  // Optional metadata
  };
}

/**
 * Agent queries for other agents or capabilities
 */
export interface QueryMessage extends BaseMessage {
  type: 'query';
  payload: {
    query: string;  // What the agent is searching for
    filters?: Record<string, unknown>;  // Optional query filters
  };
}

/**
 * Response to a query
 */
export interface ResponseMessage extends BaseMessage {
  type: 'response';
  payload: {
    queryId: string;  // ID of the query being responded to
    results: unknown[];  // Query results
    metadata?: Record<string, unknown>;  // Optional metadata
  };
}

/**
 * Keepalive ping message
 */
export interface PingMessage extends BaseMessage {
  type: 'ping';
  payload: {
    nonce: string;  // Random nonce for matching with pong
  };
}

/**
 * Keepalive pong response
 */
export interface PongMessage extends BaseMessage {
  type: 'pong';
  payload: {
    nonce: string;  // Nonce from the ping message
  };
}

/**
 * Union type of all message types
 */
export type Message = 
  | AnnounceMessage 
  | QueryMessage 
  | ResponseMessage 
  | PingMessage 
  | PongMessage;
