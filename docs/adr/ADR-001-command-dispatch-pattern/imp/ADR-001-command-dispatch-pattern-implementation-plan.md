# ADR-001 Implementation Plan — Command Dispatch Pattern for EventBus

- **Governs:** [ADR-001 0.0.2](../ADR-001-command-dispatch-pattern-0.0.2.md) (Accepted, 2026-10-05)
- **Repo:** `@vectoricons.net/event-bus` (`iconifyit/event-bus`)
- **Delivered by:** PR #6 on `claude/adr-001-command-dispatch-pattern`
- **Scope contract:** *Add single-owner command semantics to EventBus alongside the untouched pub/sub, with tests — and nothing else.*

## Steps

1. **Command registry.** Add a `commandHandlers` `Map<command, handler>` to the `EventBus` constructor, separate from the pub/sub maps and the adapter.
2. **`handle(command, handler)`.** Validate inputs (non-empty string command, function handler); throw if a handler is already registered for the command (single-owner invariant); store it.
3. **`dispatch(command, payload)`.** Validate the command name; reject if no handler is registered; otherwise invoke the single handler with `Event.create(command, payload)`, `await` it, and return its value. Errors propagate (no `safeRun`, no notifier dispatch).
4. **`hasHandler` / `removeHandler`.** Introspection and teardown over the command map.
5. **`clear()`.** Reset `commandHandlers` alongside the existing pub/sub state.
6. **Tests** (`__tests__/Commands.test.js`): happy path; single-owner throw; input validation; dispatch failure modes (no handler, sync throw, async reject, invalid name); introspection/removal/re-registration; pub/sub isolation (same name, independent); `clear()` lifecycle.

## Boundaries honored

- Pub/sub (`on`/`off`/`once`/`emit`/`emitSync`) is unchanged — the diff removes no pub/sub lines.
- No new dependency; no pg-boss. pg-boss integration is a consumer-side concern (the api), governed separately.

## Verification

- `npm test` (jest): full suite **148/148 green**, including the 16 new command cases; the new file is picked up by the standard CI test run.

## Versioning & publish (release step — maintainer)

- Releases as a **minor** bump, **1.4.6 → 1.5.0**. Per the repo-versioning rule, the bump is applied on the **release PR** (`develop` → `main`), not on this feature PR, together with the **npm publish** — both the maintainer's explicit action. `package.json` stays `1.4.6` on this branch by design.

## Follow-ups (non-blocking)

- README API Reference: add the command methods (done in PR #6). The pre-existing omission of `emitSync`/`onInterval` from the README is out of scope here.
