/**
 * @module event-bus/utils
 * @description Utility functions for the EventBus package.
 */

/**
 * Recursively deep-freeze an object and all nested objects.
 * Handles circular references via a WeakSet.
 *
 * @param {*} value - The value to freeze.
 * @param {WeakSet} [seen] - Internal tracker for circular reference detection.
 * @returns {*} The frozen value.
 */
const deepFreeze = (value, seen = new WeakSet()) => {
    if (value == null || typeof value !== 'object' || seen.has(value)) {
        return value;
    }

    seen.add(value);

    if (Array.isArray(value)) {
        for (const item of value) {
            deepFreeze(item, seen);
        }
    }
    else {
        for (const key of Reflect.ownKeys(value)) {
            const desc = Object.getOwnPropertyDescriptor(value, key);
            if (desc && 'value' in desc && desc.value && typeof desc.value === 'object') {
                deepFreeze(desc.value, seen);
            }
        }
    }

    return Object.freeze(value);
};

module.exports = { deepFreeze };
