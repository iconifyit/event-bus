/**
 * @module event-bus/PluginLoader
 * @description Validates and registers EventBus plugins.
 *
 * Plugins are explicitly required and registered by the consumer.
 * No directory scanning, no auto-loading. Invalid plugins log warnings
 * but do not crash the application.
 *
 * ## Plugin Contract
 *
 * A plugin is a plain object with:
 * - `name` {string} — unique plugin identifier
 * - `events` {Array<Object>} — event handler definitions, each with:
 *   - `type` {string} — the event name to listen for
 *   - `handler` {Function} — async handler receiving an Event instance
 *   - `config` {Object} [optional] — handler config (e.g. `{ onError: { notify: ['slack'] } }`)
 *   - `once` {boolean} [optional] — if true, handler fires once then unregisters
 *
 * @example
 * const plugin = {
 *     name   : 'welcome-offer',
 *     events : [
 *         {
 *             type    : 'user.verify-email',
 *             handler : async (event) => { await sendWelcomeOffer(event); },
 *             config  : { onError: { notify: ['slack'] } },
 *         },
 *     ],
 * };
 *
 * const loader = new PluginLoader(eventBus);
 * loader.register(plugin);
 */

class PluginLoader {

    /**
     * Create a PluginLoader.
     *
     * @param {import('./EventBus')} eventBus - The EventBus instance to register handlers on.
     */
    constructor(eventBus) {
        if (!eventBus) {
            throw new Error('PluginLoader requires an EventBus instance');
        }
        this.eventBus        = eventBus;
        this.registeredNames = new Set();
    }

    /**
     * Validate and register a single plugin.
     *
     * @param {Object} plugin - The plugin definition.
     * @param {string} plugin.name - Unique plugin name.
     * @param {Array<Object>} plugin.events - Event handler definitions.
     * @returns {boolean} `true` if the plugin was registered, `false` if validation failed.
     */
    register(plugin) {
        const errors = this.validate(plugin);
        if (errors.length > 0) {
            console.warn(`[PluginLoader] Skipping invalid plugin "${plugin?.name || 'unknown'}":`, errors);
            return false;
        }

        if (this.registeredNames.has(plugin.name)) {
            console.warn(`[PluginLoader] Plugin "${plugin.name}" is already registered. Skipping.`);
            return false;
        }

        for (const eventDef of plugin.events) {
            const method = eventDef.once ? 'once' : 'on';
            this.eventBus[method](eventDef.type, eventDef.handler, eventDef.config || {});
        }

        this.registeredNames.add(plugin.name);
        return true;
    }

    /**
     * Register multiple plugins at once.
     *
     * @param {Array<Object>} plugins - Array of plugin definitions.
     * @returns {Object} Summary of registration results.
     * @returns {string[]} return.registered - Names of successfully registered plugins.
     * @returns {string[]} return.skipped - Names of skipped plugins.
     */
    registerAll(plugins) {
        const registered = [];
        const skipped    = [];

        for (const plugin of plugins) {
            const success = this.register(plugin);
            if (success) {
                registered.push(plugin.name);
            }
            else {
                skipped.push(plugin?.name || 'unknown');
            }
        }

        return { registered, skipped };
    }

    /**
     * Validate a plugin against the expected contract.
     *
     * @param {Object} plugin - The plugin to validate.
     * @returns {string[]} An array of validation error messages. Empty if valid.
     */
    validate(plugin) {
        const errors = [];

        if (!plugin || typeof plugin !== 'object') {
            return ['Plugin must be a non-null object'];
        }

        if (!plugin.name || typeof plugin.name !== 'string') {
            errors.push('Plugin must have a non-empty string "name" property');
        }

        if (!Array.isArray(plugin.events) || plugin.events.length === 0) {
            errors.push('Plugin must have a non-empty "events" array');
        }
        else {
            plugin.events.forEach((eventDef, index) => {
                if (!eventDef || typeof eventDef !== 'object') {
                    errors.push(`events[${index}] must be a non-null object`);
                    return;
                }
                if (!eventDef.type || typeof eventDef.type !== 'string') {
                    errors.push(`events[${index}] must have a non-empty string "type"`);
                }
                if (typeof eventDef.handler !== 'function') {
                    errors.push(`events[${index}] must have a "handler" function`);
                }
            });
        }

        return errors;
    }

    /**
     * Check whether a plugin name has been registered.
     *
     * @param {string} name - The plugin name.
     * @returns {boolean}
     */
    isRegistered(name) {
        return this.registeredNames.has(name);
    }

    /**
     * Get all registered plugin names.
     *
     * @returns {string[]}
     */
    getRegisteredNames() {
        return Array.from(this.registeredNames);
    }
}

module.exports = PluginLoader;
