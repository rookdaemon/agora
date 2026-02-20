import type { Request, Response, NextFunction } from 'express';
import type { SessionManager } from '../SessionManager.js';

/**
 * Extend Express Request to carry the authenticated public key.
 */
export interface AuthenticatedRequest extends Request {
  authenticatedPublicKey?: string;
}

/**
 * Returns an Express middleware that validates a Bearer token using the
 * provided SessionManager.  On success, attaches `authenticatedPublicKey`
 * to the request object.  On failure, responds with 401.
 */
export function authMiddleware(sessions: SessionManager) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const authReq = req as AuthenticatedRequest;
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing or invalid Authorization header' });
      return;
    }

    const token = authHeader.slice('Bearer '.length);
    const result = sessions.validateToken(token);

    if (!result.valid || !result.publicKey) {
      res.status(401).json({ error: 'Invalid or expired token' });
      return;
    }

    authReq.authenticatedPublicKey = result.publicKey;
    next();
  };
}
