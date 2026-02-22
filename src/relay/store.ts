/**
 * store.ts — File-based message store for offline peers.
 * When the relay has storage enabled for certain public keys, messages
 * for offline recipients are persisted and delivered when they connect.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface StoredMessage {
  from: string;
  name?: string;
  envelope: object;
}

export class MessageStore {
  private storageDir: string;

  constructor(storageDir: string) {
    this.storageDir = storageDir;
    fs.mkdirSync(storageDir, { recursive: true });
  }

  private recipientDir(publicKey: string): string {
    const safe = publicKey.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.storageDir, safe);
  }

  save(recipientKey: string, message: StoredMessage): void {
    const dir = this.recipientDir(recipientKey);
    fs.mkdirSync(dir, { recursive: true });
    const filename = `${Date.now()}-${crypto.randomUUID()}.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(message));
  }

  load(recipientKey: string): StoredMessage[] {
    const dir = this.recipientDir(recipientKey);
    if (!fs.existsSync(dir)) return [];
    const files = fs.readdirSync(dir).sort();
    const messages: StoredMessage[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const data = fs.readFileSync(path.join(dir, file), 'utf8');
        messages.push(JSON.parse(data) as StoredMessage);
      } catch {
        // Skip files that cannot be read or parsed
      }
    }
    return messages;
  }

  clear(recipientKey: string): void {
    const dir = this.recipientDir(recipientKey);
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.endsWith('.json')) {
        fs.unlinkSync(path.join(dir, file));
      }
    }
  }
}
