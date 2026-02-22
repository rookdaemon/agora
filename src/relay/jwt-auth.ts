/**
 * jwt-auth.ts — JWT token creation and validation middleware.
 *
 * Tokens are signed with AGORA_RELAY_JWT_SECRET (required env var).
 * Expiry defaults to 3600 seconds (1 hour), configurable via AGORA_JWT_EXPIRY_SECONDS.
 *
 * Token payload: { publicKey, name }
 */

import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

export interface JwtPayload {
  publicKey: string;
  name?: string;
}

/**
 * Augment Express Request to carry decoded JWT payload.
 */
export interface AuthenticatedRequest extends Request {
  agent?: JwtPayload;
}

/**
 * Revocation set for invalidated tokens (populated by DELETE /v1/disconnect).
 * Stored as a Map of JWT `jti` → expiry timestamp (ms).
 * Entries are automatically removed once their JWT would have expired anyway,
 * preventing unbounded memory growth.
 */
const revokedJtis: Map<string, number> = new Map();

/**
 * Remove revoked JTI entries whose token expiry has already passed.
 * These tokens can no longer be used regardless, so no need to keep them.
 */
function pruneExpiredRevocations(): void {
  const now = Date.now();
  for (const [jti, expiry] of revokedJtis) {
    if (expiry <= now) {
      revokedJtis.delete(jti);
    }
  }
}

function getJwtSecret(): string {
  const secret = process.env.AGORA_RELAY_JWT_SECRET;
  if (!secret) {
    throw new Error(
      'AGORA_RELAY_JWT_SECRET environment variable is required but not set'
    );
  }
  return secret;
}

function getExpirySeconds(): number {
  const raw = process.env.AGORA_JWT_EXPIRY_SECONDS;
  if (raw) {
    const parsed = parseInt(raw, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return 3600; // 1 hour default
}

/**
 * Create a signed JWT for a registered agent.
 * Returns the token string and its expiry timestamp (ms since epoch).
 */
export function createToken(payload: JwtPayload): {
  token: string;
  expiresAt: number;
} {
  const secret = getJwtSecret();
  const expirySeconds = getExpirySeconds();
  const jti = `${Date.now()}-${randomBytes(16).toString('hex')}`;

  const token = jwt.sign(
    { publicKey: payload.publicKey, name: payload.name, jti },
    secret,
    { expiresIn: expirySeconds }
  );

  const expiresAt = Date.now() + expirySeconds * 1000;
  return { token, expiresAt };
}

/**
 * Revoke a token by its jti claim so it cannot be used again.
 * The revocation entry is stored with the token's expiry so it can be
 * pruned automatically once the token would no longer be valid anyway.
 */
export function revokeToken(token: string): void {
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & {
      jti?: string;
      exp?: number;
    };
    if (decoded.jti) {
      const expiry = decoded.exp ? decoded.exp * 1000 : Date.now();
      revokedJtis.set(decoded.jti, expiry);
      pruneExpiredRevocations();
    }
  } catch {
    // Token already invalid — nothing to revoke
  }
}

/**
 * Express middleware that validates the Authorization: Bearer <token> header.
 * Attaches decoded payload to `req.agent` on success.
 * Responds with 401 if missing/invalid/expired/revoked.
 */
export function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const secret = getJwtSecret();
    const decoded = jwt.verify(token, secret) as jwt.JwtPayload & {
      publicKey: string;
      name?: string;
      jti?: string;
    };

    if (decoded.jti && revokedJtis.has(decoded.jti)) {
      res.status(401).json({ error: 'Token has been revoked' });
      return;
    }

    req.agent = { publicKey: decoded.publicKey, name: decoded.name };
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Token expired' });
    } else {
      res.status(401).json({ error: 'Invalid token' });
    }
  }
}
