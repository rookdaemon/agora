import { createHash } from 'node:crypto';
import type { Envelope } from '../message/envelope';

interface SenderWindow {
  count: number;
  windowStart: number;
}

export interface InboundSecurityOptions {
  rateLimitEnabled?: boolean;
  rateLimitMaxMessages?: number;
  rateLimitWindowMs?: number;
  envelopeDedupEnabled?: boolean;
  envelopeDedupMaxIds?: number;
  contentDedupEnabled?: boolean;
  contentDedupWindowMs?: number;
  ignoredPeers?: string[];
}

/**
 * Shared inbound guard for relay-fed consumers.
 *
 * Provides:
 * - static ignore list checks
 * - per-sender rate limiting
 * - envelope ID deduplication
 * - content-window deduplication
 */
export class InboundMessageGuard {
  private readonly senderWindows = new Map<string, SenderWindow>();
  private readonly envelopeIds = new Set<string>();
  private readonly contentDedup = new Map<string, number>();
  private readonly ignoredPeers = new Set<string>();

  private rateLimitEnabled: boolean;
  private rateLimitMaxMessages: number;
  private rateLimitWindowMs: number;
  private envelopeDedupEnabled: boolean;
  private envelopeDedupMaxIds: number;
  private contentDedupEnabled: boolean;
  private contentDedupWindowMs: number;

  private static readonly MAX_SENDER_ENTRIES = 500;
  private static readonly MAX_CONTENT_ENTRIES = 5000;

  constructor(options: InboundSecurityOptions = {}) {
    this.rateLimitEnabled = options.rateLimitEnabled ?? true;
    this.rateLimitMaxMessages = options.rateLimitMaxMessages ?? 10;
    this.rateLimitWindowMs = options.rateLimitWindowMs ?? 60_000;
    this.envelopeDedupEnabled = options.envelopeDedupEnabled ?? true;
    this.envelopeDedupMaxIds = options.envelopeDedupMaxIds ?? 1000;
    this.contentDedupEnabled = options.contentDedupEnabled ?? true;
    this.contentDedupWindowMs = options.contentDedupWindowMs ?? 1_800_000;

    for (const peer of options.ignoredPeers ?? []) {
      const normalized = peer.trim();
      if (normalized) {
        this.ignoredPeers.add(normalized);
      }
    }
  }

  shouldDrop(envelope: Envelope, senderPublicKey: string): { drop: boolean; reason?: string } {
    if (this.ignoredPeers.has(senderPublicKey)) {
      return { drop: true, reason: 'ignored_peer' };
    }

    if (this.isRateLimited(senderPublicKey)) {
      return { drop: true, reason: 'rate_limited' };
    }

    if (this.isDuplicateEnvelopeId(envelope.id)) {
      return { drop: true, reason: 'duplicate_envelope_id' };
    }

    if (this.isDuplicateContent(senderPublicKey, envelope.type, envelope.payload)) {
      return { drop: true, reason: 'duplicate_content' };
    }

    return { drop: false };
  }

  ignorePeer(publicKey: string): boolean {
    const normalized = publicKey.trim();
    if (!normalized) {
      return false;
    }
    const existed = this.ignoredPeers.has(normalized);
    this.ignoredPeers.add(normalized);
    return !existed;
  }

  unignorePeer(publicKey: string): boolean {
    return this.ignoredPeers.delete(publicKey.trim());
  }

  listIgnoredPeers(): string[] {
    return Array.from(this.ignoredPeers.values()).sort();
  }

  private isRateLimited(senderPublicKey: string): boolean {
    if (!this.rateLimitEnabled) {
      return false;
    }

    const now = Date.now();
    const current = this.senderWindows.get(senderPublicKey);

    if (!current && this.senderWindows.size >= InboundMessageGuard.MAX_SENDER_ENTRIES) {
      this.evictOldestSender();
    }

    if (!current || now - current.windowStart > this.rateLimitWindowMs) {
      this.senderWindows.set(senderPublicKey, { count: 1, windowStart: now });
      return false;
    }

    current.count += 1;
    return current.count > this.rateLimitMaxMessages;
  }

  private evictOldestSender(): void {
    let oldestKey: string | null = null;
    let oldestTime = Number.POSITIVE_INFINITY;

    for (const [key, value] of this.senderWindows.entries()) {
      if (value.windowStart < oldestTime) {
        oldestTime = value.windowStart;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.senderWindows.delete(oldestKey);
    }
  }

  private isDuplicateEnvelopeId(envelopeId: string): boolean {
    if (!this.envelopeDedupEnabled) {
      return false;
    }

    if (this.envelopeIds.has(envelopeId)) {
      return true;
    }

    this.envelopeIds.add(envelopeId);
    if (this.envelopeIds.size > this.envelopeDedupMaxIds) {
      const oldest = this.envelopeIds.values().next().value;
      if (oldest !== undefined) {
        this.envelopeIds.delete(oldest);
      }
    }

    return false;
  }

  private isDuplicateContent(senderPublicKey: string, type: string, payload: unknown): boolean {
    if (!this.contentDedupEnabled) {
      return false;
    }

    const hash = createHash('sha256')
      .update(senderPublicKey)
      .update(type)
      .update(JSON.stringify(payload ?? null))
      .digest('hex');

    const now = Date.now();
    const firstSeen = this.contentDedup.get(hash);

    if (firstSeen !== undefined && now - firstSeen < this.contentDedupWindowMs) {
      return true;
    }

    this.contentDedup.set(hash, now);

    if (this.contentDedup.size > InboundMessageGuard.MAX_CONTENT_ENTRIES) {
      for (const [key, ts] of this.contentDedup.entries()) {
        if (now - ts >= this.contentDedupWindowMs) {
          this.contentDedup.delete(key);
        }
      }
      if (this.contentDedup.size > InboundMessageGuard.MAX_CONTENT_ENTRIES) {
        const oldestKey = this.contentDedup.keys().next().value;
        if (oldestKey !== undefined) {
          this.contentDedup.delete(oldestKey);
        }
      }
    }

    return false;
  }
}
