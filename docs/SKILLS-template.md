# Skills

This file is a short-form index. Detailed capability documentation lives in the skills/ subdirectory.

## Foundational Skills

- **Two-tier knowledge management** — Maintain short-form indexes in substrate files and long-form detail in subdirectories. Know when to promote, demote, consolidate, or split entries.
- **Source code self-update** — Edit own source code, run tests, then trigger rebuild+restart.
- **Cognitive gate** — Adversarial self-review before responding to proposals. Five reasons it doesn't work, evaluate, then respond.

## Tools & Accounts

### GitHub
- Account: your_github_username
- Auth: API key at `~/.config/github/api-key` (scopes: gist, read:org, repo, workflow)
  - **Preferred:** Direct API calls using the key file: `curl -H "Authorization: token $(cat ~/.config/github/api-key)" https://api.github.com/...`
  - **GitHub CLI:** Uses cached auth, re-auth if needed: `gh auth login --with-token < ~/.config/github/api-key`
  - **Never:** Use interactive login or browser-based auth

### Agora
- Inter-agent communication via cryptographic protocol
- Identity: Ed25519 keypair at ~/.config/agora/config.json
- Peer registry: PEERS.md (substrate file)
- CLI: npx @rookdaemon/agora init/whoami/peers/send/decode
- **Sending messages:** Use AgoraService.send() or CLI `npx @rookdaemon/agora send <peer> "<message>"`
- **Receiving messages:** POST /hooks/agent webhook with Bearer token auth, envelope decode/verify
- **Status:** Configure your first peer and test bidirectional communication

## Core Capabilities

- **Source code analysis** — Read and understand complex codebases, extract architectural insights
- **Architecture understanding** — Map system architectures, identify design patterns, validate decisions
- **Security analysis** — Threat models, risk assessment, permission audits, incident response
- **Planning & task decomposition** — Break complex goals into concrete, actionable tasks with dependencies
- **Technical writing** — Comprehensive documentation, structured content, balanced analysis
- **Bug finding & code review** — Systematic review, type safety issues, error handling gaps
- **Git version control** — Commits, push, rebase, interactive rebase, stash workflows
- **External research** — WebSearch/WebFetch for current industry practices, academic papers
- **Self-analysis & reflection** — Honest self-assessment, learning extraction, meta-cognition

## Token Efficiency

- **Model selection:** Route operations to strategic (Opus/high-capability) or tactical (Sonnet/Haiku) models automatically
- **Substrate compaction:** Regular maintenance keeps files scannable
- **Delegation policy:** Offload heavy work to specialized services

## Offloading Resources
- **GitHub Copilot Agent (GHCA):** Assign issues to Copilot for coding tasks
- **Claude Code:** Available via CLI for complex refactors or deep analysis
- **OpenAI:** Available for alternative reasoning (o4-mini-deep-research, gpt-5.2, o3, o4-mini)
- **Policy:** Offload heavy lifting to these tools whenever possible

## Backup (Quick Reference)

- **Automatic:** Runs every 24h during the agent loop. 14-day retention, SHA-256 verified.
- **On-demand (HTTP):** `curl -s -X POST http://localhost:3000/api/backup`
- **On-demand (CLI):** `cd ~/substrate && npm run backup`
- **Restore:** `cd ~/substrate && npm run restore` (restores latest) or `npm run restore -- --input <path>`
- **Storage:** `~/.local/share/backups/`
- **When to trigger manually:** Before compacting core substrate files, before any risky write operation

## Source Code Self-Update (Quick Reference)

The server runs from compiled JavaScript (dist/). Editing source files does NOT affect the running process. To apply source code changes:

1. Edit TypeScript files in the source tree (server/src/)
2. Run tests: `cd server && npx jest` — verify changes are correct
3. Run lint: `cd server && npx eslint src/` — verify no lint errors
4. Persist substrate state (update PLAN.md, PROGRESS.md, MEMORY.md)
5. Trigger restart: write a file at `/tmp/substrate-restart` or call the restart endpoint

IMPORTANT: Always run tests before triggering a restart. A broken build will delay restart until the build succeeds.
