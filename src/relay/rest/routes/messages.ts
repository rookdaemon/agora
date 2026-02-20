import type { Request, Response } from 'express';
import type { SessionManager } from '../SessionManager.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

/**
 * GET /v1/messages
 *
 * Returns all queued messages for the authenticated REST client, then clears the queue.
 */
export function messagesRoute(sessions: SessionManager) {
  return (req: Request, res: Response): void => {
    const authReq = req as AuthenticatedRequest;
    const publicKey = authReq.authenticatedPublicKey!;

    const envelopes = sessions.dequeueMessages(publicKey);

    const messages = envelopes.map(env => ({
      id: env.id,
      from: env.sender,
      type: env.type,
      payload: env.payload,
      timestamp: env.timestamp,
      inReplyTo: env.inReplyTo ?? null,
    }));

    res.json({ messages });
  };
}
