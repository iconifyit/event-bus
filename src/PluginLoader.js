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
 * A plugin is either a **plain object** or a **factory function** that returns
 * a plain object. Factory functions receive an opaque `context` parameter.
 *
 * Plain object shape:
 * - `name` {string} — unique plugin identifier
 * - `events` {Array<Object>} — event handler definitions, each with:
 *   - `type` {string} — the event name to listen for
 *   - `handler` {Function} — async handler receiving an Event instance
 *   - `config` {Object} [optional] — handler config passed to EventBus.on()
 *   - `once` {boolean} [optional] — if true, handler fires once then unregisters
 * - `errorHandler` {Function} [optional] — plugin-level error handler
 *   `(error, event) => Error|*`. Return an Error to escalate; return anything
 *   else to swallow.
 *
 * Factory function shape:
 * - `(context) => pluginObject`
 *
 * @example
 * // Plain object plugin
 * const plugin = {
 *     name   : 'welcome-offer',
 *     events : [
 *         {
 *             type    : 'user.verify-email',
 *             handler : async (event) => { await sendWelcomeOffer(event); },
 *         },
 *     ],
 * };
 *
 * const loader = new PluginLoader({ eventBus });
 * loader.register(plugin);
 *
 * @example
 * // Factory function plugin with context injection
 * const pluginFactory = (context) => ({
 *     name   : 'mailer',
 *     events : [{
 *         type    : 'mail.send',
 *         handler : async (event) => {
 *             const html = context.templateService.render(event.getData().template);
 *             await context.mailService.send({ content: html });
 *         },
 *     }],
 *     errorHandler : (error, event) => {
 *         if (error.code === 'ECONNREFUSED') return undefined; // swallow transient
 *         return error; // escalate everything else
 *     },
 * });
 *
 * const loader = new PluginLoader({ eventBus, context: appContext });
 * loader.register(pluginFactory);
 */

class PluginLoader {

    /**
     * Create a PluginLoader.
     *
     * @param {Object} options
     * @param {import('./EventBus')} options.eventBus - The EventBus instance to register handlers on.
     * @param {Object} [options.context={}] - Opaque context object passed to plugin factory functions.
     *                                        The PluginLoader has no opinion on what this contains.
     */
    constructor(options) {
        // Backward compatibility: accept a bare EventBus instance (pre-v1.1.0 API)
        if (options && typeof options.on === 'function' && typeof options.emit === 'function') {
            this.eventBus = options;
            this.context  = {};
        }
        else if (options && options.eventBus) {
            this.eventBus = options.eventBus;
            this.context  = options.context || {};
        }
        else {
            throw new Error('PluginLoader requires an EventBus instance');
        }

        this.registeredNames = new Set();
    }

    /**
     * Resolve a plugin input to a plain object. If the input is a function
     * (factory), call it with the context. Otherwise return as-is.
     *
     * If the factory throws, the error is logged and `null` is returned so
     * the caller can skip the plugin without crashing the application —
     * matching the module-header guarantee that invalid plugins are skipped
     * rather than fatal. A null result fails validate(); `register()`
     * additionally checks whether the original input was a factory and
     * reports the skip with a specific "Factory function threw" message
     * rather than the generic "Plugin must be a non-null object."
     *
     * @param {Object|Function} pluginInput - A plugin definition or factory function.
     * @returns {Object|null} The resolved plugin definition, or null if a
     *   factory threw during invocation.
     * @private
     */
    resolve(pluginInput) {
        if (typeof pluginInput === 'function') {
            try {
                return pluginInput(this.context);
            }
            catch (err) {
                console.warn(
                    '[PluginLoader] Plugin factory threw during resolution; skipping plugin:',
                    err,
                );
                return null;
            }
        }
        return pluginInput;
    }

    /**
     * Validate and register a single plugin.
     *
     * Accepts either a plain plugin object or a factory function `(context) => plugin`.
     * Factory functions are called with the context provided at PluginLoader construction.
     *
     * If the plugin defines an `errorHandler`, it is attached to each handler's config
     * so the EventBus `safeRun` can invoke it on errors.
     *
     * @param {Object|Function} pluginInput - The plugin definition or factory function.
     * @returns {boolean} `true` if the plugin was registered, `false` if validation failed.
     */
    register(pluginInput) {
        const plugin = this.resolve(pluginInput);

        // Distinguish "factory threw" from "plugin is otherwise invalid":
        // resolve() returns null for both null inputs AND thrown factories.
        // We only emit the specific message when the input was a factory.
        // resolve() already logged the underlying error via console.warn.
        if (plugin === null && typeof pluginInput === 'function') {
            console.warn('[PluginLoader] Skipping plugin: factory function threw during resolution');
            return false;
        }

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

            // Merge plugin-level errorHandler and pluginName into handler config
            // so EventBus.safeRun can access them without wrapping the handler.
            const config = {
                ...eventDef.config,
                pluginName : plugin.name,
            };

            if (typeof plugin.errorHandler === 'function') {
                config.errorHandler = plugin.errorHandler;
            }

            this.eventBus[method](eventDef.type, eventDef.handler, config);
        }

        this.registeredNames.add(plugin.name);
        return true;
    }

    /**
     * Register multiple plugins at once.
     *
     * @param {Array<Object|Function>} plugins - Array of plugin definitions or factory functions.
     * @returns {Object} Summary of registration results.
     * @returns {string[]} return.registered - Names of successfully registered plugins.
     * @returns {string[]} return.skipped - Names of skipped plugins.
     */
    registerAll(plugins) {
        const registered = [];
        const skipped    = [];

        for (const pluginInput of plugins) {
            // Resolve before registration so we can report the name accurately
            const plugin  = this.resolve(pluginInput);
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
