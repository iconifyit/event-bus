/**
 * WriteEmitter tests.
 *
 * Tests cover: construction validation, emit delegation, write-only surface,
 * and integration with EventBus.createEmitter().
 */
const {
    initEventBus,
    resetEventBus,
    WriteEmitter,
    MemoryAdapter,
    Event,
} = require('../index');

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));

describe('WriteEmitter', () => {

    afterEach(() => {
        resetEventBus();
    });

    describe('constructor', () => {

        // Scenario: WriteEmitter requires a function — passing a non-function throws
        it('should throw if emitFn is not a function', () => {
            expect(() => new WriteEmitter()).toThrow('WriteEmitter requires an emit function');
            expect(() => new WriteEmitter(null)).toThrow('WriteEmitter requires an emit function');
            expect(() => new WriteEmitter('not-a-function')).toThrow('WriteEmitter requires an emit function');
            expect(() => new WriteEmitter(42)).toThrow('WriteEmitter requires an emit function');
            expect(() => new WriteEmitter({})).toThrow('WriteEmitter requires an emit function');
        });

        // Scenario: WriteEmitter accepts a valid function without throwing
        it('should accept a valid emit function', () => {
            const emitFn = jest.fn();
            const emitter = new WriteEmitter(emitFn);
            expect(emitter).toBeInstanceOf(WriteEmitter);
        });
    });

    describe('emit()', () => {

        // Scenario: emit() delegates to the underlying function with correct arguments
        it('should delegate to the underlying emit function', () => {
            const emitFn = jest.fn().mockReturnValue(true);
            const emitter = new WriteEmitter(emitFn);

            const result = emitter.emit('mail.send', { to : 'user@vectoricons.net' });

            expect(emitFn).toHaveBeenCalledTimes(1);
            expect(emitFn).toHaveBeenCalledWith('mail.send', { to : 'user@vectoricons.net' });
            expect(result).toBe(true);
        });

        // Scenario: emit() passes through the return value from the underlying function
        it('should return false when the underlying function returns false', () => {
            const emitFn = jest.fn().mockReturnValue(false);
            const emitter = new WriteEmitter(emitFn);

            const result = emitter.emit(null);

            expect(result).toBe(false);
        });

        // Scenario: emit() works with no data argument (optional payload)
        it('should work without a data argument', () => {
            const emitFn = jest.fn().mockReturnValue(true);
            const emitter = new WriteEmitter(emitFn);

            emitter.emit('user.logout');

            expect(emitFn).toHaveBeenCalledWith('user.logout', undefined);
        });
    });

    describe('write-only surface', () => {

        // Scenario: WriteEmitter only exposes emit() — no on, off, once, clear
        it('should not expose subscription methods', () => {
            const emitter = new WriteEmitter(jest.fn());

            expect(typeof emitter.emit).toBe('function');
            expect(emitter.on).toBeUndefined();
            expect(emitter.off).toBeUndefined();
            expect(emitter.once).toBeUndefined();
            expect(emitter.clear).toBeUndefined();
        });

        // Scenario: The internal _emit reference is not easily enumerable
        it('should not leak the internal emit function via JSON serialization', () => {
            const emitFn = jest.fn();
            const emitter = new WriteEmitter(emitFn);
            const serialized = JSON.stringify(emitter);
            const parsed = JSON.parse(serialized);

            // _emit is a function and won't serialize — the object should be empty or minimal
            expect(parsed._emit).toBeUndefined();
        });
    });

    describe('EventBus.createEmitter() integration', () => {

        // Scenario: bus.createEmitter() returns a WriteEmitter instance
        it('should return a WriteEmitter instance', () => {
            const bus = initEventBus({ adapter : new MemoryAdapter() });
            const emitter = bus.createEmitter();

            expect(emitter).toBeInstanceOf(WriteEmitter);
        });

        // Scenario: Emitter created by bus.createEmitter() delivers events to bus listeners
        it('should emit events that reach bus listeners', async () => {
            const bus = initEventBus({ adapter : new MemoryAdapter() });
            const emitter = bus.createEmitter();
            const handler = jest.fn();

            bus.on('mail.send', handler);
            emitter.emit('mail.send', { to : 'admin@vectoricons.net', subject : 'Test' });

            await tick();

            expect(handler).toHaveBeenCalledTimes(1);
            const event = handler.mock.calls[0][0];
            expect(event).toBeInstanceOf(Event);
            expect(event.getName()).toBe('mail.send');
            expect(event.getData()).toEqual({ to : 'admin@vectoricons.net', subject : 'Test' });
        });

        // Scenario: Multiple emitters from the same bus all route to the same listeners
        it('should support multiple emitters from the same bus', async () => {
            const bus = initEventBus({ adapter : new MemoryAdapter() });
            const emitterA = bus.createEmitter();
            const emitterB = bus.createEmitter();
            const handler = jest.fn();

            bus.on('slack.send', handler);

            emitterA.emit('slack.send', { channel : '#general', message : 'From A' });
            emitterB.emit('slack.send', { channel : '#general', message : 'From B' });

            await tick();

            expect(handler).toHaveBeenCalledTimes(2);
            expect(handler.mock.calls[0][0].getData()).toEqual({ channel : '#general', message : 'From A' });
            expect(handler.mock.calls[1][0].getData()).toEqual({ channel : '#general', message : 'From B' });
        });

        // Scenario: Emitter returns false when no event type is provided (mirrors bus.emit behavior)
        it('should return false for empty event type', () => {
            const bus = initEventBus({ adapter : new MemoryAdapter() });
            const emitter = bus.createEmitter();

            expect(emitter.emit(null)).toBe(false);
            expect(emitter.emit('')).toBe(false);
            expect(emitter.emit(undefined)).toBe(false);
        });
    });
});
