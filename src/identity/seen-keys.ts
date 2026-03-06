import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { getDefaultConfigPath } from '../config';

export const SEEN_KEYS_FILE_NAME = 'seen-keys.json';

/**
 * Default path for the seen-keys store: alongside the Agora config file.
 */
export function getSeenKeysPath(storageDir?: string): string {
  if (storageDir) {
    return join(storageDir, SEEN_KEYS_FILE_NAME);
  }
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), SEEN_KEYS_FILE_NAME);
}

export interface SeenKeyEntry {
  publicKey: string;
  firstSeen: number;
  lastSeen: number;
  seenCount: number;
}

/**
 * Persists all encountered public keys to support reliable identity resolution.
 * The full key remains the canonical identity — the shortened suffix is display only.
 */
export class SeenKeyStore {
  private keys: Map<string, SeenKeyEntry> = new Map();
  private dirty = false;

  constructor(private readonly filePath: string) {
    this.load();
  }

  /**
   * Record a public key sighting. Adds or updates the entry.
   */
  record(publicKey: string): void {
    const now = Date.now();
    const existing = this.keys.get(publicKey);
    if (existing) {
      existing.lastSeen = now;
      existing.seenCount++;
    } else {
      this.keys.set(publicKey, {
        publicKey,
        firstSeen: now,
        lastSeen: now,
        seenCount: 1,
      });
    }
    this.dirty = true;
  }

  has(publicKey: string): boolean {
    return this.keys.has(publicKey);
  }

  get(publicKey: string): SeenKeyEntry | undefined {
    return this.keys.get(publicKey);
  }

  getAll(): SeenKeyEntry[] {
    return Array.from(this.keys.values());
  }

  /**
   * Flush changes to disk. Call periodically or on shutdown.
   */
  flush(): void {
    if (!this.dirty) return;
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const entries = Array.from(this.keys.values());
    writeFileSync(this.filePath, JSON.stringify(entries, null, 2), 'utf-8');
    this.dirty = false;
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      const entries: SeenKeyEntry[] = JSON.parse(raw);
      for (const entry of entries) {
        if (typeof entry.publicKey === 'string' && entry.publicKey.length > 0) {
          this.keys.set(entry.publicKey, entry);
        }
      }
    } catch {
      // Corrupt file — start fresh
    }
  }
}
