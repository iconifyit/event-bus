/**
 * @module @vectoricons.net/event-bus
 * @description A lightweight, adapter-based EventBus for Node.js with immutable
 * event objects, a plugin registration system, and per-handler error notification.
 *
 * ## Quick Start
 *
 * ```js
 * const {
 *     initEventBus,
 *     EventTypes,
 *     registerEventType,
 *     registerEventTypes,
 *     PluginLoader,
 * } = require('@vectoricons.net/event-bus');
 *
 * // 1. Define your event types
 * registerEventTypes({
 *     USER_SIGNUP : 'user.signup',
 *     USER_LOGIN  : 'user.login',
 * });
 *
 * // 2. Initialize the bus (singleton)
 * const bus = initEventBus({
 *     notifiers: {
 *         slack: mySlackNotifier,  // implements BaseNotifier
 *     },
 * });
 *
 * // 3. Register plugins
 * const loader = new PluginLoader(bus);
 * loader.register(require('./plugins/welcome-email'));
 *
 * // 4. Emit events
 * bus.emit(EventTypes.USER_SIGNUP, { userId: 42, email: 'user@example.com' });
 * ```
 */
const EventBus          = require('./src/EventBus');
const Event             = require('./src/Event');
const PluginLoader      = require('./src/PluginLoader');
const MemoryAdapter     = require('./src/adapters/MemoryAdapter');
const BaseEventBusAdapter = require('./src/adapters/BaseEventBusAdapter');
const BaseNotifier      = require('./src/notifiers/BaseNotifier');

const {
    EventTypes,
    registerEventType,
    registerEventTypes,
    getEventTypes,
} = require('./src/EventTypes');

let singleton = null;

/**
 * Initialize the EventBus singleton.
 * Subsequent calls return the same instance.
 *
 * @param {Object} [options={}]
 * @param {import('./src/adapters/BaseEventBusAdapter')} [options.adapter]
 *   Adapter instance. Defaults to a new MemoryAdapter.
 * @param {Object<string, import('./src/notifiers/BaseNotifier')>} [options.notifiers={}]
 *   Named notifier instances for error handling.
 * @returns {EventBus} The singleton EventBus instance.
 *
 * @example
 * const bus = initEventBus({
 *     notifiers: {
 *         slack : new MySlackNotifier('#site-errors'),
 *         email : new MyEmailNotifier('admin@example.com'),
 *     },
 * });
 */
const initEventBus = ({ adapter, notifiers = {} } = {}) => {
    if (singleton) return singleton;

    singleton = new EventBus({
        adapter   : adapter || new MemoryAdapter(),
        notifiers,
    });

    return singleton;
};

/**
 * Get the current EventBus singleton, or null if not yet initialized.
 *
 * @returns {EventBus|null}
 */
const getEventBus = () => singleton;

/**
 * Reset the singleton (primarily for testing).
 * Clears all listeners and destroys the singleton reference.
 */
const resetEventBus = () => {
    if (singleton) {
        singleton.clear();
    }
    singleton = null;
};

module.exports = {
    initEventBus,
    getEventBus,
    resetEventBus,
    EventBus,
    Event,
    EventTypes,
    registerEventType,
    registerEventTypes,
    getEventTypes,
    PluginLoader,
    MemoryAdapter,
    BaseEventBusAdapter,
    BaseNotifier,
};
