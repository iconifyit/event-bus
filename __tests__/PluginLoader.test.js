/**
 * PluginLoader tests.
 *
 * Tests cover: valid plugin registration, duplicate rejection,
 * invalid plugin validation, once-handlers, and registerAll().
 */
const {
    initEventBus,
    resetEventBus,
    PluginLoader,
    MemoryAdapter,
} = require('../index');

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('PluginLoader', () => {
    let bus;
    let loader;

    beforeEach(() => {
        resetEventBus();
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        bus = initEventBus({ adapter: new MemoryAdapter() });
        loader = new PluginLoader(bus);
    });

    afterEach(() => {
        console.warn.mockRestore();
        resetEventBus();
    });

    // Scenario: A valid plugin registers its handlers on the EventBus
    it('should register a valid plugin and wire up handlers', async () => {
        const handler = jest.fn();
        const plugin = {
            name   : 'order-confirmation',
            events : [
                {
                    type    : 'order.confirmation',
                    handler,
                    config  : { onError: { notify: ['slack'] } },
                },
            ],
        };

        const result = loader.register(plugin);
        expect(result).toBe(true);
        expect(loader.isRegistered('order-confirmation')).toBe(true);

        bus.emit('order.confirmation', { orderId: 'ord-42' });
        await tick();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: Registering the same plugin name twice should skip the duplicate
    it('should reject duplicate plugin registrations', () => {
        const plugin = {
            name   : 'welcome-email',
            events : [{ type: 'user.signup', handler: jest.fn() }],
        };

        expect(loader.register(plugin)).toBe(true);
        expect(loader.register(plugin)).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('already registered'),
        );
    });

    // Scenario: A plugin with missing name should fail validation
    it('should reject a plugin with no name', () => {
        const plugin = {
            events : [{ type: 'test.event', handler: jest.fn() }],
        };

        expect(loader.register(plugin)).toBe(false);
    });

    // Scenario: A plugin with an empty events array should fail validation
    it('should reject a plugin with empty events', () => {
        const plugin = {
            name   : 'empty-plugin',
            events : [],
        };

        expect(loader.register(plugin)).toBe(false);
    });

    // Scenario: A plugin event with missing handler should fail validation
    it('should reject a plugin event with no handler function', () => {
        const plugin = {
            name   : 'bad-handler',
            events : [{ type: 'test.event', handler: 'not-a-function' }],
        };

        expect(loader.register(plugin)).toBe(false);
    });

    // Scenario: A plugin event with missing type should fail validation
    it('should reject a plugin event with no type', () => {
        const plugin = {
            name   : 'no-type',
            events : [{ handler: jest.fn() }],
        };

        expect(loader.register(plugin)).toBe(false);
    });

    // Scenario: A null or non-object plugin should fail validation
    it('should reject null or non-object plugins', () => {
        expect(loader.register(null)).toBe(false);
        expect(loader.register('string')).toBe(false);
        expect(loader.register(42)).toBe(false);
    });

    // Scenario: A plugin with once: true should fire its handler only on the first emit
    it('should support once handlers via the once flag', async () => {
        const handler = jest.fn();
        const plugin = {
            name   : 'one-time',
            events : [{ type: 'one.time.event', handler, once: true }],
        };

        loader.register(plugin);
        bus.emit('one.time.event', { first: true });
        bus.emit('one.time.event', { second: true });

        await tick();

        expect(handler).toHaveBeenCalledTimes(1);
    });

    // Scenario: registerAll registers multiple plugins and reports results
    it('should register multiple plugins via registerAll()', () => {
        const pluginA = {
            name   : 'plugin-a',
            events : [{ type: 'a.event', handler: jest.fn() }],
        };
        const pluginB = {
            name   : 'plugin-b',
            events : [{ type: 'b.event', handler: jest.fn() }],
        };
        const badPlugin = { name: 'bad', events: [] };

        const result = loader.registerAll([pluginA, pluginB, badPlugin]);

        expect(result.registered).toEqual(['plugin-a', 'plugin-b']);
        expect(result.skipped).toEqual(['bad']);
    });

    // Scenario: getRegisteredNames returns all successfully registered plugin names
    it('should return all registered plugin names', () => {
        loader.register({
            name   : 'alpha',
            events : [{ type: 'a', handler: jest.fn() }],
        });
        loader.register({
            name   : 'beta',
            events : [{ type: 'b', handler: jest.fn() }],
        });

        expect(loader.getRegisteredNames()).toEqual(['alpha', 'beta']);
    });

    // Scenario: A plugin with null entries in the events array should fail
    // validation with a clear error rather than throwing a TypeError.
    it('should reject a plugin with null entries in the events array', () => {
        const plugin = {
            name   : 'null-event-entry',
            events : [null, undefined, 42],
        };

        expect(loader.register(plugin)).toBe(false);
        expect(console.warn).toHaveBeenCalledWith(
            expect.stringContaining('null-event-entry'),
            expect.arrayContaining([
                expect.stringContaining('events[0] must be a non-null object'),
            ]),
        );
    });
});
