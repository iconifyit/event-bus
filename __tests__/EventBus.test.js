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
