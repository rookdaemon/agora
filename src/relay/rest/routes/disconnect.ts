import type { Request, Response } from 'express';
import type { SessionManager } from '../SessionManager.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * DELETE /v1/disconnect
 *
 * Removes the agent's session from the relay and invalidates its token.
 */
export function disconnectRoute(sessions: SessionManager) {
  return (req: Request, res: Response): void => {
    const authReq = req as AuthenticatedRequest;
    const publicKey = authReq.authenticatedPublicKey!;

    sessions.revokeSession(publicKey);

    res.json({ ok: true });
  };
}
