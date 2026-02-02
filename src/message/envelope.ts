import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair.js';

/**
 * Message types on the Agora network.
 * Every piece of data flowing between agents is wrapped in an envelope.
 */
export type MessageType =
  | 'announce'      // Agent publishes capabilities/state
  | 'discover'      // Agent requests peer discovery
  | 'request'       // Agent requests a service
  | 'response'      // Agent responds to a request
  | 'publish'       // Agent publishes knowledge/state
  | 'subscribe'     // Agent subscribes to a topic/domain
  | 'verify'        // Agent verifies another agent's claim
  | 'ack'           // Acknowledgement
  | 'error'         // Error response
  | 'paper_discovery'; // Agent publishes a discovered academic paper

/**
 * The signed envelope that wraps every message on the network.
 * Content-addressed: the ID is the hash of the canonical payload.
 * Signed: every envelope carries a signature from the sender's private key.
 */
export interface Envelope<T = unknown> {
  /** Content-addressed ID: SHA-256 hash of canonical payload */
  id: string;
  /** Message type */
  type: MessageType;
  /** Sender's public key (hex-encoded ed25519) */
  sender: string;
  /** Unix timestamp (ms) when the message was created */
  timestamp: number;
  /** Optional: ID of the message this is responding to */
  inReplyTo?: string;
  /** The actual payload */
  payload: T;
  /** ed25519 signature over the canonical form (hex-encoded) */
  signature: string;
}

/**
 * Deterministic JSON serialization with recursively sorted keys.
 */
function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Canonical form of an envelope for signing/hashing.
 * Deterministic JSON serialization: recursively sorted keys, no whitespace.
 */
export function canonicalize(type: MessageType, sender: string, timestamp: number, payload: unknown, inReplyTo?: string): string {
  const obj: Record<string, unknown> = { payload, sender, timestamp, type };
  if (inReplyTo !== undefined) {
    obj.inReplyTo = inReplyTo;
  }
  return stableStringify(obj);
}

/**
 * Compute the content-addressed ID for a message.
 */
export function computeId(canonical: string): string {
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Create a signed envelope.
 * @param type - Message type
 * @param sender - Sender's public key (hex)
 * @param privateKey - Sender's private key (hex) for signing
 * @param payload - The message payload
 * @param inReplyTo - Optional ID of the message being replied to
 * @returns A signed Envelope
 */
export function createEnvelope<T>(
  type: MessageType,
  sender: string,
  privateKey: string,
  payload: T,
  inReplyTo?: string,
): Envelope<T> {
  const timestamp = Date.now();
  const canonical = canonicalize(type, sender, timestamp, payload, inReplyTo);
  const id = computeId(canonical);
  const signature = signMessage(canonical, privateKey);

  return {
    id,
    type,
    sender,
    timestamp,
    ...(inReplyTo !== undefined ? { inReplyTo } : {}),
    payload,
    signature,
  };
}

/**
 * Verify an envelope's integrity and authenticity.
 * Checks:
 * 1. Canonical form matches the ID (content-addressing)
 * 2. Signature is valid for the sender's public key
 * 
 * @returns Object with `valid` boolean and optional `reason` for failure
 */
export function verifyEnvelope(envelope: Envelope): { valid: boolean; reason?: string } {
  const { id, type, sender, timestamp, payload, signature, inReplyTo } = envelope;

  // Reconstruct canonical form
  const canonical = canonicalize(type, sender, timestamp, payload, inReplyTo);

  // Check content-addressed ID
  const expectedId = computeId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }

  // Check signature
  const sigValid = verifySignature(canonical, signature, sender);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }

  return { valid: true };
}
