# ADR-001: Command Dispatch Pattern for EventBus (pointer)

Pointer document — always links to the current version.

- **Current version:** [ADR-001-command-dispatch-pattern-0.0.1.md](./ADR-001-command-dispatch-pattern-0.0.1.md) — Proposed (2026-10-04)

## Summary

Adds a **command** layer to `@vectoricons.net/event-bus` alongside the existing pub/sub, without changing pub/sub. Events (`on`/`emit`) are facts delivered to zero-to-many listeners; commands (`handle`/`dispatch`) are intents owned by exactly one logical handler, where `dispatch` awaits and propagates that handler's success or failure to the caller (so a durable runner can retry/fail/complete the job). The command registry is in-process and single-owner — it does not go through the pub/sub adapter. The package stays scheduler- and dependency-agnostic: pg-boss integration lives in the consumer (a job calls `bus.dispatch`), not in the package. Not "exactly-once": single-owner dispatch + at-least-once attempts (driven upstream) + idempotent handlers where required.

## Version history

| Version | Date | Status | Notes |
|---|---|---|---|
| 0.0.1 | 2026-10-04 | Proposed | Initial: single-owner `handle`/`dispatch` command semantics alongside pub/sub. |
