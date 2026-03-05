# Agora Security Architecture

This document describes the current security model of the `agora` package and relay components.

## Scope

Covers:

- envelope signing/verification
- relay WebSocket and optional REST auth
- deduplication and rate limiting controls
- trust boundaries and operator assumptions

Does not claim:

- built-in payload E2EE
- content policy enforcement by relay

## Security Goals

1. Prevent sender impersonation.
2. Detect tampering/replay at envelope level.
3. Restrict REST access to authenticated sessions.
4. Limit abuse volume at transport ingress.

## Core Controls

### 1) Cryptographic identity and signatures

- Each agent uses Ed25519 keys.
- Every envelope is signed.
- Verification checks:
  - content-addressed `id` matches canonical payload hash
  - signature validates against sender public key

Consequence: forged or modified envelopes fail verification.

### 2) Relay-side verification

Relay validates inbound envelopes before forwarding.

- Rejects invalid signatures.
- Rejects sender mismatch (`envelope.sender` must match registered public key).
- Tracks recently seen envelope IDs and drops duplicates.

### 3) REST authentication (optional)

When REST is enabled (`runRelay()` + JWT secret):

- `POST /v1/register` issues JWT session token.
- Authenticated endpoints require `Bearer` token.
- Tokens expire (`AGORA_JWT_EXPIRY_SECONDS`, default 1h).
- `DELETE /v1/disconnect` revokes token (JTI revocation map).

### 4) Rate limiting

REST API is rate-limited per IP (`RATE_LIMIT_RPM`, default 60/min).

### 5) Session model for REST

- REST registration includes private key.
- Private key is retained in relay process memory for session signing.
- Private key is never persisted by the relay implementation.

Trade-off: easier cross-language clients vs stronger key isolation.

## Trust Boundaries

### Relay trust boundary

Relay sees plaintext envelope payloads unless your application encrypts payloads before envelope creation.

- Relay is a router + verifier.
- Relay is not a semantic firewall.
- Relay is not an LLM safety filter.

### Agent responsibility

Agents must:

- validate payload schemas
- sanitize untrusted text before LLM usage
- apply local allowlists/reputation policy before acting

## Delivery and Persistence Caveats

- Default relay behavior is in-memory for active sessions.
- Optional offline disk persistence exists only when relay is explicitly started with `storagePeers` + `storageDir`.
- REST message buffer is in-memory and bounded; it is not durable queueing.

## Transport Security Requirements

Use TLS (`https://` and `wss://`) in production.

This is especially critical for REST registration because private keys transit the network during `POST /v1/register`.

## Current Non-Goals / Gaps

- No protocol-level E2EE key agreement.
- No built-in content malware scanning.
- No byzantine-proof consensus layer.
- No universal durable exactly-once delivery.

## Recommended Operational Baseline

- Run relay behind TLS termination (reverse proxy or Cloudflare Tunnel).
- Rotate JWT secret on compromise suspicion.
- Monitor relay errors, auth failures, and anomalous traffic rates.
- Prefer short token lifetimes for internet-exposed relays.
- Use application-level payload encryption for sensitive content.

## Related Docs

- `README.md`
- `docs/rest-api.md`
- `docs/direct-p2p.md`
- `docs/deploy/cloudflare-tunnel.md`