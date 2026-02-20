import type { Request, Response } from 'express';
import type { SessionManager } from '../SessionManager.js';

/** A peer summary returned by GET /v1/peers */
export interface PeerSummary {
  publicKey: string;
  name?: string;
  lastSeen: number;
  metadata?: Record<string, unknown>;
}

/** Callback that returns all connected WebSocket peers */
export type GetWsPeersFn = () => PeerSummary[];

/**
 * GET /v1/peers
 *
 * Returns a list of all currently online peers (both WebSocket and REST clients).
 */
export function peersRoute(sessions: SessionManager, getWsPeers: GetWsPeersFn) {
  return (_req: Request, res: Response): void => {
    const wsPeers = getWsPeers();

    const restPeers: PeerSummary[] = sessions.getSessions().map(s => ({
      publicKey: s.publicKey,
      name: s.name,
      lastSeen: s.createdAt,
      metadata: s.metadata,
    }));

    // Merge, deduplicating by publicKey (WS peers take precedence for lastSeen)
    const peerMap = new Map<string, PeerSummary>();
    for (const p of restPeers) {
      peerMap.set(p.publicKey, p);
    }
    for (const p of wsPeers) {
      peerMap.set(p.publicKey, p);
    }

    res.json({ peers: Array.from(peerMap.values()) });
  };
}
