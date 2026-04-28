/**
 * @module event-bus/adapters/BaseEventBusAdapter
 * @description Interface contract for EventBus adapters.
 *
 * Implement this class to create a custom adapter (e.g. Redis, SQS).
 * The MemoryAdapter is the only built-in implementation.
 *
 * @example
 * class MyAdapter extends BaseEventBusAdapter {
 *     on(event, handler)    { ... }
 *     off(event, handler)   { ... }
 *     once(event, handler)  { ... }
 *     emit(event, payload)  { ... }
 *     clear()               { ... }
 * }
 */
class BaseEventBusAdapter {

    /**
     * Register a persistent listener for an event.
     * @param {string} event - The event name.
     * @param {Function} handler - The handler function.
     */
    on(event, handler) {
        throw new Error('on() not implemented');
    }

    /**
     * Remove a listener for an event.
     * @param {string} event - The event name.
     * @param {Function} handler - The handler function to remove.
     */
    off(event, handler) {
        throw new Error('off() not implemented');
    }

    /**
     * Register a one-time listener for an event.
     * @param {string} event - The event name.
     * @param {Function} handler - The handler function (called once, then removed).
     */
    once(event, handler) {
        throw new Error('once() not implemented');
    }

    /**
     * Emit an event with a payload to all registered listeners.
     * @param {string} event - The event name.
     * @param {*} payload - The event payload.
     */
    emit(event, payload) {
        throw new Error('emit() not implemented');
    }

    /**
     * Remove all listeners for all events.
     */
    clear() {
        throw new Error('clear() not implemented');
    }
}

module.exports = BaseEventBusAdapter;
