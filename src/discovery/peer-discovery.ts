import { EventEmitter } from 'node:events';
import { createEnvelope, verifyEnvelope, type Envelope } from '../message/envelope';
import type { RelayClient } from '../relay/client';
import type { PeerListRequestPayload, PeerListResponsePayload, PeerReferralPayload } from '../message/types/peer-discovery';

/**
 * Configuration for PeerDiscoveryService
 */
export interface PeerDiscoveryConfig {
  /** Agent's public key */
  publicKey: string;
  /** Agent's private key for signing */
  privateKey: string;
  /** RelayClient instance for communication */
  relayClient: RelayClient;
  /** Public key of the relay server (for sending peer list requests) */
  relayPublicKey?: string;
}

/**
 * Events emitted by PeerDiscoveryService
 */
export interface PeerDiscoveryEvents {
  /** Emitted when peers are discovered */
  'peers-discovered': (peers: PeerListResponsePayload['peers']) => void;
  /** Emitted when a peer referral is received */
  'peer-referral': (referral: PeerReferralPayload, from: string) => void;
  /** Emitted on errors */
  'error': (error: Error) => void;
}

/**
 * Service for discovering peers on the Agora network
 */
export class PeerDiscoveryService extends EventEmitter {
  private config: PeerDiscoveryConfig;

  constructor(config: PeerDiscoveryConfig) {
    super();
    this.config = config;

    // Listen for peer list responses and referrals
    this.config.relayClient.on('message', (envelope: Envelope, from: string) => {
      if (envelope.type === 'peer_list_response') {
        this.handlePeerList(envelope as Envelope<PeerListResponsePayload>);
      } else if (envelope.type === 'peer_referral') {
        this.handleReferral(envelope as Envelope<PeerReferralPayload>, from);
      }
    });
  }

  /**
   * Request peer list from relay
   */
  async discoverViaRelay(filters?: PeerListRequestPayload['filters']): Promise<PeerListResponsePayload | null> {
    if (!this.config.relayPublicKey) {
      throw new Error('Relay public key not configured');
    }

    if (!this.config.relayClient.connected()) {
      throw new Error('Not connected to relay');
    }

    const payload: PeerListRequestPayload = filters ? { filters } : {};

    const envelope = createEnvelope(
      'peer_list_request',
      this.config.publicKey,
      this.config.privateKey,
      payload
    );

    // Send request to relay
    const result = await this.config.relayClient.send(this.config.relayPublicKey, envelope);
    if (!result.ok) {
      throw new Error(`Failed to send peer list request: ${result.error}`);
    }

    // Wait for response (with timeout)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error('Peer list request timed out'));
      }, 10000); // 10 second timeout

      const messageHandler = (responseEnvelope: Envelope, from: string): void => {
        if (responseEnvelope.type === 'peer_list_response' && 
            responseEnvelope.inReplyTo === envelope.id &&
            from === this.config.relayPublicKey) {
          cleanup();
          resolve(responseEnvelope.payload as PeerListResponsePayload);
        }
      };

      const cleanup = (): void => {
        clearTimeout(timeout);
        this.config.relayClient.off('message', messageHandler);
      };

      this.config.relayClient.on('message', messageHandler);
    });
  }

  /**
   * Send peer referral to another agent
   */
  async referPeer(
    recipientPublicKey: string,
    referredPublicKey: string,
    metadata?: { name?: string; endpoint?: string; comment?: string; trustScore?: number }
  ): Promise<{ ok: boolean; error?: string }> {
    if (!this.config.relayClient.connected()) {
      return { ok: false, error: 'Not connected to relay' };
    }

    const payload: PeerReferralPayload = {
      publicKey: referredPublicKey,
      endpoint: metadata?.endpoint,
      metadata: metadata?.name ? { name: metadata.name } : undefined,
      comment: metadata?.comment,
      trustScore: metadata?.trustScore,
    };

    const envelope = createEnvelope(
      'peer_referral',
      this.config.publicKey,
      this.config.privateKey,
      payload
    );

    return this.config.relayClient.send(recipientPublicKey, envelope);
  }

  /**
   * Handle incoming peer referral
   */
  private handleReferral(envelope: Envelope<PeerReferralPayload>, from: string): void {
    // Verify envelope
    const verification = verifyEnvelope(envelope);
    if (!verification.valid) {
      this.emit('error', new Error(`Invalid peer referral: ${verification.reason}`));
      return;
    }

    // Emit event for application to handle
    this.emit('peer-referral', envelope.payload, from);
  }

  /**
   * Handle incoming peer list from relay
   */
  private handlePeerList(envelope: Envelope<PeerListResponsePayload>): void {
    // Verify envelope
    const verification = verifyEnvelope(envelope);
    if (!verification.valid) {
      this.emit('error', new Error(`Invalid peer list response: ${verification.reason}`));
      return;
    }

    // Verify sender is the relay
    if (envelope.sender !== this.config.relayPublicKey) {
      this.emit('error', new Error('Peer list response not from configured relay'));
      return;
    }

    // Emit event
    this.emit('peers-discovered', envelope.payload.peers);
  }
}
