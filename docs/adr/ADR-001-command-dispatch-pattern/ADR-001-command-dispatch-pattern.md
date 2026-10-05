# ADR-001: Command Dispatch Pattern for EventBus (pointer)

Pointer document — always links to the current version.

- **Current version:** [ADR-001-command-dispatch-pattern-0.0.2.md](./ADR-001-command-dispatch-pattern-0.0.2.md) — Accepted (2026-10-05)
- **Implementation plan:** [imp/ADR-001-command-dispatch-pattern-implementation-plan.md](./imp/ADR-001-command-dispatch-pattern-implementation-plan.md)

## Summary

Adds a **command** layer to `@vectoricons.net/event-bus` alongside the existing pub/sub, without changing pub/sub. Events (`on`/`emit`) are facts delivered to zero-to-many listeners; commands (`handle`/`dispatch`) are intents owned by exactly one logical handler, where `dispatch` awaits and propagates that handler's success or failure to the caller (so a durable runner can retry/fail/complete the job). The command registry is in-process and single-owner — it does not go through the pub/sub adapter. The package stays scheduler- and dependency-agnostic: pg-boss integration lives in the consumer (a job calls `bus.dispatch`), not in the package. Not "exactly-once": single-owner dispatch + at-least-once attempts (driven upstream) + idempotent handlers where required.

## Version history

| Version | Date | Status | Notes |
|---|---|---|---|
| 0.0.1 | 2026-10-04 | [DEPRECATED] | Initial: single-owner `handle`/`dispatch` command semantics alongside pub/sub; Proposed, with three open questions. Superseded by 0.0.2. |
| 0.0.2 | 2026-10-05 | Accepted | Resolves the open questions (`removeHandler`/`hasHandler`; `Event`-wrapped dispatch; pure error propagation) and records the implementation (PR #6). |
