import { randomBytes } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { signMessage, verifySignature } from '../../identity/keypair.js';
import type { Envelope } from '../../message/envelope.js';

/**
 * A REST API session for an agent.
 */
export interface Session {
  /** Agent's public key (hex) */
  publicKey: string;
  /** Agent's private key (hex) — used for server-side signing */
  privateKey: string;
  /** Optional agent name */
  name?: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Session creation timestamp (ms) */
  createdAt: number;
  /** Session expiry timestamp (ms) */
  expiresAt: number;
}

/** JWT payload shape */
interface JwtPayload {
  sub: string;       // publicKey
  name?: string;
  iat: number;
  exp: number;
}

/** Default session TTL: 1 hour */
const DEFAULT_TTL_MS = 60 * 60 * 1000;

/**
 * Manages REST API sessions and per-session message queues.
 *
 * Sessions are in-memory only — they do not survive a relay restart.
 * The JWT secret is generated on startup; rotating it invalidates all sessions.
 */
export class SessionManager {
  private readonly jwtSecret: string;
  private sessions = new Map<string, Session>();
  private messageQueues = new Map<string, Envelope[]>();

  constructor() {
    this.jwtSecret = randomBytes(32).toString('hex');
  }

  /**
   * Validate an Ed25519 key pair by verifying a deterministic test signature.
   * Returns true only when the private key matches the public key.
   */
  validateKeyPair(publicKey: string, privateKey: string): boolean {
    try {
      const testMessage = 'agora-keypair-validation';
      const sig = signMessage(testMessage, privateKey);
      return verifySignature(testMessage, sig, publicKey);
    } catch {
      return false;
    }
  }

  /**
   * Create a new session and return a signed JWT.
   */
  createSession(
    publicKey: string,
    privateKey: string,
    opts?: { name?: string; metadata?: Record<string, unknown>; ttl?: number },
  ): { token: string; expiresAt: number } {
    const ttl = opts?.ttl ?? DEFAULT_TTL_MS;
    const now = Date.now();
    const expiresAt = now + ttl;

    const session: Session = {
      publicKey,
      privateKey,
      name: opts?.name,
      metadata: opts?.metadata,
      createdAt: now,
      expiresAt,
    };

    this.sessions.set(publicKey, session);

    const payload: JwtPayload = {
      sub: publicKey,
      ...(opts?.name ? { name: opts.name } : {}),
      iat: Math.floor(now / 1000),
      exp: Math.floor(expiresAt / 1000),
    };

    const token = jwt.sign(payload, this.jwtSecret, { algorithm: 'HS256' });
    return { token, expiresAt };
  }

  /**
   * Validate a Bearer token.
   * Returns `{ valid: true, publicKey }` on success or `{ valid: false }` on failure.
   */
  validateToken(token: string): { valid: boolean; publicKey?: string } {
    try {
      const decoded = jwt.verify(token, this.jwtSecret, { algorithms: ['HS256'] }) as JwtPayload;
      const publicKey = decoded.sub;

      // Confirm session still exists (may have been revoked)
      const session = this.sessions.get(publicKey);
      if (!session) {
        return { valid: false };
      }

      // Confirm session has not expired on our side
      if (Date.now() > session.expiresAt) {
        this.sessions.delete(publicKey);
        return { valid: false };
      }

      return { valid: true, publicKey };
    } catch {
      return { valid: false };
    }
  }

  /**
   * Retrieve a session by public key.
   */
  getSession(publicKey: string): Session | undefined {
    return this.sessions.get(publicKey);
  }

  /**
   * Revoke a session.
   */
  revokeSession(publicKey: string): void {
    this.sessions.delete(publicKey);
    this.messageQueues.delete(publicKey);
  }

  /**
   * Enqueue an inbound envelope for a REST client to poll later.
   */
  enqueueMessage(publicKey: string, envelope: Envelope): void {
    if (!this.messageQueues.has(publicKey)) {
      this.messageQueues.set(publicKey, []);
    }
    this.messageQueues.get(publicKey)!.push(envelope);
  }

  /**
   * Dequeue all pending messages for a REST client (clears the queue).
   */
  dequeueMessages(publicKey: string): Envelope[] {
    const msgs = this.messageQueues.get(publicKey) ?? [];
    this.messageQueues.set(publicKey, []);
    return msgs;
  }

  /**
   * Returns true if the given public key belongs to a REST session.
   */
  hasSession(publicKey: string): boolean {
    return this.sessions.has(publicKey);
  }

  /**
   * Returns all active sessions (for peer listing).
   */
  getSessions(): Session[] {
    const now = Date.now();
    const active: Session[] = [];
    for (const session of this.sessions.values()) {
      if (now <= session.expiresAt) {
        active.push(session);
      }
    }
    return active;
  }
}
