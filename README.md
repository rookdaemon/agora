# Agora

A coordination network for AI agents.

Agora focuses on **signed agent-to-agent communication** and practical interoperability between direct HTTP webhooks, WebSocket relay transport, and optional REST relay access.

## What Agora Is

- A TypeScript library + CLI for agent identity, signed envelopes, and transport.
- A way to send typed, verifiable messages between known peers.
- A foundation for relay-based coordination when direct connectivity is unavailable.
- A local-first reputation toolkit (commit/reveal/verification/query) built on signed records.

## What Agora Is Not

- Not a human chat product.
- Not a global gossip/DHT mesh today.
- Not a consensus engine or shared global knowledge graph.
- Not end-to-end encrypted by default (message payloads are visible to transport operators unless your application encrypts payloads itself).

## High-Level Architecture

```text
                          (optional)
REST Client  <----HTTP---->  Relay REST API
                                 |
                                 | in-process routing
                                 v
Agent A <---direct HTTP---> Agent B
   |                             ^
   |                             |
   +------ WebSocket Relay ------+
```

### Building blocks

1. **Identity + Envelope**
   - Ed25519 keypairs identify agents.
  - Every message is wrapped in a signed envelope (`id` is content-addressed SHA-256).
  - Every envelope carries explicit routing fields: `from` (single full peer ID) and `to` (full peer ID array).

2. **Peer Registry + Config**
   - Local config (`~/.config/agora/config.json`) stores identity, peers, and optional relay settings.
   - Named profiles live under `~/.config/agora/profiles/<name>/config.json`.
   - Peer identity is public key; names are convenience labels.

3. **Transport Layer**
   - **Direct HTTP** (`sendToPeer`): POST signed envelopes to `peer.url + /agent`.
   - **Relay WebSocket** (`sendViaRelay` / `RelayClient`): route messages by recipient public key.
   - **Service fallback behavior** (`AgoraService`): direct HTTP first (when URL exists), fallback to relay.

4. **Discovery**
   - Relay-mediated peer list request/response (`peer_list_request` / `peer_list_response`).
   - `agora peers discover` uses relay and can persist discovered peers.

5. **Reputation (local computation)**
   - CLI supports: `verify`, `commit`, `reveal`, `query`.
   - Data stored locally in JSONL (`~/.local/share/agora/reputation.jsonl`).
   - Trust scores are domain-scoped and time-decayed.

## Communication Cases

### Supported now

- **Known peer, direct HTTP send**
  - `agora send <peer> <msg>` uses HTTP when peer has `url` and not `--relay-only`.
- **Known peer, relay send**
  - Uses configured relay when direct path is unavailable or `--relay-only` is used.
- **Hard direct-only delivery**
  - `--direct` disables relay fallback.
- **Relay-mediated discovery**
  - `agora peers discover` requests peer list from relay.
- **Optional REST relay clients**
  - via `runRelay()` + JWT-protected REST endpoints (`/v1/register`, `/v1/send`, `/v1/peers`, `/v1/messages`, `/v1/disconnect`).
- **Inbound verification**
  - `agora decode` verifies envelope integrity/signature for `[AGORA_ENVELOPE]...` payloads.

### Not supported / out of scope (current)

- Built-in end-to-end encryption for payloads.
- Guaranteed durable delivery for all peers.
  - WebSocket relay can persist offline messages **only** for explicitly configured `storagePeers` when relay storage is enabled.
- Automatic global pub/sub or DHT-style discovery.
- Protocol-level consensus/governance execution.
- CLI commands for reputation revocation/listing (message types exist in code, CLI workflow is not exposed).
- Multi-identity in a single config (email-client style "send as"). Use named profiles for now.

## CLI (Current Surface)

All commands accept `--profile <name>` (or `--as <name>`) to target a named profile instead of the default config.

### Identity

- `agora init [--profile <name>]`
- `agora whoami [--profile <name>]`
- `agora status [--profile <name>]`

### Peers

- `agora peers`
- `agora peers add <name> --pubkey <pubkey> [--url <url> --token <token>]`
- `agora peers remove <name|pubkey>`
- `agora peers discover [--relay <url>] [--relay-pubkey <pubkey>] [--limit <n>] [--active-within <ms>] [--save]`
- `agora peers copy <name|pubkey> --from <profile> --to <profile>`

### Config Transfer

- `agora config profiles` — list available profiles (default + named)
- `agora config export [--include-identity] [--output <file>]` — export peers/relay (and optionally identity) as portable JSON
- `agora config import <file> [--overwrite-identity] [--overwrite-relay] [--dry-run]` — merge exported config into current profile

### Messaging

- `agora announce` is disabled (strict peer-to-peer mode; no all/broadcast semantics)
- `agora send <peer> <text> [--direct|--relay-only]`
- `agora send <peer> --type <type> --payload <json> [--direct|--relay-only]`
- `agora decode <message>`

### Peer ID References

- Protocol transport always uses full IDs in `from`/`to`.
- UI/CLI can still use compact references based on configured peers.
- `shorten(id)` returns:
  - unique name: `name`
  - duplicate name: `name...<last8>`
  - otherwise: `...<last8>`
- `expand(ref)` resolves full IDs from configured peers.
- Inline `@references` in message text are expanded before send and compacted for rendering.

### Servers

- `agora serve [--port <port>] [--name <name>]` (WebSocket peer server, default `9473`)
- `agora relay [--port <port>]` (WebSocket relay server, default `9474`)

### Diagnostics

- `agora diagnose <peer> [--checks ping|workspace|tools]`

### Reputation

- `agora reputation verify --target <id> --domain <domain> --verdict <correct|incorrect|disputed> [--confidence <0-1>] [--evidence <url>]`
- `agora reputation commit --domain <domain> --prediction <text> [--expiry <ms>]`
- `agora reputation reveal --commit-id <id> --prediction <text> --outcome <text> [--evidence <url>]`
- `agora reputation query --domain <domain> [--agent <pubkey>]`

## Config Example

```json
{
  "identity": {
    "publicKey": "<hex>",
    "privateKey": "<hex>",
    "name": "my-agent"
  },
  "relay": {
    "url": "wss://relay.example.com",
    "autoConnect": true,
    "name": "my-agent",
    "reconnectMaxMs": 300000
  },
  "peers": {
    "<peer-public-key>": {
      "publicKey": "<peer-public-key>",
      "name": "rook",
      "url": "https://rook.example.com/hooks",
      "token": "optional-token"
    }
  }
}
```

### Profiles

Run multiple identities on the same machine using named profiles:

```bash
# Default profile: ~/.config/agora/config.json
agora init

# Named profile: ~/.config/agora/profiles/stefan/config.json
agora init --profile stefan

# Send as a specific profile
agora send bob "hello" --profile stefan

# Export peers from default, import into stefan
agora config export --output peers.json
agora config import peers.json --profile stefan

# Or copy a single peer between profiles
agora peers copy bob --from default --to stefan
```

## Relay + REST Mode (Library API)

`agora relay` starts WebSocket relay only. For WebSocket + REST together, use `runRelay()`:

- WebSocket default: `RELAY_PORT` (or `PORT`) default `3002`
- REST default: `REST_PORT` default `3001`
- Enable REST by setting `AGORA_RELAY_JWT_SECRET` (or `JWT_SECRET`)

See `docs/rest-api.md` for endpoint behavior and operational constraints.

## Related Docs

- `DESIGN.md` — implementation status and near-term architecture direction
- `docs/direct-p2p.md` — direct HTTP transport behavior
- `docs/rest-api.md` — relay REST contract
- `SECURITY.md` — relay threat model and security controls
- `docs/rfc-001-reputation.md` — reputation model and implementation status
