/**
 * EventBus core tests.
 *
 * Tests cover: on/off/once/emit, error notification dispatch,
 * clear, missing arguments, and Event immutability.
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

    // Mock notifiers
    const mockSlackNotifier = { notify : jest.fn().mockResolvedValue() };
    const mockEmailNotifier = { notify : jest.fn().mockResolvedValue() };

    beforeEach(() => {
        resetEventBus();
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});

        bus = initEventBus({
            adapter   : new MemoryAdapter(),
            notifiers : {
                slack : mockSlackNotifier,
                email : mockEmailNotifier,
            },
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

    // Scenario: Event data is frozen and cannot be mutated by handlers
    it('should emit immutable Event objects', async () => {
        const handler = jest.fn((event) => {
            expect(() => { event.data.email = 'hacked'; }).toThrow();
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

    // Scenario: A handler that throws triggers Slack and email notifiers per config
    it('should call configured notifiers when handler throws', async () => {
        const failingHandler = jest.fn(() => {
            throw new Error('Handler exploded');
        });

        bus.on('order.failed', failingHandler, {
            onError : { notify: ['slack', 'email'] },
        });

        bus.emit('order.failed', { orderId: 'ord-broken' });

        await tick();

        expect(mockSlackNotifier.notify).toHaveBeenCalledTimes(1);
        expect(mockSlackNotifier.notify).toHaveBeenCalledWith(
            expect.stringContaining('order.failed'),
            expect.any(Error)
        );
        expect(mockEmailNotifier.notify).toHaveBeenCalledTimes(1);
    });

    // Scenario: A handler that throws with only slack in config should not call email notifier
    it('should only call notifiers specified in handler config', async () => {
        const failingHandler = jest.fn(() => {
            throw new Error('Slack only');
        });

        bus.on('partial.error', failingHandler, {
            onError : { notify: ['slack'] },
        });

        bus.emit('partial.error', {});

        await tick();

        expect(mockSlackNotifier.notify).toHaveBeenCalledTimes(1);
        expect(mockEmailNotifier.notify).not.toHaveBeenCalled();
    });

    // Scenario: A handler that throws with no onError config should not call any notifiers
    it('should not call notifiers when handler has no onError config', async () => {
        const failingHandler = jest.fn(() => {
            throw new Error('Silent failure');
        });

        bus.on('silent.error', failingHandler);
        bus.emit('silent.error', {});

        await tick();

        expect(mockSlackNotifier.notify).not.toHaveBeenCalled();
        expect(mockEmailNotifier.notify).not.toHaveBeenCalled();
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
});
