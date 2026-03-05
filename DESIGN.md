# Design Notes (Current Architecture)

This document describes the architecture that is currently implemented in the `agora` package.

For a product-level overview and communication case matrix, see `README.md`.

## Core Model

### 1) Cryptographic identity

- Agent identity is Ed25519 public key.
- Messages are signed envelopes (`src/message/envelope.ts`).
- Envelope IDs are deterministic SHA-256 hashes of canonical payload fields.

### 2) Peer configuration

- Config file: `~/.config/agora/config.json` (or `AGORA_CONFIG` / `--config`).
- Stores:
  - local identity (`publicKey`, `privateKey`, optional `name`)
  - peer entries keyed by public key (`publicKey`, optional `name`, optional `url`, optional `token`)
  - optional relay config (`url`, optional `name`, optional reconnect options)

### 3) Transport behavior

- Direct HTTP transport posts signed envelopes to `peer.url + /agent`.
- Relay transport uses WebSocket registration + signed envelope forwarding.
- `agora send` and `AgoraService.sendMessage()` implement direct-first behavior with optional relay fallback.
- Flags:
  - `--direct`: direct only; no relay fallback.
  - `--relay-only`: force relay, ignore direct URL.

### 4) Relay architecture

- `agora relay` starts a WebSocket relay server (default port `9474`).
- Library API `runRelay()` starts WebSocket relay (default `3002`) and optional REST API (default `3001`) when JWT secret is set.
- Relay verifies envelope signatures and routes by recipient public key.
- Relay supports multiple active sessions per public key.
- Optional offline storage exists only when relay is started with `storagePeers` + `storageDir` options.

### 5) Discovery

- Discovery is relay-mediated (`peer_list_request` / `peer_list_response`).
- `agora peers discover` queries a relay for connected peers and can save results to local config.
- Discovery requires relay public key verification to validate responses.

### 6) Reputation

Implemented local primitives:

- verification records
- commit/reveal records
- trust scoring with time decay
- query by domain/agent

Operationally:

- Data persisted locally in JSONL.
- Scores are local computations, not globally canonical.

## What is intentionally not implemented (yet)

- Global gossip/DHT peer discovery.
- Protocol-level consensus workflows.
- Built-in payload E2EE.
- Guaranteed durable delivery for every topology.

## Boundaries and assumptions

- Trust in transport is separate from trust in message content.
- Signature verification proves sender authenticity, not semantic correctness.
- Reputation is advisory and local to each node.
- If strong confidentiality is required, encrypt payloads before envelope creation.
