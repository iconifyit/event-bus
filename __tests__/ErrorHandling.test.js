/**
 * Two-tier error handling tests.
 *
 * Tests cover the 5 runtime error scenarios from ADR-006:
 *   1. No errorHandler → console.error + eventbus.error emitted
 *   2. errorHandler swallows → console.error only, no eventbus.error
 *   3. errorHandler returns Error → console.error + eventbus.error with returned Error
 *   4. errorHandler itself throws → console.error (×2) + eventbus.error with original
 *   5. eventbus.error listener throws → console.error only, no re-emission
 *
 * Additional edge cases:
 *   - errorHandler returns a wrapped Error (different from original)
 *   - errorHandler returns null explicitly
 *   - Multiple eventbus.error listeners
 *   - pluginName appears in eventbus.error payload
 *   - Event payload is passed to errorHandler
 */
const {
    initEventBus,
    resetEventBus,
    PluginLoader,
    MemoryAdapter,
    Event,
} = require('../index');

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('Two-tier error handling', () => {
    let bus;

    beforeEach(() => {
        resetEventBus();
        jest.clearAllMocks();
        jest.spyOn(console, 'error').mockImplementation(() => {});

        bus = initEventBus({ adapter : new MemoryAdapter() });
    });

    afterEach(() => {
        console.error.mockRestore();
        resetEventBus();
    });

    // ──────────────────────────────────────────────────────────
    // Scenario 1: No errorHandler → eventbus.error emitted
    // ──────────────────────────────────────────────────────────

    describe('Scenario 1: No errorHandler', () => {

        // Handler throws with no errorHandler → eventbus.error fires with original error
        it('should emit eventbus.error with the original error', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const smtpError = new Error('SMTP connection refused');
            const failingHandler = jest.fn(() => { throw smtpError; });

            bus.on('mail.send', failingHandler, { pluginName : 'mailer' });
            bus.emit('mail.send', { to : 'user@vectoricons.net' });

            await tick();

            expect(console.error).toHaveBeenCalledTimes(1);
            expect(errorListener).toHaveBeenCalledTimes(1);

            const payload = errorListener.mock.calls[0][0].getData();
            expect(payload.error).toBe(smtpError);
            expect(payload.eventName).toBe('mail.send');
            expect(payload.pluginName).toBe('mailer');
        });

        // Handler with no config at all → eventbus.error still fires with pluginName 'unknown'
        it('should use pluginName "unknown" when config has no pluginName', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const failingHandler = jest.fn(() => { throw new Error('Boom'); });
            bus.on('test.event', failingHandler);

            bus.emit('test.event', {});
            await tick();

            const payload = errorListener.mock.calls[0][0].getData();
            expect(payload.pluginName).toBe('unknown');
        });
    });

    // ──────────────────────────────────────────────────────────
    // Scenario 2: errorHandler swallows the error
    // ──────────────────────────────────────────────────────────

    describe('Scenario 2: errorHandler swallows', () => {

        // errorHandler returns undefined → eventbus.error NOT emitted
        it('should not emit eventbus.error when errorHandler returns undefined', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const failingHandler = jest.fn(() => { throw new Error('Transient'); });
            const errorHandler = jest.fn(() => undefined);

            bus.on('mail.send', failingHandler, { pluginName : 'mailer', errorHandler });
            bus.emit('mail.send', { to : 'user@vectoricons.net' });

            await tick();

            expect(console.error).toHaveBeenCalledTimes(1); // always fires
            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(errorListener).not.toHaveBeenCalled();
        });

        // errorHandler returns null explicitly → same as swallow
        it('should not emit eventbus.error when errorHandler returns null', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const failingHandler = jest.fn(() => { throw new Error('Rate limited'); });
            const errorHandler = jest.fn(() => null);

            bus.on('slack.send', failingHandler, { pluginName : 'slack-notifier', errorHandler });
            bus.emit('slack.send', { channel : '#signups' });

            await tick();

            expect(errorHandler).toHaveBeenCalledTimes(1);
            expect(errorListener).not.toHaveBeenCalled();
        });

        // errorHandler returns a non-Error truthy value → swallowed (not an Error instance)
        it('should not emit eventbus.error when errorHandler returns a non-Error truthy value', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const failingHandler = jest.fn(() => { throw new Error('Oops'); });
            const errorHandler = jest.fn(() => 'handled');

            bus.on('test.event', failingHandler, { pluginName : 'test-plugin', errorHandler });
            bus.emit('test.event', {});

            await tick();

            expect(errorListener).not.toHaveBeenCalled();
        });

        // errorHandler receives the error and event as arguments
        it('should pass error and event to errorHandler', async () => {
            const originalError = new Error('Template not found');
            const failingHandler = jest.fn(() => { throw originalError; });
            const errorHandler = jest.fn(() => undefined);

            bus.on('mail.send', failingHandler, { pluginName : 'mailer', errorHandler });
            bus.emit('mail.send', { to : 'admin@vectoricons.net', template : 'missing' });

            await tick();

            expect(errorHandler).toHaveBeenCalledWith(
                originalError,
                expect.objectContaining({
                    getData : expect.any(Function),
                }),
            );

            // Verify the event payload is accessible
            const receivedEvent = errorHandler.mock.calls[0][1];
            expect(receivedEvent.getData().template).toBe('missing');
        });
    });

    // ──────────────────────────────────────────────────────────
    // Scenario 3: errorHandler returns an Error → escalate
    // ──────────────────────────────────────────────────────────

    describe('Scenario 3: errorHandler returns Error', () => {

        // errorHandler returns the original error → eventbus.error with that error
        it('should emit eventbus.error with the original error when returned', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const originalError = new Error('SMTP timeout');
            const failingHandler = jest.fn(() => { throw originalError; });
            const errorHandler = jest.fn((error) => error);

            bus.on('mail.send', failingHandler, { pluginName : 'mailer', errorHandler });
            bus.emit('mail.send', { to : 'user@vectoricons.net' });

            await tick();

            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener.mock.calls[0][0].getData().error).toBe(originalError);
        });

        // errorHandler returns a DIFFERENT Error → eventbus.error with the new error
        it('should emit eventbus.error with a wrapped error when returned', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const originalError = new Error('SMTP timeout');
            const wrappedError = new Error(`Mailer failed: ${originalError.message}`);

            const failingHandler = jest.fn(() => { throw originalError; });
            const errorHandler = jest.fn(() => wrappedError);

            bus.on('mail.send', failingHandler, { pluginName : 'mailer', errorHandler });
            bus.emit('mail.send', { to : 'user@vectoricons.net' });

            await tick();

            expect(errorListener).toHaveBeenCalledTimes(1);
            const payload = errorListener.mock.calls[0][0].getData();
            expect(payload.error).toBe(wrappedError);
            expect(payload.error).not.toBe(originalError);
        });

        // errorHandler returns a custom Error subclass → still triggers eventbus.error
        it('should emit eventbus.error when errorHandler returns a custom Error subclass', async () => {
            class SmtpError extends Error {
                constructor(message) {
                    super(message);
                    this.name = 'SmtpError';
                }
            }

            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const failingHandler = jest.fn(() => { throw new Error('SMTP failed'); });
            const errorHandler = jest.fn(() => new SmtpError('Wrapped as SmtpError'));

            bus.on('mail.send', failingHandler, { pluginName : 'mailer', errorHandler });
            bus.emit('mail.send', { to : 'user@vectoricons.net' });

            await tick();

            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener.mock.calls[0][0].getData().error).toBeInstanceOf(SmtpError);
        });
    });

    // ──────────────────────────────────────────────────────────
    // Scenario 4: errorHandler itself throws
    // ──────────────────────────────────────────────────────────

    describe('Scenario 4: errorHandler throws', () => {

        // errorHandler throws → console.error (×2) + eventbus.error with original error
        it('should emit eventbus.error with original error when errorHandler throws', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const originalError = new Error('Handler failed');
            const failingHandler = jest.fn(() => { throw originalError; });
            const errorHandler = jest.fn(() => { throw new Error('errorHandler also failed'); });

            bus.on('test.event', failingHandler, { pluginName : 'broken-plugin', errorHandler });
            bus.emit('test.event', {});

            await tick();

            // console.error: once for original handler error, once for errorHandler error
            expect(console.error).toHaveBeenCalledTimes(2);

            // eventbus.error is emitted with the ORIGINAL error (not the errorHandler error)
            expect(errorListener).toHaveBeenCalledTimes(1);
            expect(errorListener.mock.calls[0][0].getData().error).toBe(originalError);
            expect(errorListener.mock.calls[0][0].getData().pluginName).toBe('broken-plugin');
        });
    });

    // ──────────────────────────────────────────────────────────
    // Scenario 5: eventbus.error listener throws (recursion guard)
    // ──────────────────────────────────────────────────────────

    describe('Scenario 5: eventbus.error listener throws (recursion guard)', () => {

        // eventbus.error handler throws → console.error only, no re-emission
        it('should not re-emit eventbus.error (prevents infinite recursion)', async () => {
            let eventbusErrorCallCount = 0;

            bus.on('eventbus.error', () => {
                eventbusErrorCallCount++;
                throw new Error('Error handler also exploded');
            });

            const failingHandler = jest.fn(() => { throw new Error('Original failure'); });
            bus.on('test.event', failingHandler);

            bus.emit('test.event', {});
            await tick();

            // eventbus.error handler fired exactly once (not recursively)
            expect(eventbusErrorCallCount).toBe(1);

            // console.error called twice: once for original, once for eventbus.error handler
            expect(console.error).toHaveBeenCalledTimes(2);
        });

        // Multiple eventbus.error listeners — all fire, but if one throws, no re-emission
        it('should fire all eventbus.error listeners even if one throws', async () => {
            const survivingListener = jest.fn();

            bus.on('eventbus.error', () => {
                throw new Error('First listener exploded');
            });
            bus.on('eventbus.error', survivingListener);

            const failingHandler = jest.fn(() => { throw new Error('Original failure'); });
            bus.on('test.event', failingHandler);

            bus.emit('test.event', {});
            await tick();

            // The surviving listener still fires (mitt delivers to all listeners)
            expect(survivingListener).toHaveBeenCalledTimes(1);
        });
    });

    // ──────────────────────────────────────────────────────────
    // Integration: PluginLoader + safeRun end-to-end
    // ──────────────────────────────────────────────────────────

    describe('PluginLoader + safeRun integration', () => {

        // Plugin registered via PluginLoader with errorHandler → config flows to safeRun
        it('should wire errorHandler from plugin definition through to safeRun', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const loader = new PluginLoader({ eventBus : bus });

            const originalError = new Error('Slack API rate limit');
            const plugin = {
                name         : 'slack-notifier',
                errorHandler : (error) => {
                    if (error.message.includes('rate limit')) {
                        return undefined; // swallow rate limit errors
                    }
                    return error;
                },
                events : [{
                    type    : 'slack.send',
                    handler : () => { throw originalError; },
                }],
            };

            loader.register(plugin);
            bus.emit('slack.send', { channel : '#errors', message : 'Test' });

            await tick();

            // errorHandler swallowed the rate limit error
            expect(errorListener).not.toHaveBeenCalled();
            expect(console.error).toHaveBeenCalledTimes(1);
        });

        // Factory plugin with errorHandler that escalates
        it('should support factory plugins with errorHandler through full chain', async () => {
            const errorListener = jest.fn();
            bus.on('eventbus.error', errorListener);

            const emitter = bus.createEmitter();
            const loader = new PluginLoader({
                eventBus : bus,
                context  : { emitter },
            });

            const factory = (context) => ({
                name         : 'orchestrator',
                errorHandler : (error) => error, // always escalate
                events       : [{
                    type    : 'user.signup',
                    handler : () => { throw new Error('Orchestration failed'); },
                }],
            });

            loader.register(factory);
            bus.emit('user.signup', { email : 'jane@vectoricons.net' });

            await tick();

            expect(errorListener).toHaveBeenCalledTimes(1);
            const payload = errorListener.mock.calls[0][0].getData();
            expect(payload.pluginName).toBe('orchestrator');
            expect(payload.eventName).toBe('user.signup');
            expect(payload.error.message).toBe('Orchestration failed');
        });
    });
});
