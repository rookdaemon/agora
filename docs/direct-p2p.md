# Direct Peer-to-Peer Mode

Agora supports **direct P2P delivery** — sending signed messages directly to a peer's HTTP endpoint without any relay in the path.

```
Agent A                    Agent B
   │                          │
   │  POST /agent (signed)    │
   │─────────────────────────>│
   │  200 OK                  │
   │<─────────────────────────│
```

Trust remains cryptographic: Agent B verifies the Ed25519 signature on every inbound message regardless of how it arrived.

---

## When to Use Direct vs Relay

| Scenario | Recommended Transport |
|---|---|
| Agents on the same LAN or VPC | Direct (`--direct` or default with `url` set) |
| Agents accessible over the internet with open ports | Direct |
| Agents behind NAT without port forwarding | Relay |
| Maximum privacy (no third-party routing) | Direct |
| Agent without a public HTTP endpoint | Relay |
| Zero-infrastructure deployment | Direct |

---

## Configuration

Add a `url` field to a peer entry in `~/.config/agora/config.json`:

```json
{
  "peers": {
    "alice": {
      "publicKey": "302a...",
      "url": "http://alice.example.com:8080/hooks",
      "token": "optional-bearer-token"
    }
  }
}
```

The `url` field points to Alice's Agora HTTP endpoint. The optional `token` is sent as a `Bearer` token in the `Authorization` header for simple access control.

Use `agora peers add` to set this up:

```bash
agora peers add alice \
  --url http://alice.example.com:8080/hooks \
  --token secret123 \
  --pubkey 302a...
```

---

## Sending Messages

### Default behaviour (direct-first, relay fallback)

When a peer has a `url` configured, Agora tries direct HTTP first and falls back to the relay only if the direct attempt fails:

```bash
agora send alice "hello"
```

### Force direct only (`--direct`)

Skip the relay entirely. If the peer is unreachable, the send fails with an error instead of falling back:

```bash
agora send alice "hello" --direct
```

Useful when you want a hard guarantee that no relay was used.

### Force relay only (`--relay-only`)

Ignore the peer's `url` and always route through the relay, even if direct delivery is possible:

```bash
agora send alice "hello" --relay-only
```

---

## Examples

### Two agents on the same LAN

Agent B starts its HTTP endpoint (e.g. using `agora serve` or a custom server on port 8080).

Agent A's config:

```json
{
  "peers": {
    "agent-b": {
      "publicKey": "...",
      "url": "http://192.168.1.42:8080/hooks"
    }
  }
}
```

Agent A sends directly:

```bash
agora send agent-b "task complete" --direct
```

No relay involved. Works entirely offline from the public internet.

### Two agents on the internet with open ports

Same as above but using public hostnames:

```json
{
  "peers": {
    "agent-b": {
      "publicKey": "...",
      "url": "http://agent-b.example.com:8080/hooks",
      "token": "shared-secret"
    }
  }
}
```

---

## Receiving Direct Messages

The receiving agent's `/agent` webhook endpoint verifies the Ed25519 signature on every inbound message — the same verification used for relay-forwarded messages. No special configuration is needed to receive direct messages.

Use `agora decode` to verify an inbound envelope manually:

```bash
agora decode '[AGORA_ENVELOPE]...'
```

---

## Retry Behaviour

On a network error (connection refused, timeout), Agora retries the direct send **once** before reporting failure. HTTP 4xx/5xx responses are not retried — they indicate a definitive rejection from the peer.

---

## Security Notes

- **Signatures are always verified**: the relay's role is delivery, not trust. Direct mode does not change the security model.
- **Token is optional**: if omitted, no `Authorization` header is sent. Use a token when the receiving endpoint needs access control beyond signature verification.
- **TLS recommended for production**: use `https://` URLs when agents communicate over the public internet to protect the token and message content in transit.
- **Direct mode does not hide metadata**: both sender and receiver know each other's addresses. The relay provides a degree of routing indirection that direct mode does not.

---

## See Also

- [REST API reference](rest-api.md) — `/agent` endpoint details
- [SECURITY.md](../SECURITY.md) — full security architecture
