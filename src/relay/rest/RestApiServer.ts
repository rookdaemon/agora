import { createServer, type Server } from 'node:http';
import express from 'express';
import { SessionManager } from './SessionManager.js';
import { authMiddleware } from './middleware/auth.js';
import { registerRoute } from './routes/register.js';
import { sendRoute, type RouteEnvelopeFn } from './routes/send.js';
import { peersRoute, type GetWsPeersFn } from './routes/peers.js';
import { messagesRoute } from './routes/messages.js';
import { disconnectRoute } from './routes/disconnect.js';

export interface RestApiServerOptions {
  /** Callback to route an outbound envelope to a WS or REST peer. */
  routeEnvelope: RouteEnvelopeFn;
  /** Callback that returns a snapshot of connected WebSocket peers. */
  getWsPeers: GetWsPeersFn;
}

/**
 * Thin Express REST API server that wraps the Agora relay protocol.
 *
 * Routes:
 *  POST   /v1/register    – register agent, get JWT session token
 *  POST   /v1/send        – send envelope to peer (server-side signing)
 *  GET    /v1/peers       – list online peers (WS + REST)
 *  GET    /v1/messages    – poll inbound message queue
 *  DELETE /v1/disconnect  – revoke session and disconnect
 */
export class RestApiServer {
  readonly sessions: SessionManager;
  private readonly app: express.Application;
  private server: Server | null = null;

  constructor(opts: RestApiServerOptions) {
    this.sessions = new SessionManager();
    this.app = this.buildApp(opts);
  }

  private buildApp(opts: RestApiServerOptions): express.Application {
    const app = express();
    app.use(express.json());

    const auth = authMiddleware(this.sessions);

    // Public route — no auth required
    app.post('/v1/register', registerRoute(this.sessions));

    // Protected routes
    app.post('/v1/send', auth, sendRoute(this.sessions, opts.routeEnvelope));
    app.get('/v1/peers', auth, peersRoute(this.sessions, opts.getWsPeers));
    app.get('/v1/messages', auth, messagesRoute(this.sessions));
    app.delete('/v1/disconnect', auth, disconnectRoute(this.sessions));

    return app;
  }

  /**
   * Start the REST API server on the given port.
   */
  start(port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app);
      this.server.on('error', reject);
      this.server.listen(port, () => resolve());
    });
  }

  /**
   * Stop the REST API server.
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => {
        if (err) reject(err);
        else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * Expose the underlying Express app (useful for testing with supertest).
   */
  get expressApp(): express.Application {
    return this.app;
  }
}
