import type { Request, Response } from 'express';
import { createEnvelope, type MessageType } from '../../../message/envelope.js';
import type { SessionManager } from '../SessionManager.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';

/** Callback that routes an envelope to a WebSocket or REST peer. */
export type RouteEnvelopeFn = (
  from: string,
  to: string,
  envelope: ReturnType<typeof createEnvelope>,
) => { ok: boolean; error?: string };

interface SendBody {
  to?: unknown;
  type?: unknown;
  payload?: unknown;
  inReplyTo?: unknown;
}

/**
 * POST /v1/send
 *
 * Sends an envelope to a specific peer (WebSocket or REST client).
 * The server signs the envelope on behalf of the authenticated REST agent.
 */
export function sendRoute(sessions: SessionManager, routeEnvelope: RouteEnvelopeFn) {
  return (req: Request, res: Response): void => {
    const authReq = req as AuthenticatedRequest;
    const senderPublicKey = authReq.authenticatedPublicKey!;
    const body = req.body as SendBody;
    const { to, type, payload, inReplyTo } = body;

    if (typeof to !== 'string' || to.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "to" field' });
      return;
    }

    if (typeof type !== 'string' || type.length === 0) {
      res.status(400).json({ error: 'Missing or invalid "type" field' });
      return;
    }

    if (payload === undefined || payload === null) {
      res.status(400).json({ error: 'Missing "payload" field' });
      return;
    }

    if (inReplyTo !== undefined && typeof inReplyTo !== 'string') {
      res.status(400).json({ error: 'Invalid "inReplyTo" field: must be a string' });
      return;
    }

    const session = sessions.getSession(senderPublicKey);
    if (!session) {
      res.status(401).json({ error: 'Session not found' });
      return;
    }

    const envelope = createEnvelope(
      type as MessageType,
      senderPublicKey,
      session.privateKey,
      payload,
      Date.now(),
      inReplyTo as string | undefined,
    );

    const result = routeEnvelope(senderPublicKey, to, envelope);
    if (!result.ok) {
      res.status(404).json({ error: result.error ?? 'Peer not found' });
      return;
    }

    res.json({ ok: true, messageId: envelope.id });
  };
}
