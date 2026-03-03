import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getDefaultConfigPath } from '../config';

export const IGNORED_FILE_NAME = 'IGNORED_PEERS.md';

export function getIgnoredPeersPath(storageDir?: string): string {
  if (storageDir) {
    return join(storageDir, IGNORED_FILE_NAME);
  }
  const configPath = getDefaultConfigPath();
  return join(dirname(configPath), IGNORED_FILE_NAME);
}

export function loadIgnoredPeers(filePath?: string): string[] {
  const path = filePath ?? getIgnoredPeersPath();
  if (!existsSync(path)) return [];

  const lines = readFileSync(path, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  return Array.from(new Set(lines));
}

export function saveIgnoredPeers(peers: string[], filePath?: string): void {
  const path = filePath ?? getIgnoredPeersPath();
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const unique = Array.from(new Set(peers.map((peer) => peer.trim()).filter(Boolean))).sort();
  const content = [
    '# Ignored peers',
    '# One public key per line',
    ...unique,
    '',
  ].join('\n');

  writeFileSync(path, content, 'utf-8');
}

export class IgnoredPeersManager {
  private readonly peers: Set<string>;
  private readonly filePath: string;

  constructor(filePath?: string) {
    this.filePath = filePath ?? getIgnoredPeersPath();
    this.peers = new Set(loadIgnoredPeers(this.filePath));
  }

  ignorePeer(publicKey: string): boolean {
    const normalized = publicKey.trim();
    if (!normalized) {
      return false;
    }
    const added = !this.peers.has(normalized);
    this.peers.add(normalized);
    if (added) {
      this.persist();
    }
    return added;
  }

  unignorePeer(publicKey: string): boolean {
    const normalized = publicKey.trim();
    const removed = this.peers.delete(normalized);
    if (removed) {
      this.persist();
    }
    return removed;
  }

  listIgnoredPeers(): string[] {
    return Array.from(this.peers.values()).sort();
  }

  private persist(): void {
    saveIgnoredPeers(this.listIgnoredPeers(), this.filePath);
  }
}
