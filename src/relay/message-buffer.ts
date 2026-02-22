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

const MAX_MESSAGES_PER_AGENT = 100;

/**
 * MessageBuffer stores inbound messages per agent public key.
 * FIFO eviction when the buffer is full (max 100 messages).
 */
export class MessageBuffer {
  private buffers: Map<string, BufferedMessage[]> = new Map();

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
    queue.push(message);
    if (queue.length > MAX_MESSAGES_PER_AGENT) {
      queue.shift(); // FIFO eviction
    }
  }

  /**
   * Retrieve messages for an agent, optionally filtering by `since` timestamp.
   * Returns messages with timestamp > since (exclusive).
   */
  get(publicKey: string, since?: number): BufferedMessage[] {
    const queue = this.buffers.get(publicKey) ?? [];
    if (since === undefined) {
      return [...queue];
    }
    return queue.filter((m) => m.timestamp > since);
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
