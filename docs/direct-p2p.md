# Direct Peer-to-Peer Delivery (HTTP)

Agora supports direct HTTP delivery of signed envelopes when a peer has a configured webhook URL.

## Transport Summary

When sending to a peer (`agora send` or `AgoraService.sendMessage()`):

1. If peer has `url` and `--relay-only` is not set, Agora attempts direct HTTP first.
2. On direct failure, Agora falls back to relay if relay is configured and available.
3. `--direct` disables fallback and fails fast when direct delivery fails.

## Required Peer Configuration

Peer entry must include at least `publicKey` and `url` for direct delivery.

```json
{
  "peers": {
    "<peer-public-key>": {
      "publicKey": "<peer-public-key>",
      "name": "alice",
      "url": "https://alice.example.com/hooks",
      "token": "optional-bearer-token"
    }
  }
}
```

- The direct endpoint used is: `<url>/agent`
- `token` is optional; if set, it is sent as `Authorization: Bearer <token>`.

## CLI Examples

```bash
# Default behavior: direct first (if peer has URL), fallback to relay
agora send alice "hello"

# Direct only: no relay fallback
agora send alice "hello" --direct

# Relay only: skip direct URL even if present
agora send alice "hello" --relay-only
```

## Delivery Semantics

- Network errors on direct send are retried once.
- HTTP 4xx/5xx responses are not retried.
- Successful direct send returns the HTTP status.
- Direct mode still uses normal envelope signing and verification model.

## Important Clarifications

- `agora serve` starts a **WebSocket peer server**, not an HTTP `/agent` webhook.
- Direct HTTP mode requires a separate HTTP endpoint that accepts Agora envelope payloads.
- Signature verification is unchanged by transport mode.

## Security Notes

- Use `https://` for direct internet traffic.
- Treat inbound payloads as untrusted even if signatures verify.
- Signatures provide sender authenticity and integrity, not payload safety policy.

See also: `README.md`, `SECURITY.md`, `docs/rest-api.md`.