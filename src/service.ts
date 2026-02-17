import type { AgoraIdentity, RelayConfig } from './config.js';
import { getDefaultConfigPath, loadAgoraConfigAsync } from './config.js';
import type { Envelope } from './message/envelope.js';
import type { MessageType } from './message/envelope.js';
import { RelayClient } from './relay/client.js';
import type { PeerConfig } from './transport/http.js';
import { decodeInboundEnvelope, sendToPeer } from './transport/http.js';
import { sendViaRelay } from './transport/relay.js';
import { shortKey } from './utils.js';

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
}

export interface SendMessageResult {
  ok: boolean;
  status: number;
  error?: string;
}

export interface DecodeInboundResult {
  ok: boolean;
  envelope?: Envelope;
  reason?: string;
}

export type RelayMessageHandler = (envelope: Envelope) => void;
export type RelayMessageHandlerWithName = (envelope: Envelope, from: string, fromName?: string) => void;

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
  private relayMessageHandler: RelayMessageHandler | null = null;
  private relayMessageHandlerWithName: RelayMessageHandlerWithName | null = null;
  private logger: Logger | null;
  private relayClientFactory: RelayClientFactory | null;

  constructor(
    config: AgoraServiceConfig,
    logger?: Logger,
    relayClientFactory?: RelayClientFactory
  ) {
    this.config = config;
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

    // Try HTTP first (only if peer has a webhook URL)
    if (peer.url) {
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
      if (this.relayMessageHandlerWithName) {
        this.relayMessageHandlerWithName(envelope, from, fromName);
      } else if (this.relayMessageHandler) {
        this.relayMessageHandler(envelope);
      }
    });

    try {
      await this.relayClient.connect();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.debug(`Agora relay connect failed (${url}): ${message}`);
      this.relayClient = null;
    }
  }

  setRelayMessageHandler(handler: RelayMessageHandler): void {
    this.relayMessageHandler = handler;
    this.relayMessageHandlerWithName = null;
  }

  setRelayMessageHandlerWithName(handler: RelayMessageHandlerWithName): void {
    this.relayMessageHandlerWithName = handler;
    this.relayMessageHandler = null;
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
