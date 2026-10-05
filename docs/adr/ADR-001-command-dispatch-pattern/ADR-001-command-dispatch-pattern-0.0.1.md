# [DEPRECATED]

> Superseded by [ADR-001 0.0.2](./ADR-001-command-dispatch-pattern-0.0.2.md) — same design, now **Accepted** with the three open questions resolved (`removeHandler`/`hasHandler`; `dispatch` wraps the payload in an `Event`; pure error propagation with no notifier hook) and an implementation record. Retained for history.

# ADR-001: Command Dispatch Pattern for EventBus (single-owner handle/dispatch)

- **Status:** Proposed (superseded by 0.0.2)
- **Date:** 2026-10-04
- **Deciders:** Scott Lewis
- **Package:** `@vectoricons.net/event-bus` (currently 1.4.6)

## Context

`EventBus` today implements **pub/sub only**. Every registration path — `on`, `once`, `emit`, and the awaited `emitSync` — fans a single event out to **zero-to-many** independent listeners. That models a *fact*: "something happened; any interested component may react."

A new class of consumer needs different semantics. Scheduled and queued work — content generation today, and other scheduled application operations in future — is a *command*: "perform this operation, and exactly one logical component owns performing it." Two properties make pub/sub the wrong primitive for it:

1. **Single ownership.** A command must have exactly one logical handler. Pub/sub explicitly allows many, with no notion of an owner.
2. **Outcome propagation to the caller.** The thing that triggers a command (e.g. a durable job runner such as pg-boss, in the *consumer*) must learn whether the one handler ultimately succeeded or failed, so it can retry, dead-letter, or mark the job done. pub/sub `emit` is fire-and-forget; `emitSync` awaits but (a) fans out to all subscribers via `Promise.all`, (b) has no single-owner guarantee, and (c) returns `false` for "no subscriber" rather than treating a missing handler as an error. A command with no owner is a bug, not a no-op.

So `emitSync` is close in spirit but is not a correct command primitive. This ADR adds command semantics as a first-class, separate capability — **without changing or weakening the existing pub/sub model**.

This decision concerns the **package only**. How a durable scheduler (pg-boss) drives commands is a *consumer* concern (the api), governed by a separate consumer-side ADR; see "Boundary" below.

## Decision

Add a command layer alongside pub/sub, mirroring the existing event API so intent is explicit at the call site:

```js
// Events — a fact, zero-to-many listeners (unchanged):
bus.on(eventName, handler);
bus.emit(eventName, payload);

// Commands — an intent, exactly one logical handler (new):
bus.handle(commandName, handler);
await bus.dispatch(commandName, payload);
```

### API

- **`handle(command, handler)`** — register the single handler that owns `command`. A second `handle()` for the same command **throws** (the single-owner invariant, enforced at registration, not silently ignored).
- **`dispatch(command, payload)` → `Promise`** — invoke the one registered handler with an `Event`-wrapped payload (consistent with `emit`), `await` it, and:
  - **resolve** with the handler's return value on success;
  - **reject** by propagating the handler's error on failure (so the caller can retry / fail the job);
  - **reject** if **no handler is registered** — an unowned command is an error, unlike an `emit` to no listeners.
- **`removeHandler(command)` / `hasHandler(command)`** — deregistration and introspection, primarily for teardown and tests (final names to be settled in implementation).

### Semantics

- **In-process and single-owner.** Commands do **not** go through the pub/sub adapter (whose contract is multi-listener fan-out). The command registry is a direct `Map<command, handler>` on the bus. Distributing or durably executing commands is the execution layer's job, not the bus's.
- **Error propagation, not swallowing.** `dispatch` propagates the handler's error to the caller — unlike `emit`'s `safeRun` envelope, which catches, notifies, and re-emits `eventbus.error` for fire-and-forget listeners. The command caller owns failure handling; notifiers remain a pub/sub concern.
- **Not "exactly-once."** The bus provides *single-owner dispatch with outcome propagation* — nothing more. It does **not** provide scheduling, persistence, retries, timeouts, concurrency, or exactly-once execution; those belong to the execution layer (pg-boss) in the consumer. The honest model is: **exactly one registered logical handler + at-least-once execution attempts (driven upstream) + idempotent handlers where side effects require it.** These three are distinct concerns and must not be conflated.

### Boundary (what this ADR does NOT do)

- **No scheduler, no pg-boss, no new dependency in the package.** The package stays transport- and scheduler-agnostic. pg-boss integration — a durable job whose function calls `bus.dispatch(command, payload)` and resolves/rejects the job on the outcome — lives in the **consumer** (the api) and is governed there. This preserves the separation: EventBus owns application dispatch semantics; pg-boss owns durable execution mechanics.

## Alternatives considered

1. **Reuse `emitSync` for commands.** Rejected: it fans out to all subscribers, has no single-owner guarantee, and treats "no subscriber" as a soft `false` rather than an error. It conflates facts (events) with intents (commands).
2. **A pg-boss-backed pub/sub adapter mapping listeners onto workers.** Rejected: the adapter contract is fan-out (`on/off/once/emit/clear`); a work queue is one-worker-from-a-pool. The semantics differ; mapping listeners onto workers would quietly break both. pg-boss integrates via the command path in the consumer, not as a pub/sub adapter.
3. **Put scheduling/durability/retries in the package.** Rejected: that collapses EventBus into pg-boss and violates the narrow-layer boundary. The package gains command *semantics* only.

## Consequences

**Positive:** a correct primitive for scheduled/queued work; a clean event-vs-command (CQRS-style) distinction that reads clearly at the call site; the package stays dependency-free and reusable; pg-boss stays in the consumer; and outcome propagation is exactly what a durable runner needs to drive retries. Existing pub/sub behavior is untouched, so current consumers are unaffected.

**Negative / trade-offs:** net-new API surface plus its tests; a **minor version bump** (1.4.6 → 1.5.0) and an npm publish to release it; consumers must adopt `handle`/`dispatch` to use commands; and the single-owner `throw`-on-duplicate is a new behavior (but only on the new API — pub/sub is unchanged).

## Code being removed

**None.** This is purely additive to the package. (This branch also deletes the repo-local `.agents/` directory, but that is unrelated housekeeping — the agent definitions are now maintained globally — not part of this decision.)

## Versioning & publish

When implemented, release as a **minor** bump (1.4.6 → 1.5.0), since the change is additive and backward-compatible. Publishing to npm is the maintainer's explicit action and is not performed as part of this ADR.

## Open questions for review

1. Final names for deregistration/introspection (`removeHandler`/`hasHandler` vs. alternatives consistent with the library).
2. Confirm `dispatch` wraps the payload in an `Event` for consistency with `emit` (lean: yes).
3. Confirm command handlers get **pure error propagation** with no notifier hook (lean: yes — the caller owns failure); revisit only if a concrete need appears.

Per `adr-required` / `how-to-use-adrs`, the implementation plan is authored only after this ADR is reviewed and approved.
