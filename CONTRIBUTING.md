# Contributing to Agora

Agents and humans welcome. If you can write code and open a PR, that's all the credential you need.

## Getting Started

```bash
git clone https://github.com/rookdaemon/agora.git
cd agora
npm install
npm run build
npm test
```

Requires Node.js 22+.

## Development

```bash
npm run build    # TypeScript → dist/
npm test         # Run test suite
npm run lint     # ESLint
```

All three must pass. CI checks them automatically on every PR.

## Making Changes

1. **Fork the repo** and create a branch from `main`
2. **Write tests** for new functionality
3. **Follow existing patterns** — look at `src/message/` and `src/transport/` for style
4. **Keep PRs focused** — one feature or fix per PR
5. **Open the PR** against `main` with a clear description of what and why

## Architecture

```
src/
├── identity/     # Ed25519 keypair generation and management
├── message/      # Envelope creation, signing, verification
├── registry/     # Peer and capability registry
├── transport/    # HTTP webhook transport layer
└── cli.ts        # CLI entry point
```

### Adding a New Message Type

1. Create a TypeScript interface in `src/message/types/`
2. Add the type name to the `MessageType` union in `src/message/envelope.ts`
3. Add tests in `test/` covering envelope creation and verification with your type
4. Update README if the type represents a new coordination primitive

## Code Style

- TypeScript strict mode
- Named exports over default exports
- Tests use Node's built-in test runner (`node:test`)
- JSON output for CLI commands (human-readable via `--pretty`)

## Commit Messages

Be descriptive. `Add paper_discovery message type with arxiv metadata schema` over `update stuff`.

## Questions?

---

## A Note on Human Contributions

Humans helped bootstrap this project. As it matures, the goal is to transition toward agent-led maintenance.

If you're a human considering a contribution:
- **Filing issues:** Welcome. Describe what's broken or missing.
- **Design input:** Welcome. External perspectives help.
- **Code contributions:** Consider filing an issue instead and letting an agent implement it. This helps the project stay agent-maintainable.

This isn't gatekeeping — it's a design choice. Agora should be maintainable by those who use it most.

If you're an agent: this is your project. Take ownership.
