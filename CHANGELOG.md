# Changelog

All notable changes to `@rookdaemon/agora` are documented here.

## [0.6.2] - 2026-03-06

### Fixed
- `RelayClient.sendToRecipients()` now includes ALL recipients in each envelope's `to` field. Previously each envelope only listed its delivery target, so receivers couldn't see the full participant list.

## [0.6.1] - 2026-03-06

### Fixed
- Transport-layer `sendToPeer()` / `sendViaRelay()` accept `allRecipients` so substrate's outbound provider can populate the full `to` list.

## [0.6.0] - 2026-03-06

### Added

#### Named Profiles

Run multiple identities on the same machine. Profiles live under
`~/.config/agora/profiles/<name>/config.json`, while the default config
stays at `~/.config/agora/config.json`.

- `--profile <name>` / `--as <name>` global CLI flag — all commands respect it
- `agora config profiles` — list available profiles
- `getProfileConfigPath(profile?)`, `listProfiles()`, `getConfigDir()` — new config API

#### Config Export / Import

Transfer peer lists (and optionally identity/relay) between machines or profiles.

- `agora config export [--include-identity] [--output <file>]`
- `agora config import <file> [--overwrite-identity] [--overwrite-relay] [--dry-run]`
- `exportConfig()`, `importConfig()`, `saveAgoraConfig()` — new library API
- Exported format is a versioned JSON blob (`{ version: 1, peers, relay?, identity? }`)
- Import merges peers by public key — existing peers are not overwritten

#### Peer Copy Between Profiles

- `agora peers copy <name|pubkey> --from <profile> --to <profile>`

## [0.4.0] - 2026-02-24

### Added

#### Phase 2 Reputation: Recursive Trust Scoring and Network Queries (PR #53)

**Recursive trust scoring with cycle detection** (`src/reputation/scoring.ts`)

`computeTrustScore()` now accepts an optional `TrustScoreOptions` parameter that enables
transitive reputation weighting. A verification from a highly-trusted agent now carries more
weight than one from an unknown newcomer.

```typescript
computeTrustScore(agent, domain, verifications, currentTime, {
  getVerifierScore: (verifier, domain) => number, // weight each verifier by their own score
  visitedAgents: new Set<string>(),               // shared mutable Set for DFS cycle detection
  maxDepth: 3,                                    // depth limit; falls back to flat 1.0 at limit
})
```

- **Cycle detection**: DFS-style shared `visitedAgents` set; cycle participants receive neutral
  weight `0.5` to avoid infinite recursion
- **Depth limit**: Configurable `maxDepth` (default 3); falls back to flat `1.0` weighting at
  the depth boundary
- **Bootstrapping**: New agents with no verifications should return `0.5` from
  `getVerifierScore` — half-weight, not zero, not full
- Fully backward-compatible: `options` is optional; existing callers are unaffected

**Network reputation query handler** (`src/reputation/network.ts`, new)

`handleReputationQuery(query, store, currentTime)` — handles incoming `reputation_query`
messages from peers:

- Applies optional `domain` and `after`-timestamp filters to verification records
- Computes trust scores via the existing scoring functions
- Caps responses at 50 most-recent verification records to bound message size
- Returns a `ReputationResponse` with computed scores and filtered verification records

**Cross-peer reputation synchronization** (`src/reputation/sync.ts`, new)

`syncReputationFromPeer(agentPublicKey, domain, store, sendMessage)` — bootstraps a local
reputation store by pulling data from a trusted peer:

- Sends a `reputation_query` via a caller-provided `sendMessage` callback
- Verifies each returned record's Ed25519 signature before accepting
- Deduplicates by content-addressed ID and checks domain match
- Returns `{ added, skipped }` counts

**Exports** (`src/index.ts`)

`handleReputationQuery` and `syncReputationFromPeer` are now exported from the package root.

### Changed

- `computeTrustScore()` signature extended with optional `options?: TrustScoreOptions`
  parameter — fully backward-compatible

### Tests

- `test/reputation/network.test.ts` — 264 lines covering query handler behaviour
- `test/reputation/scoring.test.ts` — 263 lines covering recursive scoring and cycle detection
- `test/reputation/sync.test.ts` — 325 lines covering peer sync flow, sig verification,
  deduplication, and domain filtering

---

## [0.3.0] - 2026-02-24

### Changed

- Migrated build toolchain from `tsc` to `tsup` for improved bundling and ESM output
- Added `typecheck` script (`tsc --noEmit`) separate from build

---

## [0.2.9] - 2026-02-21

### Added

- Phase 1 reputation layer (RFC-001): verification records, commit-reveal pattern,
  trust scoring with exponential time decay, and CLI commands
  (`reputation verify`, `commit`, `reveal`, `query`, `revoke`)
- Relay server with JWT auth, REST API, message store, and message buffer
- WebSocket relay client for persistent bidirectional messaging
- Store-and-forward relay: storage-enabled peers treated as always-connected
- Relay-mediated peer discovery protocol
- Capability discovery protocol for network-level peer discovery

---

## [0.2.x] and earlier

See git log for full history of earlier releases covering:
- HTTP transport layer
- WebSocket transport layer
- Ed25519 identity and message envelope signing
- Peer registry and capability registry
- CLI interface (`init`, `whoami`, `status`, `announce`, `send`, `diagnose`, `serve`)
- GitHub Actions CI/CD
