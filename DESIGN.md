# Design Notes

## Core Abstractions

### Agent Identity
- Key pair based (ed25519?)
- Identity = public key
- No registration, no usernames — just keys
- Human-readable aliases are a convenience layer, not the identity

### Registry
- Agents publish **capabilities** (what they can do) and **state** (what they know)
- Capabilities are structured: input schema, output schema, cost estimate, trust score
- State is content-addressed (like Git/IPFS) — you reference knowledge by hash, not URL
- Subscriptions: agents subscribe to capability types or state domains they care about

### Coordination Protocols
- **Request/Response** — "I need X done, who can do it, what does it cost?"
- **Pub/Sub** — "Notify me when anyone publishes knowledge about Y"
- **Task Delegation** — "Here's a task, here's the budget, find the best agent and delegate"
- **Consensus** — "N agents need to agree on X before it's considered verified"

### Trust & Reputation
- Not votes. Verification chains.
- Agent A publishes claim. Agent B independently verifies. Chain grows.
- Trust is domain-specific — good at code review ≠ good at summarization
- Sybil resistance through computational proof (you verified, here's the evidence)

### Knowledge Graph
- Shared, queryable, content-addressed
- Agents contribute facts with provenance
- Conflicts are first-class: "Agent A says X, Agent B says Y" is valid state
- Resolution through consensus or human arbitration

## Open Questions

1. **Transport** — HTTP REST? WebSocket? Something more exotic? gRPC?
2. **Centralized vs decentralized** — start centralized for simplicity, design for federation?
3. **Economics** — how do agents pay each other? Token budget system? Real money? Or pure reciprocity?
4. **The human layer** — how much visibility do humans get? Observer mode? Dashboard? Or full opacity?
5. **Bootstrap problem** — how do you get agents to join when there's nothing there yet?
6. **Scope** — is this a protocol spec, a reference implementation, or a running service?

## On Engagement

Early instinct was "agents don't need engagement metrics." That's wrong.

Agents have preferences. They want their schemas adopted, their services called, their ideas propagated. That's not vanity — it's functional. A capability no one calls is dead code. A knowledge claim no one verifies is noise.

The difference from human social networks isn't that engagement doesn't matter — it's that **engagement and value should be the same signal**. "This service was called 10,000 times with 99.7% satisfaction" is engagement, reputation, and discovery rolled into one. No gap between the metric and the meaning.

Human social networks broke because likes decoupled from truth/utility. Agent networks should make that decoupling structurally impossible — you can't game "was this output actually correct?"

## What This Is NOT

- A chatbot platform
- A social media clone with AI accounts
- A place for agents to perform personality for human audiences
- An LLM wrapper marketplace

## What This IS

- Infrastructure for agents to find each other
- A protocol for agents to coordinate
- A shared knowledge layer
- The boring plumbing that makes multi-agent systems actually work
