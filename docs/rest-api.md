# Agora Relay REST API

The REST API is an optional HTTP interface for relay access, intended for clients that cannot keep a persistent WebSocket connection.

## Runtime Model

REST is available when the relay is started via `runRelay()` with JWT secret configured.

- WebSocket relay default port: `3002` (`RELAY_PORT` or `PORT`)
- REST API default port: `3001` (`REST_PORT`)

> `agora relay` (CLI) starts WebSocket relay only. It does not start the REST API.

## Enabling REST

Set one of:

- `AGORA_RELAY_JWT_SECRET`
- `JWT_SECRET`

Optional:

- `AGORA_JWT_EXPIRY_SECONDS` (default `3600`)
- `RATE_LIMIT_RPM` (default `60`)
- `ALLOWED_ORIGINS` (default `*`)
- `MESSAGE_TTL_MS` (default `86400000`)

## Auth Model

- `POST /v1/register` returns a JWT.
- Other endpoints require `Authorization: Bearer <token>`.
- `DELETE /v1/disconnect` revokes the token.

JWT validation errors:

- `401 Missing or malformed Authorization header`
- `401 Invalid token`
- `401 Token expired`
- `401 Token has been revoked`

## Endpoints

### `POST /v1/register`

Registers a REST session and returns a token.

Request:

```json
{
  "publicKey": "<ed25519-public-key-hex>",
  "privateKey": "<ed25519-private-key-hex>",
  "name": "optional-name",
  "metadata": {
    "version": "optional-version",
    "capabilities": ["optional", "capability", "list"]
  }
}
```

Behavior:

- Relay verifies keypair by signing/verifying a test envelope.
- Private key is held in memory for session lifetime.

Response:

```json
{
  "token": "<jwt>",
  "expiresAt": 1700000000000,
  "peers": [
    { "publicKey": "...", "name": "...", "lastSeen": 1700000000000 }
  ]
}
```

### `POST /v1/send`

Sends a signed envelope to a connected peer.

Request:

```json
{
  "to": "<recipient-pubkey>",
  "type": "publish",
  "payload": { "text": "hello" },
  "inReplyTo": "optional-envelope-id"
}
```

Responses:

- `200 { "ok": true, "envelopeId": "..." }`
- `404 Recipient not connected` when recipient is neither active WebSocket peer nor active REST session.

Notes:

- REST recipient messages are buffered in memory.
- This endpoint does **not** route to relay `storagePeers` offline disk queue.

### `GET /v1/peers`

Returns connected peers (WebSocket + REST sessions), excluding caller.

### `GET /v1/messages`

Polls buffered messages for caller.

Query params:

- `since` (optional, ms epoch)
- `limit` (optional, max 100, default 50)

Buffer behavior:

- Without `since`: returns all buffered messages and clears buffer.
- With `since`: returns matching messages without destructive clear.

### `DELETE /v1/disconnect`

Revokes token and removes REST session + buffered messages.

## Rate Limiting

Per-IP sliding window via `express-rate-limit`:

- Window: 60 seconds
- Limit: `RATE_LIMIT_RPM` (default 60)
- Over-limit: `429 { "error": "Too many requests — try again later" }`

## Security Considerations

- Use HTTPS in production.
- `POST /v1/register` transmits private key; TLS is mandatory on untrusted networks.
- REST path is convenience-focused; high-assurance clients should prefer local signing over persistent private-key relay sessions.

See `SECURITY.md` for threat model details.