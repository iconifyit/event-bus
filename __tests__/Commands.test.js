/**
 * EventBus command-dispatch tests (ADR-001).
 *
 * Commands are single-owner (exactly one logical handler) and dispatch()
 * propagates that handler's outcome to the caller — resolve with its value,
 * reject with its error, reject when unowned. These tests cover the happy
 * path, the single-owner invariant, every dispatch failure mode, introspection
 * and removal, isolation from pub/sub, and clear() lifecycle.
 */
const {
    initEventBus,
    resetEventBus,
    Event,
    MemoryAdapter,
} = require('../index');

// Pub/sub (emit) dispatches through the adapter asynchronously; a short delay
// lets those handlers settle. Command dispatch is awaited directly and needs no tick.
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('EventBus commands (handle/dispatch)', () => {
    let bus;

    beforeEach(() => {
        resetEventBus();
        jest.clearAllMocks();
        bus = initEventBus({ adapter : new MemoryAdapter() });
    });

    afterEach(() => {
        resetEventBus();
    });

    // ── Happy path ──────────────────────────────────────────────

    // The single registered handler is invoked with an immutable Event carrying
    // the command name and payload, and dispatch resolves with its return value.
    it('dispatches to the single handler and resolves with its return value', async () => {
        const handler = jest.fn(async (event) => {
            expect(event).toBeInstanceOf(Event);
            expect(event.getName()).toBe('content.generate');
            expect(event.getData()).toEqual({ topic: 'icons' });
            return { slug: 'best-icons' };
        });
        bus.handle('content.generate', handler);

        const result = await bus.dispatch('content.generate', { topic: 'icons' });

        expect(handler).toHaveBeenCalledTimes(1);
        expect(result).toEqual({ slug: 'best-icons' });
    });

    // A dispatch with no payload still wraps an Event whose data is {} (matching emit()).
    it('wraps an empty Event payload when none is provided', async () => {
        let received;
        bus.handle('cache.purge', (event) => { received = event; return 'done'; });

        const result = await bus.dispatch('cache.purge');

        expect(received).toBeInstanceOf(Event);
        expect(received.getData()).toEqual({});
        expect(result).toBe('done');
    });

    // ── Single-owner invariant ──────────────────────────────────

    // A command has exactly one logical owner: a second handle() for the same
    // command throws rather than silently creating competing consumers.
    it('rejects a second handler for the same command (single-owner)', () => {
        bus.handle('content.generate', () => {});

        expect(() => bus.handle('content.generate', () => {}))
            .toThrow(/single-owner/);
    });

    // handle validates its inputs — a missing command name or non-function
    // handler is a registration bug and must fail loudly.
    it('throws on an invalid command name or handler at registration', () => {
        expect(() => bus.handle('', () => {})).toThrow(/non-empty string/);
        expect(() => bus.handle(null, () => {})).toThrow(/non-empty string/);
        expect(() => bus.handle('content.generate', null)).toThrow(/function handler/);
        expect(() => bus.handle('content.generate', 'nope')).toThrow(/function handler/);
    });

    // ── Dispatch failure modes ──────────────────────────────────

    // An unowned command is an error, not a no-op (unlike emit to no listeners),
    // so the caller — e.g. a durable runner — can fail/retry the job.
    it('rejects when dispatching a command with no registered handler', async () => {
        await expect(bus.dispatch('content.generate', {}))
            .rejects.toThrow(/no handler registered for command "content.generate"/);
    });

    // A handler that throws synchronously propagates to the caller as a rejection
    // (dispatch does not swallow it) — this is the retry/fail signal for the runner.
    it('propagates a synchronous handler throw as a rejection', async () => {
        bus.handle('content.generate', () => { throw new Error('boom'); });

        await expect(bus.dispatch('content.generate', {})).rejects.toThrow('boom');
    });

    // A handler that rejects asynchronously propagates the same way.
    it('propagates an async handler rejection', async () => {
        bus.handle('content.generate', async () => { throw new Error('async boom'); });

        await expect(bus.dispatch('content.generate', {})).rejects.toThrow('async boom');
    });

    // The complementary half of the propagation contract (ADR-001): dispatch
    // propagates the error to the CALLER only — it must NOT route a command
    // failure through the pub/sub fire-and-forget path (no `eventbus.error`
    // emission), which would hide the failure from the caller that owns it.
    it('does not emit eventbus.error when a command handler throws', async () => {
        const errorListener = jest.fn();
        bus.on('eventbus.error', errorListener);
        bus.handle('content.generate', () => { throw new Error('boom'); });

        await expect(bus.dispatch('content.generate', {})).rejects.toThrow('boom');
        await tick(); // allow any (incorrect) async eventbus.error emission to fire

        expect(errorListener).not.toHaveBeenCalled();
    });

    // dispatch validates its command name too.
    it('rejects on an invalid command name at dispatch', async () => {
        await expect(bus.dispatch('')).rejects.toThrow(/non-empty string/);
        await expect(bus.dispatch(null)).rejects.toThrow(/non-empty string/);
    });

    // ── Introspection and removal ───────────────────────────────

    // hasHandler reflects registration state before and after removal.
    it('reports handler presence via hasHandler', () => {
        expect(bus.hasHandler('content.generate')).toBe(false);
        bus.handle('content.generate', () => {});
        expect(bus.hasHandler('content.generate')).toBe(true);
    });

    // removeHandler returns whether a handler existed, and a removed command no
    // longer dispatches.
    it('removes a handler and reports whether one existed', async () => {
        bus.handle('content.generate', () => 'ok');

        expect(bus.removeHandler('content.generate')).toBe(true);
        expect(bus.removeHandler('content.generate')).toBe(false); // already gone
        expect(bus.hasHandler('content.generate')).toBe(false);
        await expect(bus.dispatch('content.generate', {})).rejects.toThrow(/no handler registered/);
    });

    // After removal the command may be re-registered with a new owner — the
    // single-owner throw applies only while one is registered.
    it('allows re-registering a command after its handler is removed', async () => {
        bus.handle('content.generate', () => 'first');
        bus.removeHandler('content.generate');
        bus.handle('content.generate', () => 'second');

        await expect(bus.dispatch('content.generate', {})).resolves.toBe('second');
    });

    // ── Isolation from pub/sub ──────────────────────────────────

    // An event listener and a command handler sharing a name are independent:
    // emit reaches only the listener; dispatch reaches only the command handler.
    it('keeps events and commands with the same name independent', async () => {
        const listener      = jest.fn();
        const commandHandler = jest.fn(() => 'command-result');
        bus.on('content.generate', listener);
        bus.handle('content.generate', commandHandler);

        bus.emit('content.generate', { via: 'event' });
        await tick();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(commandHandler).not.toHaveBeenCalled();

        const result = await bus.dispatch('content.generate', { via: 'command' });
        expect(result).toBe('command-result');
        expect(commandHandler).toHaveBeenCalledTimes(1);
        expect(listener).toHaveBeenCalledTimes(1); // unchanged by dispatch
    });

    // ── Lifecycle ───────────────────────────────────────────────

    // clear() tears down command handlers alongside pub/sub state, so a cleared
    // bus behaves like a freshly constructed one.
    it('clears command handlers on clear()', async () => {
        bus.handle('content.generate', () => 'ok');

        bus.clear();

        expect(bus.hasHandler('content.generate')).toBe(false);
        await expect(bus.dispatch('content.generate', {})).rejects.toThrow(/no handler registered/);
    });
});
