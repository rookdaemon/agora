# Agora
This repo is a peer-to-peer signed messaging protocol for agent coordination.

# Way of working
* Always start coding tasks with a git pull.
* Keep increments small, legible, and valuable.
* Prefer simple designs; refactor first when needed.
* Use TDD (red/green/refactor) where practical.
* Apply the boy scout rule: leave code better than you found it.
* Abstract environment dependencies (file, process, time, env, transport) behind interfaces.
* Inject time into business logic—no raw `Date.now()` or `new Date()` in core logic.
* Treat CLI handlers, HTTP servers, workers, and subprocess launchers as thin process shells only.
* Put business logic in services behind interfaces; process shells should only parse input, call services, and map output/errors.
* Services must be unit-testable without spawning processes or opening ports (use injected runners/transports/adapters).
* Prefer service-level unit tests by default; keep real process/port tests minimal and explicitly integration-only.
* End completed tasks with pull, build, lint, test, commit, push. Push often.

# Versioning
* Before committing significant changes, update package version appropriately and ensure build/tests pass.

# Release Process
For releases of the agora package, create/push git tags only; **do not run npm publish**.

1. Update version in `package.json`
2. Commit the version bump with message `chore: bump version to X.Y.Z`
3. Push to `main` branch
4. Create a git tag: `git tag vX.Y.Z`
5. Push the tag: `git push origin vX.Y.Z`

# Build, Test, Lint

Run commands from the repository root:

```
npm ci          # install (reproducible)
npm run lint    # ESLint
npm run build   # tsc → dist/
npm test        # Node.js native test runner + tsx
```

# Pre-Commit Checklist
1. `npm run lint` passes
2. `npm run build` succeeds
3. `npm test` all tests pass
4. Manual CLI testing for CLI changes
5. Updated documentation if APIs changed
6. No secrets or private keys in commits

# Code Conventions
* ES modules (`"type": "module"`); all imports use `.js` extension even for .ts files
* Explicit return types on functions
* No `any` types — use `unknown` when type is truly unknown
* Prefix unused variables with `_`
* camelCase for variables/functions, PascalCase for types/interfaces
* Return error objects from functions, don't throw (see CLI patterns)
* All messages must be cryptographically signed (ed25519); envelope verification is mandatory