/**
 * @module event-bus/WriteEmitter
 * @description Write-only emitter that exposes a single `emit()` method.
 *
 * Created by `EventBus.createEmitter()` and placed in the application context
 * so plugins can publish events without holding a reference to the full EventBus.
 * This breaks the circular dependency between the bus (which owns plugins via
 * PluginLoader) and the plugins (which need to emit events).
 *
 * The WriteEmitter intentionally does NOT expose `on()`, `off()`, `once()`,
 * `clear()`, or any other subscription method. Plugins can publish events
 * but cannot subscribe, unsubscribe, or inspect the bus.
 *
 * @example
 * // Created by the EventBus — not instantiated directly by application code.
 * const emitter = bus.createEmitter();
 *
 * // Plugins receive it via context:
 * module.exports = (context) => ({
 *     name   : 'signup-notifications',
 *     events : [{
 *         type    : 'user.signup',
 *         handler : async (event) => {
 *             context.emitter.emit('mail.send', { to: event.getData().email });
 *         },
 *     }],
 * });
 */

class WriteEmitter {

    /**
     * Create a WriteEmitter.
     *
     * @param {Function} emitFn - The bound `emit` method from an EventBus instance.
     *                            Must accept `(type, data)` arguments.
     */
    constructor(emitFn) {
        if (typeof emitFn !== 'function') {
            throw new Error('WriteEmitter requires an emit function');
        }
        // Define `_emit` as non-enumerable, non-writable, and
        // non-configurable so consumers and plugins cannot discover and
        // call it directly via `Object.keys(emitter)`, `{ ...emitter }`,
        // or reassign it to substitute a different sink. The whole point
        // of WriteEmitter is to expose `emit()` and nothing else; a
        // plain `this._emit = emitFn` made `_emit` enumerable and
        // publicly assignable, defeating the "single emit() method"
        // intent.
        Object.defineProperty(this, '_emit', {
            value        : emitFn,
            writable     : false,
            enumerable   : false,
            configurable : false,
        });
    }

    /**
     * Emit an event through the underlying EventBus.
     *
     * @param {string} type - The event name (e.g. 'mail.send', 'slack.send').
     * @param {Object} [data={}] - The event payload.
     * @returns {boolean} `true` if the event was emitted, `false` if no type was provided.
     *
     * @example
     * context.emitter.emit('mail.send', {
     *     to       : 'user@example.com',
     *     subject  : 'Welcome!',
     *     template : 'welcome-offer',
     *     data     : { name : 'Jane' },
     * });
     */
    emit(type, data) {
        return this._emit(type, data);
    }
}

module.exports = WriteEmitter;
