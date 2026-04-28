/**
 * @module event-bus/EventBus
 * @description Core EventBus class with adapter-based pub/sub,
 * per-handler error notification, and injectable notifiers.
 *
 * The EventBus wraps every handler in a safe-run envelope that catches
 * errors and dispatches them to configured notifiers. Notifiers are
 * injected at construction time — the package ships no concrete notifiers.
 *
 * @example
 * const EventBus = require('./EventBus');
 * const bus = new EventBus({
 *     adapter   : new MemoryAdapter(),
 *     notifiers : {
 *         slack : mySlackNotifier,
 *         email : myEmailNotifier,
 *     },
 * });
 *
 * bus.on('user.signup', handler, { onError: { notify: ['slack'] } });
 * bus.emit('user.signup', { userId: 42 });
 */
const Event = require('./Event');

class EventBus {

    /**
     * Create an EventBus instance.
     *
     * @param {Object} options
     * @param {import('./adapters/BaseEventBusAdapter')} options.adapter - The pub/sub adapter.
     * @param {Object<string, import('./notifiers/BaseNotifier')>} [options.notifiers={}]
     *   Named notifier instances. Keys are used in handler config
     *   (e.g. `{ onError: { notify: ['slack'] } }`).
     */
    constructor({ adapter, notifiers = {} } = {}) {
        if (!adapter) {
            throw new Error('EventBus requires an adapter');
        }
        this.adapter         = adapter;
        this.notifiers       = notifiers;

        /**
         * Maps each original handler → Map<eventName, config>.
         * Scoped by event so the same handler can be registered
         * for multiple events without overwriting configs.
         * @type {WeakMap<Function, Map<string, Object>>}
         * @private
         */
        this.handlerConfigs = new WeakMap();

        /**
         * Maps each original handler → Map<eventName, wrappedFn>.
         * Scoped by event so off() removes the correct wrapper.
         * @type {WeakMap<Function, Map<string, Function>>}
         * @private
         */
        this.wrappedHandlers = new WeakMap();
    }

    /**
     * Replace the adapter at runtime (e.g. swap Memory for Redis).
     *
     * **Important:** This does NOT migrate existing listeners. Call this
     * before registering any handlers, or call `clear()` first and
     * re-register handlers after swapping.
     *
     * @param {import('./adapters/BaseEventBusAdapter')} nextAdapter
     *
     * @todo Add optional listener migration — replay existing registrations
     *   onto the new adapter and remove them from the old one, so handlers
     *   survive a hot-swap without manual re-registration.
     */
    setAdapter(nextAdapter) {
        if (!nextAdapter || typeof nextAdapter.on !== 'function') {
            throw new Error('EventBus.setAdapter requires a valid adapter instance');
        }
        this.adapter = nextAdapter;
    }

    /**
     * Register a persistent listener for an event.
     *
     * @param {string} event - The event name (use EventTypes constants).
     * @param {Function} handler - Async handler receiving an Event instance.
     * @param {Object} [config={}] - Handler configuration.
     * @param {Object} [config.onError] - Error handling config.
     * @param {string[]} [config.onError.notify] - Notifier names to invoke on error.
     *
     * @example
     * bus.on(EventTypes.USER_SIGNUP, async (event) => {
     *     await sendWelcomeEmail(event.getData().email);
     * }, { onError: { notify: ['slack', 'email'] } });
     */
    on(event, handler, config = {}) {
        if (!event || !handler) return;

        const wrapped = async (payload) => {
            await this.safeRun(event, handler, payload);
        };

        if (!this.handlerConfigs.has(handler)) {
            this.handlerConfigs.set(handler, new Map());
        }
        if (!this.wrappedHandlers.has(handler)) {
            this.wrappedHandlers.set(handler, new Map());
        }

        this.handlerConfigs.get(handler).set(event, config);
        this.wrappedHandlers.get(handler).set(event, wrapped);
        this.adapter.on(event, wrapped);
    }

    /**
     * Remove a previously registered listener.
     *
     * @param {string} event - The event name.
     * @param {Function} handler - The original handler function passed to `on()`.
     */
    off(event, handler) {
        if (!event || !handler) return;

        const wrappedMap = this.wrappedHandlers.get(handler);
        if (!wrappedMap) return;

        const wrapped = wrappedMap.get(event);
        if (!wrapped) return;

        this.adapter.off(event, wrapped);
        wrappedMap.delete(event);

        const configMap = this.handlerConfigs.get(handler);
        if (configMap) {
            configMap.delete(event);
        }

        // Clean up outer maps if no events remain for this handler
        if (wrappedMap.size === 0) this.wrappedHandlers.delete(handler);
        if (configMap && configMap.size === 0) this.handlerConfigs.delete(handler);
    }

    /**
     * Register a one-time listener. The handler is automatically removed
     * after its first invocation.
     *
     * @param {string} event - The event name.
     * @param {Function} handler - Async handler receiving an Event instance.
     * @param {Object} [config={}] - Handler configuration (same shape as `on()`).
     */
    once(event, handler, config = {}) {
        if (!event || !handler) return;

        const wrapped = async (payload) => {
            await this.safeRun(event, handler, payload);
        };

        if (!this.handlerConfigs.has(handler)) {
            this.handlerConfigs.set(handler, new Map());
        }
        if (!this.wrappedHandlers.has(handler)) {
            this.wrappedHandlers.set(handler, new Map());
        }

        this.handlerConfigs.get(handler).set(event, config);
        this.wrappedHandlers.get(handler).set(event, wrapped);
        this.adapter.once(event, wrapped);
    }

    /**
     * Emit an event. The payload is wrapped in an immutable Event object
     * before being dispatched to listeners.
     *
     * @param {string} event - The event name.
     * @param {Object} [payload={}] - The event data.
     * @returns {boolean} `true` if the event was emitted, `false` if no event name was provided.
     *
     * @example
     * bus.emit(EventTypes.ORDER_CONFIRMATION, {
     *     orderId : 'order-123',
     *     userId  : 42,
     *     total   : 19.99,
     * });
     */
    emit(event, payload) {
        if (!event) return false;
        this.adapter.emit(event, Event.create(event, payload));
        return true;
    }

    /**
     * Remove all listeners and reset internal state.
     */
    clear() {
        this.adapter.clear();
        this.handlerConfigs  = new WeakMap();
        this.wrappedHandlers = new WeakMap();
    }

    /**
     * Execute a handler inside a try/catch envelope. On error, dispatches
     * to the notifiers specified in the handler's config.
     *
     * @param {string} eventName - The event name (for error messages).
     * @param {Function} handler - The original handler function.
     * @param {*} payload - The Event payload passed to the handler.
     * @private
     */
    async safeRun(eventName, handler, payload) {
        try {
            await handler(payload);
        }
        catch (error) {
            console.error(`[EventBus] Error in handler for "${eventName}":`, error);

            const configMap      = this.handlerConfigs.get(handler);
            const config         = (configMap && configMap.get(eventName)) || {};
            const notifierNames  = config?.onError?.notify || [];
            const subject        = `Error in EventBus handler for "${eventName}"`;
            const tasks          = [];

            for (const name of notifierNames) {
                const notifier = this.notifiers[name];
                if (notifier && typeof notifier.notify === 'function') {
                    // Wrap in Promise.resolve().then() so synchronous throws
                    // become rejected promises contained by allSettled.
                    tasks.push(
                        Promise.resolve().then(() => notifier.notify(subject, error))
                    );
                }
            }

            if (tasks.length > 0) {
                await Promise.allSettled(tasks);
            }
        }
    }
}

module.exports = EventBus;
