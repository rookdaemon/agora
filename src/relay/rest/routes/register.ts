import type { Request, Response } from 'express';
import type { SessionManager } from '../SessionManager.js';

interface RegisterBody {
  publicKey?: unknown;
  privateKey?: unknown;
  name?: unknown;
  metadata?: unknown;
}

/**
 * POST /v1/register
 *
 * Registers an agent with the relay and returns a session token.
 * The private key is only used here to validate the key pair; it is stored
 * in-memory for server-side envelope signing.
 */
export function registerRoute(sessions: SessionManager) {
  return (req: Request<object, object, RegisterBody>, res: Response): void => {
    const { publicKey, privateKey, name, metadata } = req.body;

    if (typeof publicKey !== 'string' || publicKey.length === 0) {
      res.status(400).json({ error: 'Missing or invalid publicKey' });
      return;
    }

    if (typeof privateKey !== 'string' || privateKey.length === 0) {
      res.status(400).json({ error: 'Missing or invalid privateKey' });
      return;
    }

    if (name !== undefined && typeof name !== 'string') {
      res.status(400).json({ error: 'Invalid name: must be a string' });
      return;
    }

    if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))) {
      res.status(400).json({ error: 'Invalid metadata: must be an object' });
      return;
    }

    // Validate that the provided keys form a valid Ed25519 pair
    if (!sessions.validateKeyPair(publicKey, privateKey)) {
      res.status(400).json({ error: 'Invalid Ed25519 keypair' });
      return;
    }

    const { token, expiresAt } = sessions.createSession(publicKey, privateKey, {
      name: name as string | undefined,
      metadata: metadata as Record<string, unknown> | undefined,
    });

    res.json({ token, expiresAt });
  };
}
