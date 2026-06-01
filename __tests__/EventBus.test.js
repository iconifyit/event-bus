/**
 * EventBus core tests.
 *
 * Tests cover: on/off/once/emit, two-tier error handling (plugin errorHandler
 * + eventbus.error emission), recursion guard, clear, missing arguments,
 * and Event immutability.
 */
const {
    initEventBus,
    resetEventBus,
    Event,
    MemoryAdapter,
} = require('../index');

// Small delay to allow async handlers to settle
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('EventBus', () => {
    let bus;

    beforeEach(() => {
        resetEventBus();
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});

        bus = initEventBus({
            adapter : new MemoryAdapter(),
        });
    });

    afterEach(() => {
        console.error.mockRestore();
        resetEventBus();
    });

    // Scenario: A registered handler receives the emitted event payload
    it('should register and emit an event', async () => {
        const handler = jest.fn();
        bus.on('user.signup', handler);
        bus.emit('user.signup', { email: 'john@vectoricons.net' });

        await tick();

        expect(handler).toHaveBeenCalledTimes(1);
        const event = handler.mock.calls[0][0];
        expect(event).toBeInstanceOf(Event);
        expect(event.getName()).toBe('user.signup');
        expect(event.getData()).toEqual({ email: 'john@vectoricons.net' });
    });

    // Scenario: Event data is frozen and cannot be mutated by handlers.
    // We assert the value is unchanged rather than expecting a throw,
    // because in non-strict mode frozen-property assignments fail silently.
    it('should emit immutable Event objects', async () => {
        const handler = jest.fn((event) => {
            const original = event.getData().email;
            try { event.data.email = 'hacked'; } catch (_) { /* strict mode throws */ }
            expect(event.getData().email).toBe(original);
        });
        bus.on('user.signup', handler);
        bus.emit('user.signup', { email: 'john@vectoricons.net' });

        await tick();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: A handler removed via off() should not be called on subsequent emits
    it('should remove a registered handler via off()', async () => {
        const handler = jest.fn();
        bus.on('order.confirmation', handler);
        bus.off('order.confirmation', handler);
        bus.emit('order.confirmation', { orderId: 'ord-001' });

        await tick();

        expect(handler).not.toHaveBeenCalled();
    });

    // Scenario: A once() handler fires on the first emit and is auto-removed for the second
    it('should only fire once for once()', async () => {
        const handler = jest.fn();
        bus.once('user.login', handler);
        bus.emit('user.login', { userId: 1 });
        bus.emit('user.login', { userId: 2 });

        await tick();

        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].getData()).toEqual({ userId: 1 });
    });

    // Scenario: Calling on/off/once/emit with missing args should not throw
    it('should not throw on missing arguments', () => {
        expect(() => bus.on()).not.toThrow();
        expect(() => bus.on('event.name')).not.toThrow();
        expect(() => bus.off()).not.toThrow();
        expect(() => bus.off('event.name')).not.toThrow();
        expect(() => bus.once()).not.toThrow();
        expect(() => bus.once('event.name')).not.toThrow();
        expect(() => bus.emit()).not.toThrow();
    });

    // Scenario: emit() with no event name returns false, with an event name returns true
    it('should return true/false from emit() based on event name', () => {
        expect(bus.emit()).toBe(false);
        expect(bus.emit(null)).toBe(false);
        expect(bus.emit('some.event', {})).toBe(true);
    });

    // Scenario: A handler that throws with no errorHandler emits eventbus.error
    it('should emit eventbus.error when handler throws and no errorHandler exists', async () => {
        const errorListener = jest.fn();
        bus.on('eventbus.error', errorListener);

        const failingHandler = jest.fn(() => {
            throw new Error('Handler exploded');
        });

        bus.on('order.failed', failingHandler);
        bus.emit('order.failed', { orderId : 'ord-broken' });

        await tick();

        expect(console.error).toHaveBeenCalled();
        expect(errorListener).toHaveBeenCalledTimes(1);

        const errorEvent = errorListener.mock.calls[0][0];
        expect(errorEvent.getData().error).toBeInstanceOf(Error);
        expect(errorEvent.getData().error.message).toBe('Handler exploded');
        expect(errorEvent.getData().eventName).toBe('order.failed');
    });

    // Scenario: A plugin errorHandler that returns the error triggers eventbus.error
    it('should emit eventbus.error when plugin errorHandler returns an Error', async () => {
        const errorListener = jest.fn();
        bus.on('eventbus.error', errorListener);

        const failingHandler = jest.fn(() => {
            throw new Error('SMTP timeout');
        });

        // errorHandler returns the error → escalate
        const errorHandler = jest.fn((error) => error);

        bus.on('mail.send', failingHandler, {
            pluginName   : 'mailer',
            errorHandler,
        });

        bus.emit('mail.send', { to : 'user@vectoricons.net' });

        await tick();

        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorListener).toHaveBeenCalledTimes(1);
        expect(errorListener.mock.calls[0][0].getData().pluginName).toBe('mailer');
    });

    // Scenario: A plugin errorHandler that returns undefined swallows the error
    it('should swallow error when plugin errorHandler returns non-Error', async () => {
        const errorListener = jest.fn();
        bus.on('eventbus.error', errorListener);

        const failingHandler = jest.fn(() => {
            throw new Error('Transient SMTP failure');
        });

        // errorHandler returns undefined → swallow
        const errorHandler = jest.fn(() => undefined);

        bus.on('mail.send', failingHandler, {
            pluginName   : 'mailer',
            errorHandler,
        });

        bus.emit('mail.send', { to : 'user@vectoricons.net' });

        await tick();

        expect(errorHandler).toHaveBeenCalledTimes(1);
        expect(errorListener).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalled(); // console.error always fires
    });

    // Scenario: clear() removes all listeners so subsequent emits are not received
    it('should clear all listeners', async () => {
        const handler = jest.fn();
        bus.on('clear.event', handler);
        bus.clear();
        bus.emit('clear.event', { cleared: true });

        await tick();

        expect(handler).not.toHaveBeenCalled();
    });

    // Scenario: Multiple handlers on the same event should all be called
    it('should support multiple handlers on the same event', async () => {
        const handlerA = jest.fn();
        const handlerB = jest.fn();
        bus.on('multi.event', handlerA);
        bus.on('multi.event', handlerB);
        bus.emit('multi.event', { value: 'shared' });

        await tick();

        expect(handlerA).toHaveBeenCalledTimes(1);
        expect(handlerB).toHaveBeenCalledTimes(1);
    });

    // Scenario: registering the same (event, handler) pair a second time is
    // a no-op. Without dedup, emit() (via mitt) would fire the handler twice
    // while emitSync() would fire it once — inconsistent. Dedup keeps both
    // paths aligned and matches normal pub/sub semantics.
    it('should reject duplicate on() registrations of the same (event, handler) pair', async () => {
        const handler = jest.fn();
        bus.on('dedup.event', handler);
        bus.on('dedup.event', handler);  // duplicate

        bus.emit('dedup.event', {});
        await tick();
        expect(handler).toHaveBeenCalledTimes(1);

        // emitSync should also fire it once
        await bus.emitSync('dedup.event', {});
        expect(handler).toHaveBeenCalledTimes(2);
    });

    // Scenario: same dedup contract applies to once().
    it('should reject duplicate once() registrations of the same (event, handler) pair', async () => {
        const handler = jest.fn();
        bus.once('one-shot.event', handler);
        bus.once('one-shot.event', handler);  // duplicate

        bus.emit('one-shot.event', {});
        await tick();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: a once() handler is removed from handlersByEvent after firing,
    // so subsequent emitSync() does not re-invoke it. The adapter already
    // removes the wrapped function from its event list; the bus also has
    // to clean the unwrapped index used by emitSync.
    it('should not re-invoke a fired once() handler via emitSync', async () => {
        const handler = jest.fn();
        bus.once('one-shot.emitsync', handler);

        await bus.emitSync('one-shot.emitsync', { firstCall: true });
        expect(handler).toHaveBeenCalledTimes(1);

        await bus.emitSync('one-shot.emitsync', { secondCall: true });
        expect(handler).toHaveBeenCalledTimes(1);

        // The handlersByEvent index should be empty for this event now.
        const index = bus.handlersByEvent.get('one-shot.emitsync');
        expect(!index || index.size === 0).toBe(true);
    });

    // Scenario: even when the once() handler throws, cleanup still runs.
    // safeRun swallows the error; the finally clause unregisters.
    it('should clean up once() handlers even when the handler throws', async () => {
        const handler = jest.fn(() => { throw new Error('handler threw'); });
        bus.once('throws.once', handler);

        bus.emit('throws.once', {});
        await tick();
        expect(handler).toHaveBeenCalledTimes(1);

        // Second emit: handler was unregistered in finally
        bus.emit('throws.once', {});
        await tick();
        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: an async errorHandler returns a Promise. Without awaiting,
    // the returned Promise is not an Error and the swallow branch wrongly
    // fires. With await, the resolved Error is treated correctly.
    it('should await an async errorHandler so its returned Error escalates', async () => {
        const handler         = () => { throw new Error('raw infra error'); };
        const asyncErrorHandler = async () => new Error('pretty user error');
        const errorListener   = jest.fn();
        bus.on('eventbus.error', errorListener);

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler : asyncErrorHandler,
        });

        bus.emit('payment.failed', {});
        await tick();
        // Allow the awaited errorHandler promise to settle
        await tick();

        expect(errorListener).toHaveBeenCalledTimes(1);
        const payload = errorListener.mock.calls[0][0].getData();
        expect(payload.error.message).toBe('pretty user error');
    });

    // Scenario: an async errorHandler that resolves with undefined (i.e.
    // "swallow") still works. The contract is "resolved Error escalates;
    // anything else swallows."
    it('should swallow an async errorHandler that resolves with undefined', async () => {
        const handler         = () => { throw new Error('transient'); };
        const asyncErrorHandler = async () => undefined;
        const errorListener   = jest.fn();
        bus.on('eventbus.error', errorListener);

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler : asyncErrorHandler,
        });

        bus.emit('payment.failed', {});
        await tick();
        await tick();

        expect(errorListener).not.toHaveBeenCalled();
    });

    // Scenario: initEventBus returns the same singleton on subsequent calls
    it('should return the same singleton on repeated init calls', () => {
        const bus2 = initEventBus({ adapter: new MemoryAdapter() });
        expect(bus2).toBe(bus);
    });

    // Scenario: The same handler registered on two different events should
    // receive both events and off() should only remove the targeted event.
    it('should track handlers per-event so off() removes the correct one', async () => {
        const handler = jest.fn();
        bus.on('event.alpha', handler);
        bus.on('event.beta', handler);

        // Remove only from alpha
        bus.off('event.alpha', handler);

        bus.emit('event.alpha', { source: 'alpha' });
        bus.emit('event.beta', { source: 'beta' });

        await tick();

        // Handler should only fire for beta (alpha was removed)
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].getName()).toBe('event.beta');
    });

    // Scenario: If an eventbus.error handler itself throws, the error is
    // contained by console.error — no infinite recursion / re-emission.
    it('should not re-emit eventbus.error when the error handler throws (recursion guard)', async () => {
        const errorHandlerCallCount = { value : 0 };

        // An eventbus.error listener that throws
        bus.on('eventbus.error', () => {
            errorHandlerCallCount.value++;
            throw new Error('Error handler also exploded');
        });

        const failingHandler = jest.fn(() => { throw new Error('Handler error'); });
        bus.on('some.event', failingHandler);

        // Should not throw or recurse infinitely
        bus.emit('some.event', {});
        await tick();

        expect(failingHandler).toHaveBeenCalledTimes(1);

        // The eventbus.error handler fired once (not infinitely)
        expect(errorHandlerCallCount.value).toBe(1);

        // console.error was called for both: the original handler error
        // and the eventbus.error handler error
        expect(console.error).toHaveBeenCalledTimes(2);
    });

    // ========================================================================
    // emitSync — awaitable emission for callers that need handler outcomes
    // ========================================================================

    // Scenario: emitSync resolves only after all handlers have completed.
    // The two handlers each delay 30ms; emitSync must not resolve before then.
    it('should await all handlers to complete before resolving', async () => {
        const completed = { handlerA: false, handlerB: false };
        bus.on('mail.welcome-offer', async () => {
            await new Promise((r) => setTimeout(r, 30));
            completed.handlerA = true;
        });
        bus.on('mail.welcome-offer', async () => {
            await new Promise((r) => setTimeout(r, 30));
            completed.handlerB = true;
        });

        await bus.emitSync('mail.welcome-offer', { userId: 42, messageId: 'uuid-001' });

        expect(completed.handlerA).toBe(true);
        expect(completed.handlerB).toBe(true);
    });

    // Scenario: emitSync rejects when a handler throws. The caller must be
    // able to observe and respond to the error.
    it('should reject with the handler error when a handler throws', async () => {
        bus.on('mail.welcome-offer', async () => {
            throw new Error('SMTP connection refused');
        });

        await expect(
            bus.emitSync('mail.welcome-offer', { userId: 42, messageId: 'uuid-002' }),
        ).rejects.toThrow('SMTP connection refused');
    });

    // Scenario: when no handlers are subscribed to the event, emitSync
    // resolves with true without error.
    it('should resolve true when no handlers are registered', async () => {
        const result = await bus.emitSync('mail.no-subscribers', { userId: 99 });
        expect(result).toBe(true);
    });

    // Scenario: emitSync delivers an immutable Event object (matching emit semantics)
    it('should deliver an immutable Event object to handlers', async () => {
        let received;
        bus.on('mail.welcome-offer', async (event) => {
            received = event;
        });

        await bus.emitSync('mail.welcome-offer', { userId: 42, messageId: 'uuid-003' });

        expect(received).toBeInstanceOf(Event);
        expect(received.getName()).toBe('mail.welcome-offer');
        expect(received.getData()).toEqual({ userId: 42, messageId: 'uuid-003' });
    });

    // Scenario: emitSync returns false when called with no event name (parity with emit())
    it('should return false when called with no event name', async () => {
        const result = await bus.emitSync();
        expect(result).toBe(false);
    });

    // Scenario: emitSync bypasses safeRun, so handler errors do NOT trigger
    // the eventbus.error chain. This is the documented trade-off — the caller
    // is responsible for error handling.
    it('should NOT emit eventbus.error when a handler throws (caller handles errors)', async () => {
        const errorListener = jest.fn();
        bus.on('eventbus.error', errorListener);

        bus.on('mail.welcome-offer', async () => {
            throw new Error('Boom');
        });

        await expect(
            bus.emitSync('mail.welcome-offer', { userId: 42 }),
        ).rejects.toThrow('Boom');

        // eventbus.error was not emitted — safeRun is bypassed for emitSync
        expect(errorListener).not.toHaveBeenCalled();
    });

    // Scenario: handlers removed via off() are not invoked by emitSync.
    // Verifies that off() correctly maintains the handlersByEvent index.
    it('should not invoke handlers that were removed via off()', async () => {
        const handler = jest.fn();
        bus.on('mail.welcome-offer', handler);
        bus.off('mail.welcome-offer', handler);

        await bus.emitSync('mail.welcome-offer', { userId: 42 });

        expect(handler).not.toHaveBeenCalled();
    });

    // Scenario: clear() resets handlersByEvent so emitSync no longer dispatches
    it('should not invoke handlers after clear()', async () => {
        const handler = jest.fn();
        bus.on('mail.welcome-offer', handler);
        bus.clear();

        await bus.emitSync('mail.welcome-offer', { userId: 42 });

        expect(handler).not.toHaveBeenCalled();
    });
});

// ============================================================================
// Notifier dispatch — verifies the Tier-2 notifier pathway
// ============================================================================

// Tiny in-memory test notifier so we can verify the dispatch contract end-to-end.
// Subclasses BaseNotifier just like a real consumer would.
const { BaseNotifier } = require('../index');

class TestNotifier extends BaseNotifier {
    constructor(name = 'test') {
        super();
        this.name  = name;
        this.calls = [];
    }
    async notify(subject, error = null) {
        this.calls.push({ subject, error });
    }
}

describe('EventBus notifier dispatch (Tier 2)', () => {
    let bus;
    let slackNotifier;
    let emailNotifier;

    beforeEach(() => {
        resetEventBus();
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});

        slackNotifier = new TestNotifier('slack');
        emailNotifier = new TestNotifier('email');

        bus = initEventBus({
            adapter   : new MemoryAdapter(),
            notifiers : {
                slack : slackNotifier,
                email : emailNotifier,
            },
        });
    });

    afterEach(() => {
        console.error.mockRestore();
        resetEventBus();
    });

    // Scenario: handler throws + no errorHandler + onError.notify configured.
    // Both named notifiers receive the original error with a descriptive
    // subject that includes the event name and the plugin name.
    it('should dispatch to all configured notifiers when handler throws with no errorHandler', async () => {
        const handler = () => { throw new Error('Card declined'); };
        bus.on('payment.failed', handler, {
            pluginName : 'billing',
            onError    : { notify : ['slack', 'email'] },
        });

        bus.emit('payment.failed', { orderId : 'ord-001' });
        await tick();

        expect(slackNotifier.calls).toHaveLength(1);
        expect(slackNotifier.calls[0].subject).toBe('[EventBus] "payment.failed" failed in plugin "billing"');
        expect(slackNotifier.calls[0].error.message).toBe('Card declined');

        expect(emailNotifier.calls).toHaveLength(1);
        expect(emailNotifier.calls[0].error.message).toBe('Card declined');
    });

    // Scenario: plugin-level errorHandler returns an Error, which means
    // "I want this escalated." Notifier dispatch fires for the returned
    // (possibly transformed) error, not the original.
    it('should dispatch notifiers with the returned error when errorHandler returns an Error', async () => {
        const handler      = () => { throw new Error('raw infra error'); };
        const errorHandler = () => new Error('pretty user-facing error');

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler,
            onError      : { notify : ['slack'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(1);
        expect(slackNotifier.calls[0].error.message).toBe('pretty user-facing error');
    });

    // Scenario: errorHandler returns undefined (or any non-Error) — explicit
    // swallow contract. No notifier dispatch, no eventbus.error emission.
    it('should NOT dispatch notifiers when errorHandler returns undefined (swallow)', async () => {
        const handler         = () => { throw new Error('transient'); };
        const errorHandler    = () => undefined;
        const errorListener   = jest.fn();
        bus.on('eventbus.error', errorListener);

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler,
            onError      : { notify : ['slack'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(0);
        expect(errorListener).not.toHaveBeenCalled();
    });

    // Scenario: errorHandler returns null — same swallow semantics as undefined.
    it('should NOT dispatch notifiers when errorHandler returns null', async () => {
        const handler      = () => { throw new Error('transient'); };
        const errorHandler = () => null;

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler,
            onError      : { notify : ['slack'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(0);
    });

    // Scenario: errorHandler returns a non-Error truthy value — still swallow.
    // The contract is "Error to escalate, anything else to swallow," NOT
    // "truthy to escalate."
    it('should NOT dispatch notifiers when errorHandler returns a non-Error value', async () => {
        const handler      = () => { throw new Error('transient'); };
        const errorHandler = () => ({ swallow : true });

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler,
            onError      : { notify : ['slack'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(0);
    });

    // Scenario: errorHandler itself throws — original error escalates,
    // including notifier dispatch. This is the "errorHandler is broken too,
    // fall back to original error" path.
    it('should dispatch notifiers with the ORIGINAL error when errorHandler itself throws', async () => {
        const handler      = () => { throw new Error('original failure'); };
        const errorHandler = () => { throw new Error('errorHandler is broken'); };

        bus.on('payment.failed', handler, {
            pluginName   : 'billing',
            errorHandler,
            onError      : { notify : ['slack'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(1);
        expect(slackNotifier.calls[0].error.message).toBe('original failure');
    });

    // Scenario: handler throws inside an 'eventbus.error' subscriber.
    // Recursion guard: skip notifier dispatch and eventbus.error re-emit
    // to avoid infinite loops.
    it('should NOT dispatch notifiers when an eventbus.error handler itself throws (recursion guard)', async () => {
        bus.on('eventbus.error', () => { throw new Error('error listener exploded'); }, {
            pluginName : 'alerting',
            onError    : { notify : ['slack'] },
        });

        const failingHandler = () => { throw new Error('original'); };
        bus.on('user.signup', failingHandler, { pluginName : 'auth' });

        bus.emit('user.signup', {});
        await tick();

        // slack was NOT called for the eventbus.error handler's own failure
        expect(slackNotifier.calls).toHaveLength(0);
    });

    // Scenario: handler is configured with a notifier name that wasn't
    // registered with the bus. The dispatch logs an error but does not
    // throw and does not block other notifiers.
    it('should log and skip when a configured notifier name is not registered', async () => {
        const handler = () => { throw new Error('boom'); };
        bus.on('payment.failed', handler, {
            pluginName : 'billing',
            onError    : { notify : ['slack', 'pager-duty-not-registered', 'email'] },
        });

        bus.emit('payment.failed', {});
        await tick();

        // The two real notifiers still fire
        expect(slackNotifier.calls).toHaveLength(1);
        expect(emailNotifier.calls).toHaveLength(1);

        // The unknown notifier produces an error log
        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('No notifier named "pager-duty-not-registered"'),
        );
    });

    // Scenario: notifier.notify() itself rejects. Dispatch is fire-and-forget;
    // the rejection is caught and logged, no exception propagates.
    it('should catch and log when a notifier rejects', async () => {
        class FlakyNotifier extends BaseNotifier {
            async notify() { throw new Error('notifier transport down'); }
        }
        // Build a fresh bus with the flaky notifier to bypass beforeEach.
        resetEventBus();
        const flaky = new FlakyNotifier();
        const localBus = initEventBus({
            adapter   : new MemoryAdapter(),
            notifiers : { flaky },
        });

        const handler = () => { throw new Error('boom'); };
        localBus.on('payment.failed', handler, {
            pluginName : 'billing',
            onError    : { notify : ['flaky'] },
        });

        localBus.emit('payment.failed', {});
        // Two ticks: one for safeRun to dispatch, one for Promise.resolve.then to settle
        await tick();
        await tick();

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('Notifier "flaky" threw while dispatching error for "payment.failed":'),
            expect.any(Error),
        );
    });

    // Scenario: handler has no onError config at all. No notifier dispatch.
    // (The eventbus.error event still emits, that is tested in the main suite.)
    it('should NOT dispatch when handler config has no onError', async () => {
        const handler = () => { throw new Error('boom'); };
        bus.on('payment.failed', handler, { pluginName : 'billing' });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(0);
        expect(emailNotifier.calls).toHaveLength(0);
    });

    // Scenario: onError exists but notify is empty array. No dispatch.
    it('should NOT dispatch when onError.notify is an empty array', async () => {
        const handler = () => { throw new Error('boom'); };
        bus.on('payment.failed', handler, {
            pluginName : 'billing',
            onError    : { notify : [] },
        });

        bus.emit('payment.failed', {});
        await tick();

        expect(slackNotifier.calls).toHaveLength(0);
    });
});

// ============================================================================
// onInterval — scheduled emission via setInterval
// ============================================================================

describe('EventBus.onInterval', () => {
    let bus;

    beforeEach(() => {
        resetEventBus();
        jest.useFakeTimers();
        jest.spyOn(console, 'error').mockImplementation(() => {});
        bus = initEventBus({ adapter : new MemoryAdapter() });
    });

    afterEach(() => {
        bus.clear();
        console.error.mockRestore();
        jest.useRealTimers();
        resetEventBus();
    });

    // Scenario: a registered interval fires the named event with the configured
    // payload after intervalMs. The first tick is deferred — nothing fires
    // before the timer expires.
    it('should emit the configured event with payload on each tick', () => {
        const handler = jest.fn();
        bus.on('mail.poll', handler);
        bus.onInterval(1000, 'mail.poll', { batchSize: 5 });

        // No tick before the interval expires
        jest.advanceTimersByTime(999);
        expect(handler).not.toHaveBeenCalled();

        // First tick at exactly intervalMs
        jest.advanceTimersByTime(1);
        expect(handler).toHaveBeenCalledTimes(1);
        expect(handler.mock.calls[0][0].getData()).toEqual({ batchSize: 5 });

        // Second tick at 2 * intervalMs
        jest.advanceTimersByTime(1000);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    // Scenario: runImmediately fires a tick at registration before the
    // first scheduled one. This is "fire on start" semantics for callers
    // that want the work to happen immediately AND on schedule afterward.
    it('should fire one tick at registration when runImmediately is true', async () => {
        const handler = jest.fn();
        bus.on('reports.flush', handler);
        bus.onInterval(60_000, 'reports.flush', {}, { runImmediately: true });

        // The immediate fire is scheduled via Promise.resolve so it runs
        // on the next microtask; advance the timers + flush promises.
        await Promise.resolve();
        expect(handler).toHaveBeenCalledTimes(1);

        // Next tick still fires at intervalMs (not 2 * intervalMs)
        jest.advanceTimersByTime(60_000);
        expect(handler).toHaveBeenCalledTimes(2);
    });

    // Scenario: in-flight guard. If a tick's emit is still pending (awaitHandlers
    // case) when the next interval fires, the new tick is skipped — not queued,
    // not concurrent.
    it('should skip ticks when prior tick is still in flight (default allowConcurrent=false)', async () => {
        let resolveHandler;
        const slowHandler = jest.fn(() => new Promise((r) => { resolveHandler = r; }));
        bus.on('slow.event', slowHandler);
        bus.onInterval(1000, 'slow.event', {}, { awaitHandlers: true });

        // Tick 1 starts and hangs
        await jest.advanceTimersByTimeAsync(1000);
        expect(slowHandler).toHaveBeenCalledTimes(1);

        // Tick 2 fires while tick 1 is still in flight — skipped by the guard
        await jest.advanceTimersByTimeAsync(1000);
        expect(slowHandler).toHaveBeenCalledTimes(1);

        // Resolve tick 1; flush microtasks so inFlight clears
        resolveHandler();
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Tick 3 fires normally now that prior is done
        await jest.advanceTimersByTimeAsync(1000);
        expect(slowHandler).toHaveBeenCalledTimes(2);
    });

    // Scenario: allowConcurrent: true disables the in-flight guard.
    // Useful when ticks are truly independent and overlap is acceptable.
    it('should allow ticks to overlap when allowConcurrent is true', async () => {
        const slowHandler = jest.fn(() => new Promise(() => { /* never resolves */ }));
        bus.on('parallel.event', slowHandler);
        bus.onInterval(1000, 'parallel.event', {}, {
            awaitHandlers   : true,
            allowConcurrent : true,
        });

        // Each tick fires regardless of whether prior is still in flight
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
        await Promise.resolve();
        jest.advanceTimersByTime(1000);
        await Promise.resolve();

        expect(slowHandler).toHaveBeenCalledTimes(3);
    });

    // Scenario: awaitHandlers: true routes through emitSync so handler
    // errors propagate to the tick's catch (and get logged).
    it('should use emitSync when awaitHandlers is true and log handler errors', async () => {
        bus.on('flush.metrics', async () => { throw new Error('downstream broke'); });
        bus.onInterval(1000, 'flush.metrics', {}, { awaitHandlers: true });

        await jest.advanceTimersByTimeAsync(1000);

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining('onInterval tick for "flush.metrics"'),
            expect.any(Error),
        );
    });

    // Scenario: maxRuns auto-cancels the interval after N firings.
    // Useful for limited campaigns or burn-in periods.
    it('should auto-offInterval after maxRuns firings', () => {
        const handler = jest.fn();
        bus.on('limited.event', handler);
        const handle = bus.onInterval(100, 'limited.event', {}, { maxRuns: 3 });

        jest.advanceTimersByTime(100);
        jest.advanceTimersByTime(100);
        jest.advanceTimersByTime(100);
        // Three firings; auto-cancelled
        expect(handler).toHaveBeenCalledTimes(3);
        expect(bus.intervals.has(handle)).toBe(false);

        // Fourth advance — no tick
        jest.advanceTimersByTime(100);
        expect(handler).toHaveBeenCalledTimes(3);
    });

    // Scenario: offInterval cancels the timer immediately.
    it('should cancel future ticks when offInterval is called', () => {
        const handler = jest.fn();
        bus.on('cancelable.event', handler);
        const handle = bus.onInterval(1000, 'cancelable.event');

        jest.advanceTimersByTime(1000);
        expect(handler).toHaveBeenCalledTimes(1);

        expect(bus.offInterval(handle)).toBe(true);

        jest.advanceTimersByTime(5000);
        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: offInterval with an unknown handle is a safe no-op.
    it('should return false and not throw when offInterval is called with an unknown handle', () => {
        expect(bus.offInterval(999)).toBe(false);
        expect(() => bus.offInterval(undefined)).not.toThrow();
    });

    // Scenario: clear() cancels every active interval.
    it('should cancel all intervals when clear() is called', () => {
        const handlerA = jest.fn();
        const handlerB = jest.fn();
        bus.on('a.event', handlerA);
        bus.on('b.event', handlerB);
        bus.onInterval(1000, 'a.event');
        bus.onInterval(1000, 'b.event');

        bus.clear();

        jest.advanceTimersByTime(5000);
        expect(handlerA).not.toHaveBeenCalled();
        expect(handlerB).not.toHaveBeenCalled();
        expect(bus.intervals.size).toBe(0);
    });

    // Scenario: invalid intervalMs is rejected at registration. The contract
    // is positive INTEGER ms, so fractional values like 0.5 are rejected too.
    it('should throw when intervalMs is not a positive integer', () => {
        expect(() => bus.onInterval(0, 'x')).toThrow(/positive integer intervalMs/);
        expect(() => bus.onInterval(-1, 'x')).toThrow(/positive integer intervalMs/);
        expect(() => bus.onInterval(Infinity, 'x')).toThrow(/positive integer intervalMs/);
        expect(() => bus.onInterval(NaN, 'x')).toThrow(/positive integer intervalMs/);
        expect(() => bus.onInterval('5000', 'x')).toThrow(/positive integer intervalMs/);
        // Fractional value rejected (was accepted under the old Number.isFinite check)
        expect(() => bus.onInterval(0.5, 'x')).toThrow(/positive integer intervalMs/);
        expect(() => bus.onInterval(1.5, 'x')).toThrow(/positive integer intervalMs/);
    });

    // Scenario: invalid eventName is rejected at registration.
    it('should throw when eventName is missing or not a string', () => {
        expect(() => bus.onInterval(1000)).toThrow(/non-empty string eventName/);
        expect(() => bus.onInterval(1000, '')).toThrow(/non-empty string eventName/);
        expect(() => bus.onInterval(1000, 42)).toThrow(/non-empty string eventName/);
    });

    // Scenario: invalid maxRuns is rejected at registration. Integer contract.
    it('should throw when maxRuns is not a positive integer', () => {
        expect(() => bus.onInterval(1000, 'x', {}, { maxRuns: 0 })).toThrow(/maxRuns must be a positive integer/);
        expect(() => bus.onInterval(1000, 'x', {}, { maxRuns: -1 })).toThrow(/maxRuns must be a positive integer/);
        expect(() => bus.onInterval(1000, 'x', {}, { maxRuns: Infinity })).toThrow(/maxRuns must be a positive integer/);
        // Fractional value rejected
        expect(() => bus.onInterval(1000, 'x', {}, { maxRuns: 2.5 })).toThrow(/maxRuns must be a positive integer/);
    });

    // Scenario: timer is unref()d by default. We verify by spying on the
    // returned timer's unref method via a wrapper around setInterval.
    it('should unref() the timer by default', () => {
        const realSetInterval = global.setInterval;
        let capturedTimer;
        global.setInterval = (...args) => {
            capturedTimer = realSetInterval(...args);
            capturedTimer.unref = jest.fn(capturedTimer.unref.bind(capturedTimer));
            return capturedTimer;
        };
        try {
            bus.onInterval(1000, 'x.event');
            expect(capturedTimer.unref).toHaveBeenCalledTimes(1);
        }
        finally {
            global.setInterval = realSetInterval;
        }
    });

    // Scenario: keepAlive: true skips unref() so the timer keeps the
    // process alive.
    it('should NOT unref() the timer when keepAlive is true', () => {
        const realSetInterval = global.setInterval;
        let capturedTimer;
        global.setInterval = (...args) => {
            capturedTimer = realSetInterval(...args);
            capturedTimer.unref = jest.fn(capturedTimer.unref.bind(capturedTimer));
            return capturedTimer;
        };
        try {
            bus.onInterval(1000, 'x.event', {}, { keepAlive: true });
            expect(capturedTimer.unref).not.toHaveBeenCalled();
        }
        finally {
            global.setInterval = realSetInterval;
        }
    });

    // Scenario: two independent registrations on the same event produce
    // two handles and both fire on their own cadence.
    it('should support multiple independent registrations on the same event', () => {
        const handler = jest.fn();
        bus.on('shared.event', handler);
        const h1 = bus.onInterval(100, 'shared.event');
        const h2 = bus.onInterval(100, 'shared.event');

        expect(h1).not.toBe(h2);

        jest.advanceTimersByTime(100);
        // Each registration fires once → 2 emissions → 2 handler calls
        expect(handler).toHaveBeenCalledTimes(2);
    });
});

describe('Event.fromPayload', () => {

    // Scenario: fromPayload with null should throw a descriptive error
    it('should throw for null payload', () => {
        expect(() => Event.fromPayload(null)).toThrow(/non-null object/);
    });

    // Scenario: fromPayload with undefined should throw a descriptive error
    it('should throw for undefined payload', () => {
        expect(() => Event.fromPayload(undefined)).toThrow(/non-null object/);
    });

    // Scenario: fromPayload with a non-string name should throw
    it('should throw when payload.name is missing or not a string', () => {
        expect(() => Event.fromPayload({})).toThrow(/non-empty string "name"/);
        expect(() => Event.fromPayload({ name: 123 })).toThrow(/non-empty string "name"/);
        expect(() => Event.fromPayload({ name: '' })).toThrow(/non-empty string "name"/);
    });

    // Scenario: fromPayload with valid data should reconstitute the Event
    it('should reconstitute a valid event from a serialized payload', () => {
        const original = Event.create('order.shipped', { trackingId: 'TRK-789' })
            .withMeta({ actor: 'shipping-service', userId: 55, traceId: 'trace-abc' });
        const serialized = JSON.parse(JSON.stringify(original.toPayload()));
        const reconstituted = Event.fromPayload(serialized);

        expect(reconstituted.getName()).toBe('order.shipped');
        expect(reconstituted.getData()).toEqual({ trackingId: 'TRK-789' });
        expect(reconstituted.getActor()).toBe('shipping-service');
        expect(reconstituted.getUserId()).toBe(55);
        expect(reconstituted.getTraceId()).toBe('trace-abc');
    });
});
