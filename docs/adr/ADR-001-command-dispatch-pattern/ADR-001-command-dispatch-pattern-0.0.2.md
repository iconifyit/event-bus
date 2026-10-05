# ADR-001: Command Dispatch Pattern for EventBus (single-owner handle/dispatch)

- **Status:** Accepted
- **Date:** 2026-10-05
- **Deciders:** Scott Lewis
- **Supersedes:** [ADR-001 0.0.1](./ADR-001-command-dispatch-pattern-0.0.1.md) (Proposed, with three open questions — now resolved below)
- **Package:** `@vectoricons.net/event-bus` (1.4.6 at time of writing; releases as 1.5.0 — see Versioning & publish)
- **Implemented by:** PR #6 (`feat: command dispatch pattern for EventBus`)

## Context

`EventBus` implemented **pub/sub only**. Every registration path — `on`, `once`, `emit`, and the awaited `emitSync` — fans a single event out to **zero-to-many** independent listeners. That models a *fact*: "something happened; any interested component may react."

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

- **`handle(command, handler)`** — register the single handler that owns `command`. A second `handle()` for the same command **throws** (the single-owner invariant, enforced at registration, not silently ignored). Validates that `command` is a non-empty string and `handler` is a function.
- **`dispatch(command, payload)` → `Promise`** — invoke the one registered handler with an `Event`-wrapped payload (consistent with `emit`), `await` it, and:
  - **resolve** with the handler's return value on success;
  - **reject** by propagating the handler's error on failure (so the caller can retry / fail the job);
  - **reject** if **no handler is registered** — an unowned command is an error, unlike an `emit` to no listeners.
- **`hasHandler(command)`** — `true` if a handler is registered for the command.
- **`removeHandler(command)`** — remove the command's handler; returns `true` if one existed, `false` otherwise.

### Semantics

- **In-process and single-owner.** Commands do **not** go through the pub/sub adapter (whose contract is multi-listener fan-out). The command registry is a direct `Map<command, handler>` on the bus. Distributing or durably executing commands is the execution layer's job, not the bus's.
- **Error propagation, not swallowing.** `dispatch` propagates the handler's error to the caller — unlike `emit`'s `safeRun` envelope, which catches, notifies, and re-emits `eventbus.error` for fire-and-forget listeners. The command caller owns failure handling; notifiers remain a pub/sub concern.
- **Not "exactly-once."** The bus provides *single-owner dispatch with outcome propagation* — nothing more. It does **not** provide scheduling, persistence, retries, timeouts, concurrency, or exactly-once execution; those belong to the execution layer (pg-boss) in the consumer. The honest model is: **exactly one registered logical handler + at-least-once execution attempts (driven upstream) + idempotent handlers where side effects require it.** These three are distinct concerns and must not be conflated.
- **`clear()`** tears down the command registry alongside the pub/sub state, so a cleared bus behaves like a freshly constructed one.

### Boundary (what this ADR does NOT do)

- **No scheduler, no pg-boss, no new dependency in the package.** The package stays transport- and scheduler-agnostic. pg-boss integration — a durable job whose function calls `bus.dispatch(command, payload)` and resolves/rejects the job on the outcome — lives in the **consumer** (the api) and is governed there. This preserves the separation: EventBus owns application dispatch semantics; pg-boss owns durable execution mechanics.

## Resolved decisions (from 0.0.1 open questions)

1. **Deregistration/introspection names — `removeHandler(command)` and `hasHandler(command)`.** Verb-first and symmetric with the rest of the API; no better fit emerged from the library's conventions.
2. **`dispatch` wraps the payload in an `Event`** — yes, for consistency with `emit`; handlers receive an immutable `Event` and read it via `getData()` / `getName()`, exactly as event listeners do.
3. **Command handlers get pure error propagation, no notifier hook.** The caller (a durable runner) owns failure handling and needs the raw outcome; routing a command failure through the fire-and-forget notifier/`eventbus.error` path would hide it from the caller. Notifiers remain a pub/sub concern. Revisit only if a concrete need appears.

## Alternatives considered

1. **Reuse `emitSync` for commands.** Rejected: it fans out to all subscribers, has no single-owner guarantee, and treats "no subscriber" as a soft `false` rather than an error. It conflates facts (events) with intents (commands).
2. **A pg-boss-backed pub/sub adapter mapping listeners onto workers.** Rejected: the adapter contract is fan-out (`on/off/once/emit/clear`); a work queue is one-worker-from-a-pool. The semantics differ; mapping listeners onto workers would quietly break both. pg-boss integrates via the command path in the consumer, not as a pub/sub adapter.
3. **Put scheduling/durability/retries in the package.** Rejected: that collapses EventBus into pg-boss and violates the narrow-layer boundary. The package gains command *semantics* only.

## Consequences

**Positive:** a correct primitive for scheduled/queued work; a clean event-vs-command (CQRS-style) distinction that reads clearly at the call site; the package stays dependency-free and reusable; pg-boss stays in the consumer; and outcome propagation is exactly what a durable runner needs to drive retries. Existing pub/sub behavior is untouched (the diff removes no pub/sub lines), so current consumers are unaffected.

**Negative / trade-offs:** net-new API surface plus its tests; a **minor version bump** (1.4.6 → 1.5.0) and an npm publish to release it; consumers must adopt `handle`/`dispatch` to use commands; and the single-owner `throw`-on-duplicate is a new behavior (but only on the new API — pub/sub is unchanged).

## Implementation

Implemented in **PR #6** on `claude/adr-001-command-dispatch-pattern`:

- `src/EventBus.js` — a `commandHandlers` Map in the constructor; the `handle`, `dispatch`, `hasHandler`, `removeHandler` methods; `clear()` resets the command map. No pub/sub lines removed or changed.
- `__tests__/Commands.test.js` — 16 cases: happy path, single-owner throw, input validation, every dispatch failure mode (no handler, sync throw, async reject, invalid name), introspection/removal/re-registration, pub/sub isolation, and `clear()` lifecycle.
- Full suite: 148/148 green; the new file runs under the standard `npm test` (jest) in CI.

See [`imp/ADR-001-command-dispatch-pattern-implementation-plan.md`](./imp/ADR-001-command-dispatch-pattern-implementation-plan.md).

## Code being removed

**None.** Purely additive to the package. (The branch also deletes the repo-local `.agents/` directory — unrelated housekeeping; the agent definitions are now maintained globally — in its own commit.)

## Versioning & publish

The change is additive and backward-compatible, so it releases as a **minor** bump, **1.4.6 → 1.5.0**. Per the repo-versioning rule, the bump is **not** applied on this feature PR (feature → `develop`), which is a non-release PR; it is applied on the **release PR** (`develop` → `main`) together with the npm publish. **Publishing is the maintainer's explicit action** and is not performed as part of this work. `package.json` therefore remains `1.4.6` on this branch by design.

Per `adr-required` / `how-to-use-adrs`, this version is Accepted and its implementation plan lives in `imp/`.
