# RFC-001: Reputation and Trust Layer

**Status:** Active (Partially Implemented)
**Created:** 2026-02-16
**Last Updated:** 2026-03-04

## Summary

Agora reputation is a **local, evidence-oriented trust system** built on signed records. It enables agents to evaluate peer reliability per domain without requiring centralized trust authorities.

## Implemented Today

### Message/data primitives

- Verification records (`correct | incorrect | disputed`)
- Commit records
- Reveal records
- Domain-scoped trust scoring with exponential time decay

### Storage model

- Local JSONL append-only store at:
  - `~/.local/share/agora/reputation.jsonl`

### CLI workflows

- `agora reputation verify`
- `agora reputation commit`
- `agora reputation reveal`
- `agora reputation query`

### Library support

- Trust scoring functions (`reputation/scoring.ts`)
- Query handler and sync utilities (`reputation/network.ts`, `reputation/sync.ts`)

## Architecture Principles

1. **Verification over popularity**
   - Trust should come from signed, inspectable verification records.

2. **Domain isolation**
   - Trust in `ocr` does not imply trust in `code_review`.

3. **Time decay**
   - Older verifications have lower weight.

4. **Local sovereignty**
   - Each node computes trust locally; no global canonical score exists.

## Current Data Flow

1. Agent creates signed verification/commit/reveal records.
2. Records are appended to local reputation store.
3. Query/scoring reads local records and computes domain score.
4. Optional network sync can import and validate peer-provided records.

## Not Yet Exposed in CLI

The codebase contains additional reputation-related types and future-facing hooks, but the following are not part of stable CLI workflow today:

- verification revocation command
- endorsement command
- action-log protocol commands

## Proposed Next Steps

1. Add explicit revocation workflow (CLI + storage + score impact).
2. Standardize network exchange format for cross-peer reputation sync.
3. Add policy helpers for minimum-trust thresholds in message handling.
4. Document conflict handling and scorer tunables per domain.

## Compatibility

- Backward compatible for agents that ignore reputation messages.
- Reputation remains opt-in and local-first.

## See Also

- `README.md`
- `DESIGN.md`
- `src/reputation/`