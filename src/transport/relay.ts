import WebSocket from 'ws';
import { createEnvelope, type Envelope, type MessageType } from '../message/envelope';

/** Minimal interface for a connected relay client (avoids importing full RelayClient) */
export interface RelayClientSender {
  connected(): boolean;
  send(to: string, envelope: Envelope): Promise<{ ok: boolean; error?: string }>;
}

export interface RelayTransportConfig {
  /** This agent's keypair */
  identity: { publicKey: string; privateKey: string };
  /** Relay server WebSocket URL (e.g., wss://agora-relay.lbsa71.net) */
  relayUrl: string;
  /** Optional persistent relay client (if provided, will use it instead of connect-per-message) */
  relayClient?: RelayClientSender;
}

/**
 * Send a signed envelope to a peer via relay server.
 * If a persistent relayClient is provided in the config, uses that.
 * Otherwise, connects to relay, registers, sends message, and disconnects.
 */
export async function sendViaRelay(
  config: RelayTransportConfig,
  peerPublicKey: string,
  type: MessageType,
  payload: unknown,
  inReplyTo?: string
): Promise<{ ok: boolean; error?: string }> {
  // If a persistent relay client is available, use it
  if (config.relayClient && config.relayClient.connected()) {
    const envelope = createEnvelope(
      type,
      config.identity.publicKey,
      config.identity.privateKey,
      payload,
      Date.now(),
      inReplyTo
    );
    return config.relayClient.send(peerPublicKey, envelope);
  }

  // Otherwise, fall back to connect-per-message
  return new Promise((resolve) => {
    const ws = new WebSocket(config.relayUrl);
    let registered = false;
    let messageSent = false;
    let resolved = false;

    // Helper to resolve once
    const resolveOnce = (result: { ok: boolean; error?: string }): void => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve(result);
      }
    };

    // Set timeout for the entire operation
    const timeout = setTimeout(() => {
      if (!messageSent) {
        ws.close();
        resolveOnce({ ok: false, error: 'Relay connection timeout' });
      }
    }, 10000); // 10 second timeout

    ws.on('open', () => {
      // Send register message
      const registerMsg = {
        type: 'register',
        publicKey: config.identity.publicKey,
      };
      ws.send(JSON.stringify(registerMsg));
    });

    ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg = JSON.parse(data.toString());

        if (msg.type === 'registered' && !registered) {
          registered = true;

          // Create and sign the envelope
          const envelope: Envelope = createEnvelope(
            type,
            config.identity.publicKey,
            config.identity.privateKey,
            payload,
            Date.now(),
            inReplyTo
          );

          // Send message via relay
          const relayMsg = {
            type: 'message',
            to: peerPublicKey,
            envelope,
          };
          ws.send(JSON.stringify(relayMsg));
          messageSent = true;

          // Close connection after sending
          setTimeout(() => {
            ws.close();
            resolveOnce({ ok: true });
          }, 100); // Small delay to ensure message is sent
        } else if (msg.type === 'error') {
          ws.close();
          resolveOnce({ ok: false, error: msg.message || 'Relay server error' });
        }
      } catch (err) {
        ws.close();
        resolveOnce({ ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    });

    ws.on('error', (err) => {
      ws.close();
      resolveOnce({ ok: false, error: err.message });
    });

    ws.on('close', () => {
      if (!messageSent) {
        resolveOnce({ ok: false, error: 'Connection closed before message sent' });
      }
    });
  });
}
