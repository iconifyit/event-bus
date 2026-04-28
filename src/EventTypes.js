/**
 * @module event-bus/EventTypes
 * @description Dynamic event type registry.
 *
 * The EventBus package ships with NO built-in event types. Consumers define
 * their own events via `registerEventType()` or `registerEventTypes()`.
 * This keeps the package generic and reusable across projects.
 *
 * @example
 * const { EventTypes, registerEventType, registerEventTypes } = require('./EventTypes');
 *
 * // Register a single event type
 * registerEventType('USER_SIGNUP', 'user.signup');
 *
 * // Register multiple event types at once
 * registerEventTypes({
 *     USER_LOGIN  : 'user.login',
 *     USER_LOGOUT : 'user.logout',
 * });
 *
 * // Use the registered types
 * EventBus.on(EventTypes.USER_SIGNUP, handler);
 */

const registry = {};

/**
 * Register a single event type.
 *
 * @param {string} name - The constant name (e.g. 'USER_SIGNUP').
 * @param {string} value - The event string (e.g. 'user.signup').
 * @throws {Error} If the name is already registered with a different value.
 */
const registerEventType = (name, value) => {
    if (!name || typeof name !== 'string') {
        throw new Error('registerEventType requires a non-empty string name');
    }
    if (!value || typeof value !== 'string') {
        throw new Error('registerEventType requires a non-empty string value');
    }
    if (registry[name] && registry[name] !== value) {
        throw new Error(`EventType "${name}" is already registered as "${registry[name]}"`);
    }
    registry[name] = value;
};

/**
 * Register multiple event types at once.
 *
 * @param {Object<string, string>} types - A map of name → value pairs.
 *
 * @example
 * registerEventTypes({
 *     ORDER_CONFIRMATION : 'order.confirmation',
 *     ORDER_REFUND       : 'order.refund',
 * });
 */
const registerEventTypes = (types) => {
    if (!types || typeof types !== 'object') {
        throw new Error('registerEventTypes requires a non-null object');
    }
    for (const [name, value] of Object.entries(types)) {
        registerEventType(name, value);
    }
};

/**
 * Get all registered event types as a frozen object.
 *
 * @returns {Object<string, string>} A frozen copy of the registry.
 */
const getEventTypes = () => {
    return Object.freeze({ ...registry });
};

/**
 * A Proxy that allows direct property access to registered event types.
 * Accessing an unregistered name returns `undefined`.
 *
 * @example
 * EventTypes.USER_SIGNUP // => 'user.signup'
 * EventTypes.UNKNOWN     // => undefined
 */
/**
 * Throws a read-only error for any mutation attempt on EventTypes.
 * @throws {Error} Always throws.
 * @private
 */
const throwReadOnlyError = () => {
    throw new Error('EventTypes is read-only. Use registerEventType() to add event types.');
};

const EventTypes = new Proxy(registry, {
    get(target, prop) {
        return target[prop];
    },
    set() {
        throwReadOnlyError();
    },
    deleteProperty() {
        throwReadOnlyError();
    },
    defineProperty() {
        throwReadOnlyError();
    },
    setPrototypeOf() {
        throwReadOnlyError();
    },
    preventExtensions() {
        throwReadOnlyError();
    },
});

module.exports = {
    EventTypes,
    registerEventType,
    registerEventTypes,
    getEventTypes,
};
