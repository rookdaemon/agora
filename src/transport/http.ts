import { createEnvelope, verifyEnvelope, type Envelope, type MessageType } from '../message/envelope';

export interface PeerConfig {
  /** Peer's webhook URL, e.g. http://localhost:18790/hooks (undefined for relay-only peers) */
  url?: string;
  /** Peer's webhook auth token (undefined for relay-only peers) */
  token?: string;
  /** Peer's public key (hex) for verifying responses */
  publicKey: string;
}

export interface TransportConfig {
  /** This agent's keypair */
  identity: { publicKey: string; privateKey: string };
  /** Known peers */
  peers: Map<string, PeerConfig>;
}

/**
 * Send a signed envelope to a peer via HTTP webhook.
 * Creates the envelope, signs it, and POSTs to the peer's /hooks/agent endpoint.
 * Returns the HTTP status code.
 */
export async function sendToPeer(
  config: TransportConfig,
  peerPublicKey: string,
  type: MessageType,
  payload: unknown,
  inReplyTo?: string
): Promise<{ ok: boolean; status: number; error?: string }> {
  // Look up peer config
  const peer = config.peers.get(peerPublicKey);
  if (!peer) {
    return { ok: false, status: 0, error: 'Unknown peer' };
  }

  // Relay-only peer — no webhook URL configured
  if (!peer.url) {
    return { ok: false, status: 0, error: 'No webhook URL configured' };
  }

  // Create and sign the envelope
  const envelope = createEnvelope(
    type,
    config.identity.publicKey,
    config.identity.privateKey,
    payload,
    Date.now(),
    inReplyTo
  );

  // Encode envelope as base64url
  const envelopeJson = JSON.stringify(envelope);
  const envelopeBase64 = Buffer.from(envelopeJson).toString('base64url');

  // Construct webhook payload
  const webhookPayload = {
    message: `[AGORA_ENVELOPE]${envelopeBase64}`,
    name: 'Agora',
    sessionKey: `agora:${envelope.sender.substring(0, 16)}`,
    deliver: false,
  };

  // Send HTTP POST
  try {
    const response = await fetch(`${peer.url}/agent`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${peer.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(webhookPayload),
    });

    return {
      ok: response.ok,
      status: response.status,
      error: response.ok ? undefined : await response.text(),
    };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Decode and verify an inbound Agora envelope from a webhook message.
 * Expects the message to start with [AGORA_ENVELOPE] followed by base64.
 * Returns the verified envelope or an error.
 */
export function decodeInboundEnvelope(
  message: string,
  knownPeers: Map<string, PeerConfig>
): { ok: true; envelope: Envelope } | { ok: false; reason: string } {
  // Check for AGORA_ENVELOPE prefix
  const prefix = '[AGORA_ENVELOPE]';
  if (!message.startsWith(prefix)) {
    return { ok: false, reason: 'not_agora_message' };
  }

  // Extract base64 payload
  const base64Payload = message.substring(prefix.length);
  
  // Check for empty payload
  if (!base64Payload) {
    return { ok: false, reason: 'invalid_base64' };
  }
  
  // Decode base64
  let envelopeJson: string;
  try {
    const decoded = Buffer.from(base64Payload, 'base64url');
    // Check if decoded buffer is empty or contains invalid data
    if (decoded.length === 0) {
      return { ok: false, reason: 'invalid_base64' };
    }
    envelopeJson = decoded.toString('utf-8');
  } catch {
    return { ok: false, reason: 'invalid_base64' };
  }

  // Parse JSON
  let envelope: Envelope;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }

  // Verify envelope integrity
  const verification = verifyEnvelope(envelope);
  if (!verification.valid) {
    return { ok: false, reason: verification.reason || 'verification_failed' };
  }

  // Check if sender is a known peer
  const senderKnown = knownPeers.has(envelope.sender);
  if (!senderKnown) {
    return { ok: false, reason: 'unknown_sender' };
  }

  return { ok: true, envelope };
}
