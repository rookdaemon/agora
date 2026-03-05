import { createHash } from 'node:crypto';
import { signMessage, verifySignature } from '../identity/keypair';

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
  | 'paper_discovery'         // Agent publishes a discovered academic paper
  | 'peer_list_request'       // Request peer list from relay
  | 'peer_list_response'      // Relay responds with connected peers
  | 'peer_referral'           // Agent recommends another agent
  | 'capability_announce'     // Agent publishes capabilities to network
  | 'capability_query'        // Agent queries for capabilities
  | 'capability_response'     // Response with matching peers
  | 'commit'                  // Agent commits to a prediction (commit-reveal pattern)
  | 'reveal'                  // Agent reveals prediction and outcome
  | 'verification'            // Agent verifies another agent's output
  | 'revocation'              // Agent revokes a prior verification
  | 'reputation_query'        // Agent queries for reputation data
  | 'reputation_response';    // Response to reputation query

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
  /** Sender peer ID (full ID) */
  from: string;
  /** Recipient peer IDs (full IDs) */
  to: string[];
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
export function canonicalize(
  type: MessageType,
  from: string,
  to: string[],
  timestamp: number,
  payload: unknown,
  inReplyTo?: string,
): string {
  const obj: Record<string, unknown> = { from, payload, timestamp, to, type };
  if (inReplyTo !== undefined) {
    obj.inReplyTo = inReplyTo;
  }
  return stableStringify(obj);
}

function normalizeRecipients(from: string, to?: string | string[]): string[] {
  const list = Array.isArray(to) ? to : (typeof to === 'string' ? [to] : [from]);
  const unique = new Set<string>();
  for (const recipient of list) {
    if (typeof recipient === 'string' && recipient.trim().length > 0) {
      unique.add(recipient);
    }
  }
  if (unique.size === 0) {
    unique.add(from);
  }
  return Array.from(unique);
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
 * @param from - Sender's public key (hex)
 * @param privateKey - Sender's private key (hex) for signing
 * @param payload - The message payload
 * @param timestamp - Timestamp for the envelope (ms), defaults to Date.now()
 * @param inReplyTo - Optional ID of the message being replied to
 * @param to - Recipient peer ID(s)
 * @returns A signed Envelope
 */
export function createEnvelope<T>(
  type: MessageType,
  from: string,
  privateKey: string,
  payload: T,
  timestamp: number = Date.now(),
  inReplyTo?: string,
  to?: string | string[],
): Envelope<T> {
  const recipients = normalizeRecipients(from, to);
  const canonical = canonicalize(type, from, recipients, timestamp, payload, inReplyTo);
  const id = computeId(canonical);
  const signature = signMessage(canonical, privateKey);

  return {
    id,
    type,
    from,
    to: recipients,
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
  const { id, type, from, to, timestamp, payload, signature, inReplyTo } = envelope;
  if (!from || !Array.isArray(to) || to.length === 0) {
    return { valid: false, reason: 'invalid_routing_fields' };
  }

  // Reconstruct canonical form.
  const canonical = canonicalize(type, from, to, timestamp, payload, inReplyTo);

  // Check content-addressed ID
  const expectedId = computeId(canonical);
  if (id !== expectedId) {
    return { valid: false, reason: 'id_mismatch' };
  }

  const sigValid = verifySignature(canonical, signature, from);
  if (!sigValid) {
    return { valid: false, reason: 'signature_invalid' };
  }

  return { valid: true };
}
