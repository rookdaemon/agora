import type { AgoraIdentity, RelayConfig } from './config';
import { getDefaultConfigPath, loadAgoraConfigAsync } from './config';
import type { Envelope } from './message/envelope';
import type { MessageType } from './message/envelope';
import { RelayClient } from './relay/client';
import type { PeerConfig } from './transport/http';
import { decodeInboundEnvelope, sendToPeer } from './transport/http';
import { sendViaRelay } from './transport/relay';
import { shortKey } from './utils';

/**
 * Service config: identity, peers keyed by name, optional relay.
 */
export interface AgoraServiceConfig {
  identity: AgoraIdentity;
  peers: Map<string, PeerConfig>;
  relay?: RelayConfig;
}

export interface SendMessageOptions {
  peerName: string;
  type: MessageType;
  payload: unknown;
  inReplyTo?: string;
  /** Skip relay, send directly via HTTP only. Fails if peer has no URL or is unreachable. */
  direct?: boolean;
  /** Skip direct HTTP, always use relay even if peer has a URL. */
  relayOnly?: boolean;
}

export interface SendMessageResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface ReplyToEnvelopeOptions {
  /** The public key of the target (from envelope.sender) */
  targetPubkey: string;
  /** Message type for the reply */
  type: MessageType;
  /** Reply payload */
  payload: unknown;
  /** The envelope ID being replied to (required — this IS a reply) */
  inReplyTo: string;
}

export interface DecodeInboundResult {
  ok: boolean;
  envelope?: Envelope;
  reason?: string;
}

/** Handler for relay messages. (envelope, fromPublicKey, fromName?) */
export type RelayMessageHandlerWithName = (envelope: Envelope, from: string, fromName?: string) => void;

/** @deprecated Use RelayMessageHandlerWithName. Kept for backward compatibility. */
export type RelayMessageHandler = (envelope: Envelope) => void;

export interface Logger {
  debug(message: string): void;
}

export interface RelayClientLike {
  connect(): Promise<void>;
  disconnect(): void;
  connected(): boolean;
  send(to: string, envelope: Envelope): Promise<{ ok: boolean; error?: string }>;
  on(event: 'message', handler: (envelope: Envelope, from: string, fromName?: string) => void): void;
  on(event: 'error', handler: (error: Error) => void): void;
}

export interface RelayClientFactory {
  (opts: {
    relayUrl: string;
    publicKey: string;
    privateKey: string;
    name?: string;
    pingInterval: number;
    maxReconnectDelay: number;
  }): RelayClientLike;
}

/**
 * High-level Agora service: send by peer name, decode inbound, relay lifecycle.
 */
export class AgoraService {
  private config: AgoraServiceConfig;
  private relayClient: RelayClientLike | null = null;
  private readonly onRelayMessage: RelayMessageHandlerWithName;
  private logger: Logger | null;
  private relayClientFactory: RelayClientFactory | null;

  /**
   * @param config - Service config (identity, peers, optional relay)
   * @param onRelayMessage - Required callback for relay messages. Ensures no messages are lost between init and connect.
   * @param logger - Optional debug logger
   * @param relayClientFactory - Optional factory for relay client (for testing)
   */
  constructor(
    config: AgoraServiceConfig,
    onRelayMessage: RelayMessageHandlerWithName,
    logger?: Logger,
    relayClientFactory?: RelayClientFactory
  ) {
    this.config = config;
    this.onRelayMessage = onRelayMessage;
    this.logger = logger ?? null;
    this.relayClientFactory = relayClientFactory ?? null;
  }

  /**
   * Send a signed message to a named peer.
   * Tries HTTP webhook first; falls back to relay if HTTP is unavailable.
   */
  async sendMessage(options: SendMessageOptions): Promise<SendMessageResult> {
    const peer = this.config.peers.get(options.peerName);
    if (!peer) {
      return {
        ok: false,
        status: 0,
        error: `Unknown peer: ${options.peerName}`,
      };
    }

    // Try HTTP first (only if peer has a webhook URL and --relay-only not set)
    if (peer.url && !options.relayOnly) {
      const transportConfig = {
        identity: {
          publicKey: this.config.identity.publicKey,
          privateKey: this.config.identity.privateKey,
        },
        peers: new Map<string, PeerConfig>([[peer.publicKey, peer]]),
      };

      const httpResult = await sendToPeer(
        transportConfig,
        peer.publicKey,
        options.type,
        options.payload,
        options.inReplyTo
      );

      if (httpResult.ok) {
        return httpResult;
      }

      this.logger?.debug(`HTTP send to ${options.peerName} failed: ${httpResult.error}`);

      // --direct flag: do not fall back to relay
      if (options.direct) {
        return {
          ok: false,
          status: httpResult.status,
          error: `Direct send to ${options.peerName} failed: ${httpResult.error}`,
        };
      }
    } else if (options.direct && !peer.url) {
      // --direct requested but peer has no URL configured
      return {
        ok: false,
        status: 0,
        error: `Direct send failed: peer '${options.peerName}' has no URL configured`,
      };
    }

    // Fall back to relay
    if (this.relayClient?.connected() && this.config.relay) {
      const relayResult = await sendViaRelay(
        {
          identity: this.config.identity,
          relayUrl: this.config.relay.url,
          relayClient: this.relayClient,
        },
        peer.publicKey,
        options.type,
        options.payload,
        options.inReplyTo
      );

      return {
        ok: relayResult.ok,
        status: 0,
        error: relayResult.error,
      };
    }

    // Both failed
    return {
      ok: false,
      status: 0,
      error: peer.url
        ? `HTTP send failed and relay not available for peer: ${options.peerName}`
        : `No webhook URL and relay not available for peer: ${options.peerName}`,
    };
  }

  /**
   * Reply to an envelope from any sender via relay.
   * Unlike sendMessage(), this does NOT require the target to be a configured peer.
   * Uses the target's public key directly — relay-only (no HTTP, since unknown peers have no URL).
   */
  async replyToEnvelope(options: ReplyToEnvelopeOptions): Promise<SendMessageResult> {
    if (!this.relayClient?.connected() || !this.config.relay) {
      return {
        ok: false,
        status: 0,
        error: 'Relay not connected — cannot reply to envelope without relay',
      };
    }

    this.logger?.debug(
      `Replying to envelope via relay: target=${shortKey(options.targetPubkey)} type=${options.type} inReplyTo=${options.inReplyTo}`
    );

    const relayResult = await sendViaRelay(
      {
        identity: this.config.identity,
        relayUrl: this.config.relay.url,
        relayClient: this.relayClient,
      },
      options.targetPubkey,
      options.type,
      options.payload,
      options.inReplyTo
    );

    return {
      ok: relayResult.ok,
      status: 0,
      error: relayResult.error,
    };
  }

  /**
   * Decode and verify an inbound envelope from a webhook message.
   */
  async decodeInbound(message: string): Promise<DecodeInboundResult> {
    const peersByPubKey = new Map<string, PeerConfig>();
    for (const peer of this.config.peers.values()) {
      peersByPubKey.set(peer.publicKey, peer);
    }
    const result = decodeInboundEnvelope(message, peersByPubKey);
    if (result.ok) {
      return { ok: true, envelope: result.envelope };
    }
    return { ok: false, reason: result.reason };
  }

  getPeers(): string[] {
    return Array.from(this.config.peers.keys());
  }

  getPeerConfig(name: string): PeerConfig | undefined {
    return this.config.peers.get(name);
  }

  /**
   * Connect to the relay server.
   */
  async connectRelay(url: string): Promise<void> {
    if (this.relayClient) {
      return;
    }

    const maxReconnectDelay = this.config.relay?.reconnectMaxMs ?? 300000;
    let name = this.config.identity.name ?? this.config.relay?.name;
    // Never use the short key (id) as the relay display name; treat it as no name
    if (name && name === shortKey(this.config.identity.publicKey)) {
      name = undefined;
    }
    const opts = {
      relayUrl: url,
      publicKey: this.config.identity.publicKey,
      privateKey: this.config.identity.privateKey,
      name,
      pingInterval: 30000,
      maxReconnectDelay,
    };

    if (this.relayClientFactory) {
      this.relayClient = this.relayClientFactory(opts);
    } else {
      this.relayClient = new RelayClient(opts);
    }

    this.relayClient.on('error', (error: Error) => {
      this.logger?.debug(`Agora relay error: ${error.message}`);
    });

    this.relayClient.on('message', (envelope: Envelope, from: string, fromName?: string) => {
      this.onRelayMessage(envelope, from, fromName);
    });

    try {
      await this.relayClient.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.debug(`Agora relay connect failed (${url}): ${message}`);
      this.relayClient = null;
    }
  }

  async disconnectRelay(): Promise<void> {
    if (this.relayClient) {
      this.relayClient.disconnect();
      this.relayClient = null;
    }
  }

  isRelayConnected(): boolean {
    return this.relayClient?.connected() ?? false;
  }

  /**
   * Load Agora configuration and return service config (peers as Map).
   */
  static async loadConfig(path?: string): Promise<AgoraServiceConfig> {
    const configPath = path ?? getDefaultConfigPath();
    const loaded = await loadAgoraConfigAsync(configPath);

    const peers = new Map<string, PeerConfig>();
    for (const [name, p] of Object.entries(loaded.peers)) {
      peers.set(name, {
        publicKey: p.publicKey,
        url: p.url,
        token: p.token,
      } satisfies PeerConfig);
    }

    return {
      identity: loaded.identity,
      peers,
      relay: loaded.relay,
    };
  }
}
