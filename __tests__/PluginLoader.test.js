/**
 * PluginLoader tests.
 *
 * Tests cover: valid plugin registration, duplicate rejection,
 * invalid plugin validation, once-handlers, registerAll(),
 * factory function support, context injection, and errorHandler config.
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

    describe('constructor options API', () => {

        // Scenario: PluginLoader accepts the new { eventBus, context } options shape
        it('should accept an options object with eventBus and context', () => {
            const contextLoader = new PluginLoader({ eventBus : bus, context : { foo : 'bar' } });
            expect(contextLoader).toBeInstanceOf(PluginLoader);
        });

        // Scenario: PluginLoader accepts the new options shape without context
        it('should default context to empty object when omitted', () => {
            const contextLoader = new PluginLoader({ eventBus : bus });
            expect(contextLoader).toBeInstanceOf(PluginLoader);
        });

        // Scenario: PluginLoader still throws when no eventBus is provided
        it('should throw when constructed without an eventBus', () => {
            expect(() => new PluginLoader({})).toThrow('PluginLoader requires an EventBus instance');
            expect(() => new PluginLoader()).toThrow('PluginLoader requires an EventBus instance');
            expect(() => new PluginLoader(null)).toThrow('PluginLoader requires an EventBus instance');
        });
    });

    describe('factory function support', () => {

        // Scenario: A factory function plugin receives context and registers correctly
        it('should resolve a factory function and register the returned plugin', async () => {
            const handler = jest.fn();
            const factory = (context) => ({
                name   : 'factory-mailer',
                events : [{
                    type    : 'mail.send',
                    handler,
                }],
            });

            const contextLoader = new PluginLoader({
                eventBus : bus,
                context  : { mailService : { send : jest.fn() } },
            });

            expect(contextLoader.register(factory)).toBe(true);
            expect(contextLoader.isRegistered('factory-mailer')).toBe(true);

            bus.emit('mail.send', { to : 'admin@vectoricons.net' });
            await tick();

            expect(handler).toHaveBeenCalledTimes(1);
        });

        // Scenario: Factory receives the exact context object from the constructor
        it('should pass the context to factory functions', () => {
            const receivedContext = [];
            const factory = (context) => {
                receivedContext.push(context);
                return {
                    name   : 'context-checker',
                    events : [{ type : 'test.event', handler : jest.fn() }],
                };
            };

            const appContext = { templateService : {}, mailService : {} };
            const contextLoader = new PluginLoader({ eventBus : bus, context : appContext });
            contextLoader.register(factory);

            expect(receivedContext).toHaveLength(1);
            expect(receivedContext[0]).toBe(appContext);
        });

        // Scenario: A factory that returns an invalid plugin should be rejected
        it('should reject a factory that returns an invalid plugin', () => {
            const factory = () => ({ name : 'bad-factory', events : [] });

            const contextLoader = new PluginLoader({ eventBus : bus });
            expect(contextLoader.register(factory)).toBe(false);
        });

        // Scenario: registerAll should work with a mix of factories and plain objects
        it('should handle mixed factories and plain objects in registerAll', async () => {
            const handlerA = jest.fn();
            const handlerB = jest.fn();

            const plainPlugin = {
                name   : 'plain-plugin',
                events : [{ type : 'event.a', handler : handlerA }],
            };

            const factory = (context) => ({
                name   : 'factory-plugin',
                events : [{ type : 'event.b', handler : handlerB }],
            });

            const contextLoader = new PluginLoader({ eventBus : bus, context : {} });
            const result = contextLoader.registerAll([plainPlugin, factory]);

            expect(result.registered).toEqual(['plain-plugin', 'factory-plugin']);
            expect(result.skipped).toEqual([]);

            bus.emit('event.a', {});
            bus.emit('event.b', {});
            await tick();

            expect(handlerA).toHaveBeenCalledTimes(1);
            expect(handlerB).toHaveBeenCalledTimes(1);
        });

        // Scenario: Factory function uses context.emitter to emit events
        it('should allow factory plugins to use context.emitter', async () => {
            const { WriteEmitter } = require('../index');
            const emitter = bus.createEmitter();
            const receivedEvents = [];

            // Delivery handler that will receive the emitted event
            bus.on('mail.send', async (event) => {
                receivedEvents.push(event.getData());
            });

            // Orchestration factory that emits via context.emitter
            const orchestrationFactory = (context) => ({
                name   : 'signup-orchestrator',
                events : [{
                    type    : 'user.signup',
                    handler : async (event) => {
                        const { email } = event.getData();
                        context.emitter.emit('mail.send', {
                            to       : email,
                            subject  : 'Welcome!',
                            template : 'welcome-offer',
                        });
                    },
                }],
            });

            const contextLoader = new PluginLoader({
                eventBus : bus,
                context  : { emitter },
            });
            contextLoader.register(orchestrationFactory);

            bus.emit('user.signup', { email : 'jane@vectoricons.net', username : 'janedoe' });
            await tick();

            expect(receivedEvents).toHaveLength(1);
            expect(receivedEvents[0]).toEqual({
                to       : 'jane@vectoricons.net',
                subject  : 'Welcome!',
                template : 'welcome-offer',
            });
        });

        // Scenario: a factory function that throws during invocation. The
        // module header guarantees invalid plugins are skipped without
        // crashing the app, so resolve() catches and logs, register() then
        // sees null and reports it as an invalid plugin.
        // Uses the console.warn spy installed in the suite-level beforeEach.
        it('should catch factory exceptions and skip the plugin without crashing', () => {
            const throwingFactory = () => {
                throw new Error('factory blew up');
            };

            const result = loader.register(throwingFactory);

            expect(result).toBe(false);
            // resolve() logs the underlying error
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Plugin factory threw during resolution; skipping plugin:'),
                expect.any(Error),
            );
            // register() emits the specific "factory function threw" skip
            // message rather than the generic "Plugin must be a non-null
            // object" message. Two separate warn calls.
            expect(console.warn).toHaveBeenCalledWith(
                expect.stringContaining('Skipping plugin: factory function threw during resolution'),
            );
            // Ensure the generic-object message did NOT also fire.
            expect(console.warn).not.toHaveBeenCalledWith(
                expect.stringContaining('Plugin must be a non-null object'),
                expect.anything(),
            );
        });

        // Scenario: when registerAll encounters a throwing factory in the
        // middle of a batch, the rest of the batch still registers cleanly.
        // resolve() returns null for the broken factory; register() rejects
        // it; the next iteration continues.
        it('should continue processing other plugins when one factory throws', () => {
            const goodHandler = jest.fn();
            const goodFactory = () => ({
                name   : 'good-plugin',
                events : [{ type : 'ok.event', handler : goodHandler }],
            });
            const throwingFactory = () => {
                throw new Error('factory blew up');
            };

            const summary = loader.registerAll([goodFactory, throwingFactory]);

            expect(summary.registered).toEqual(['good-plugin']);
            expect(summary.skipped).toHaveLength(1);
            expect(loader.isRegistered('good-plugin')).toBe(true);
        });
    });

    describe('errorHandler config injection', () => {

        // Scenario: A plugin with errorHandler gets it passed as config to bus.on()
        it('should attach errorHandler to handler config when plugin defines one', () => {
            const onSpy = jest.spyOn(bus, 'on');
            const errorHandler = (error, event) => error;
            const handler = jest.fn();

            const plugin = {
                name         : 'plugin-with-error-handler',
                errorHandler,
                events       : [{ type : 'test.event', handler }],
            };

            const contextLoader = new PluginLoader({ eventBus : bus });
            contextLoader.register(plugin);

            expect(onSpy).toHaveBeenCalledWith(
                'test.event',
                handler,
                expect.objectContaining({
                    pluginName   : 'plugin-with-error-handler',
                    errorHandler,
                }),
            );

            onSpy.mockRestore();
        });

        // Scenario: A plugin without errorHandler should not inject one into config
        it('should not inject errorHandler when plugin does not define one', () => {
            const onSpy = jest.spyOn(bus, 'on');
            const handler = jest.fn();

            const plugin = {
                name   : 'no-error-handler-plugin',
                events : [{ type : 'test.event', handler }],
            };

            const contextLoader = new PluginLoader({ eventBus : bus });
            contextLoader.register(plugin);

            const passedConfig = onSpy.mock.calls[0][2];
            expect(passedConfig.pluginName).toBe('no-error-handler-plugin');
            expect(passedConfig.errorHandler).toBeUndefined();

            onSpy.mockRestore();
        });

        // Scenario: Plugin-level config is preserved and merged with pluginName/errorHandler
        it('should merge plugin-level config with event-level config', () => {
            const onSpy = jest.spyOn(bus, 'on');
            const errorHandler = jest.fn();
            const handler = jest.fn();

            const plugin = {
                name         : 'merged-config-plugin',
                errorHandler,
                events       : [{
                    type    : 'test.event',
                    handler,
                    config  : { onError : { notify : ['slack'] } },
                }],
            };

            const contextLoader = new PluginLoader({ eventBus : bus });
            contextLoader.register(plugin);

            const passedConfig = onSpy.mock.calls[0][2];
            expect(passedConfig).toEqual({
                onError      : { notify : ['slack'] },
                pluginName   : 'merged-config-plugin',
                errorHandler,
            });

            onSpy.mockRestore();
        });

        // Scenario: Factory function plugin with errorHandler
        it('should support errorHandler on factory function plugins', () => {
            const onSpy = jest.spyOn(bus, 'on');
            const errorHandler = (error, event) => error;
            const handler = jest.fn();

            const factory = (context) => ({
                name         : 'factory-error-handler',
                errorHandler,
                events       : [{ type : 'mail.send', handler }],
            });

            const contextLoader = new PluginLoader({ eventBus : bus, context : {} });
            contextLoader.register(factory);

            expect(onSpy).toHaveBeenCalledWith(
                'mail.send',
                handler,
                expect.objectContaining({
                    pluginName   : 'factory-error-handler',
                    errorHandler,
                }),
            );

            onSpy.mockRestore();
        });
    });
});
