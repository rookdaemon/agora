/**
 * message-buffer.ts — In-memory bounded message queue per agent.
 *
 * When messages are delivered to an agent via the relay, they are also
 * stored here so that HTTP polling clients can retrieve them via GET /v1/messages.
 */

export interface BufferedMessage {
  id: string;
  from: string;
  fromName?: string;
  type: string;
  payload: unknown;
  timestamp: number;
  inReplyTo?: string;
}

interface StoredMessage {
  message: BufferedMessage;
  receivedAt: number;
}

const MAX_MESSAGES_PER_AGENT = 100;

/**
 * MessageBuffer stores inbound messages per agent public key.
 * FIFO eviction when the buffer is full (max 100 messages).
 * Messages older than ttlMs (measured from when they were received) are pruned on access.
 */
export class MessageBuffer {
  private buffers: Map<string, StoredMessage[]> = new Map();
  private ttlMs: number;

  constructor(options?: { ttlMs?: number }) {
    this.ttlMs = options?.ttlMs ?? 86400000; // default 24h
  }

  /**
   * Add a message to an agent's buffer.
   * Evicts the oldest message if the buffer is full.
   */
  add(publicKey: string, message: BufferedMessage): void {
    let queue = this.buffers.get(publicKey);
    if (!queue) {
      queue = [];
      this.buffers.set(publicKey, queue);
    }
    queue.push({ message, receivedAt: Date.now() });
    if (queue.length > MAX_MESSAGES_PER_AGENT) {
      queue.shift(); // FIFO eviction
    }
  }

  /**
   * Retrieve messages for an agent, optionally filtering by `since` timestamp.
   * Returns messages with timestamp > since (exclusive). Prunes expired messages.
   */
  get(publicKey: string, since?: number): BufferedMessage[] {
    const now = Date.now();
    let queue = this.buffers.get(publicKey) ?? [];
    // Prune messages older than ttlMs (based on wall-clock receive time)
    queue = queue.filter((s) => now - s.receivedAt < this.ttlMs);
    this.buffers.set(publicKey, queue);
    const messages = queue.map((s) => s.message);
    if (since === undefined) {
      return [...messages];
    }
    return messages.filter((m) => m.timestamp > since);
  }

  /**
   * Clear all messages for an agent (after polling without `since`).
   */
  clear(publicKey: string): void {
    this.buffers.set(publicKey, []);
  }

  /**
   * Remove all state for a disconnected agent.
   */
  delete(publicKey: string): void {
    this.buffers.delete(publicKey);
  }
}
