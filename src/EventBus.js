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
const Event        = require('./Event');
const WriteEmitter = require('./WriteEmitter');

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

        /**
         * Maps event name → Set of original (unwrapped) handlers.
         * Used by emitSync() to invoke handlers directly so the caller
         * can await completion and observe handler errors. emit() does
         * not use this map; it dispatches via the adapter (wrapped).
         * @type {Map<string, Set<Function>>}
         * @private
         */
        this.handlersByEvent = new Map();

        /**
         * Maps event name → Set of handlers registered via once().
         * Both emit() and emitSync() consult this index to drive
         * one-shot semantics: on the emit() path the wrapper's own
         * finally block calls this.off(event, handler); on the emitSync()
         * path the dispatcher calls this.off(event, handler) for any
         * snapshot entry that is in this set. once() registers its
         * wrapper via adapter.on() (not adapter.once()) so that
         * adapter.off() targets the same function the adapter is
         * tracking.
         * @type {Map<string, Set<Function>>}
         * @private
         */
        this.onceHandlers = new Map();

        /**
         * Maps interval handle → metadata for an active onInterval registration.
         * Each entry holds the underlying NodeJS.Timer, the event name to fire,
         * the payload, and the per-registration options (allowConcurrent,
         * awaitHandlers, maxRuns). Handles are monotonic integers issued by
         * `this._nextHandle`.
         * @type {Map<number, {timer:NodeJS.Timer, eventName:string, payload:any,
         *                    options:Object, runCount:number, inFlight:boolean}>}
         * @private
         */
        this.intervals = new Map();

        /**
         * Monotonic handle generator for scheduled registrations
         * (onInterval today; CronManager when it lands).
         * @type {number}
         * @private
         */
        this._nextHandle = 1;
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

        // Reject duplicate registrations of the same (event, handler) pair.
        // Without this, mitt's emit would invoke the handler N times while
        // emitSync — which uses the deduplicated handlersByEvent index —
        // would invoke it once. Rejecting duplicates aligns the two
        // dispatch paths and matches normal pub/sub semantics.
        const existingByEvent = this.handlersByEvent.get(event);
        if (existingByEvent && existingByEvent.has(handler)) {
            return;
        }

        const wrapped = async (payload) => {
            await this.safeRun(event, handler, payload);
        };

        if (!this.handlerConfigs.has(handler)) {
            this.handlerConfigs.set(handler, new Map());
        }
        if (!this.wrappedHandlers.has(handler)) {
            this.wrappedHandlers.set(handler, new Map());
        }
        if (!this.handlersByEvent.has(event)) {
            this.handlersByEvent.set(event, new Set());
        }

        this.handlerConfigs.get(handler).set(event, config);
        this.wrappedHandlers.get(handler).set(event, wrapped);
        this.handlersByEvent.get(event).add(handler);
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

        const handlersForEvent = this.handlersByEvent.get(event);
        if (handlersForEvent) {
            handlersForEvent.delete(handler);
            if (handlersForEvent.size === 0) this.handlersByEvent.delete(event);
        }

        const onceForEvent = this.onceHandlers.get(event);
        if (onceForEvent) {
            onceForEvent.delete(handler);
            if (onceForEvent.size === 0) this.onceHandlers.delete(event);
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

        // Reject duplicate registrations — same rationale as on().
        const existingByEvent = this.handlersByEvent.get(event);
        if (existingByEvent && existingByEvent.has(handler)) {
            return;
        }

        // Register via adapter.on() (NOT adapter.once()), and remove
        // the registration SYNCHRONOUSLY at the start of `wrapped`
        // before the async safeRun begins.
        //
        // Why not adapter.once()? Adapter implementations typically wrap
        // the provided handler in their own closure and register THAT
        // closure with the underlying emitter — so a later
        // adapter.off(event, wrapped) call targets a function the
        // adapter never registered, and the listener silently stays.
        // That broke cancellation (bus.off before any emit did nothing)
        // and once-semantics across mixed emit + emitSync sequences (the
        // adapter listener survived emitSync's bookkeeping cleanup and
        // re-fired on a subsequent emit).
        //
        // Why remove synchronously at the start, not in finally? safeRun
        // is async — its returned Promise pends through one or more
        // microtasks. A burst of synchronous emits (`bus.emit(); bus.emit();`)
        // would all observe `wrapped` still registered with the adapter
        // and queue handler invocations before the finally block ever
        // got a chance to call off(). Removing up-front cuts the adapter
        // listener before control returns to the synchronous caller, so
        // a second synchronous emit fires nothing.
        // Capture the resolved config BEFORE removing the registration.
        // `this.off(event, handler)` wipes `handlerConfigs[handler][event]`,
        // so any later lookup inside `safeRun` would return an empty
        // config — meaning `pluginName` would fall back to "unknown" and
        // any configured `errorHandler` / `onError.notify` would be
        // silently dropped for once-handlers. We pass the captured config
        // to `safeRun` so the error path still sees the plugin's
        // configuration even though the registration is already gone.
        const presetConfig = { ...config };

        const wrapped = async (payload) => {
            // Idempotent: if a concurrent path (e.g. emitSync cleanup)
            // already removed the registration, off() short-circuits.
            this.off(event, handler);
            await this.safeRun(event, handler, payload, presetConfig);
        };

        if (!this.handlerConfigs.has(handler)) {
            this.handlerConfigs.set(handler, new Map());
        }
        if (!this.wrappedHandlers.has(handler)) {
            this.wrappedHandlers.set(handler, new Map());
        }
        if (!this.handlersByEvent.has(event)) {
            this.handlersByEvent.set(event, new Set());
        }
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }

        this.handlerConfigs.get(handler).set(event, config);
        this.wrappedHandlers.get(handler).set(event, wrapped);
        this.handlersByEvent.get(event).add(handler);
        this.onceHandlers.get(event).add(handler);
        this.adapter.on(event, wrapped);
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
     * Emit an event and await handler completion.
     *
     * Unlike `emit()`, which is fire-and-forget and routes through the
     * adapter's wrapped (safeRun) handlers, `emitSync()` invokes the
     * original (unwrapped) handlers directly and returns a Promise that
     * resolves when all handlers complete or rejects with the first
     * handler error.
     *
     * This bypasses the two-tier error notification chain — the caller
     * is responsible for catching and handling errors. Use this when the
     * caller needs to know the outcome of handler execution (e.g. a
     * queue worker that needs to mark a row SUCCESS or FAILED based on
     * whether the subscribed plugin successfully delivered).
     *
     * **Return value as delivery confirmation.** `emitSync()` returns
     * `false` when there is nothing to deliver to (no event name, or no
     * subscribers registered for the event) and `true` only when at
     * least one handler ran to completion. Callers like queue workers
     * MUST inspect the return value — treating a no-subscriber emit as
     * success would silently drop messages whose receiver hasn't been
     * wired up yet.
     *
     * **Handler dispatch.** All handlers are scheduled via
     * `Promise.resolve().then(...)` before any are awaited. This ensures
     * that a synchronous throw in one handler does not abort the
     * dispatch loop — every handler in the snapshot is given the chance
     * to run. `Promise.all` then rejects with the first handler error;
     * other handlers still complete their work in the background
     * (Promise.all does not cancel).
     *
     * @param {string} event - The event name.
     * @param {Object} [payload={}] - The event data.
     * @returns {Promise<boolean>} `true` when at least one handler ran
     *   to completion; `false` if no event name was provided or no
     *   handlers were registered for the event.
     * @throws {Error} Propagates the first handler error encountered.
     *
     * @example
     * // In a queue worker — emitSync's return value is the delivery
     * // confirmation. Treat "no subscriber" the same as a thrown handler.
     * try {
     *     const delivered = await bus.emitSync(`mail.${entity.emailTypeId}`, {
     *         userId    : entity.userId,
     *         messageId : entity.uuid,
     *     });
     *     if (!delivered) {
     *         await recordFailure(entity.uuid, 'no subscriber');
     *     }
     *     else {
     *         await markSuccess(entity.uuid);
     *     }
     * }
     * catch (err) {
     *     await recordFailure(entity.uuid, err.message);
     * }
     */
    async emitSync(event, payload) {
        if (!event) return false;
        const handlers = this.handlersByEvent.get(event);
        // No subscribers — return false so the caller can treat this as
        // "nothing delivered" rather than silently succeed. This matters
        // for queue-worker use cases where success ⇒ row marked SUCCESS.
        if (!handlers || handlers.size === 0) return false;
        const eventObj = Event.create(event, payload);
        // Snapshot handlers before invocation. Some may be once() registrations
        // that will be removed below; iterating the snapshot keeps the
        // dispatch list stable even if a handler reentrantly modifies the bus.
        const snapshot = Array.from(handlers);
        try {
            // Wrap each invocation in Promise.resolve().then(...) so that
            // a synchronous throw in a handler does NOT abort the map() —
            // every handler is scheduled before Promise.all observes the
            // first rejection. Without this, a sync throw aborts map()
            // before later handlers are even started.
            await Promise.all(
                snapshot.map((handler) => Promise.resolve().then(() => handler(eventObj))),
            );
        }
        finally {
            // After dispatch (whether handlers resolved or rejected), remove
            // any one-shot handlers from the bookkeeping so emitSync does not
            // re-invoke them on a subsequent call. Runs in finally so cleanup
            // happens even when a handler rejects.
            const onceSet = this.onceHandlers.get(event);
            if (onceSet && onceSet.size > 0) {
                for (const handler of snapshot) {
                    if (onceSet.has(handler)) {
                        this.off(event, handler);
                    }
                }
            }
        }
        return true;
    }

    /**
     * Schedule a repeating tick that emits `eventName` every `intervalMs`.
     *
     * The first tick fires after `intervalMs` (not at registration) unless
     * `options.runImmediately === true`. The scheduler emits via `bus.emit`
     * by default; subscribers receive the event through the usual pub/sub
     * path with safeRun. Pass `options.awaitHandlers === true` to use
     * `bus.emitSync` instead so handler errors propagate to the tick's
     * catch (and get logged).
     *
     * Concurrency: ticks fire on wall-clock interval boundaries (standard
     * setInterval semantics). The in-flight guard is only meaningful when
     * `options.awaitHandlers === true` — that is the only mode where the
     * tick awaits handler completion, so the guard observably blocks a
     * subsequent tick while handlers are still running. When
     * `awaitHandlers: false` (the default), `emit()` returns synchronously
     * regardless of handler completion, so the guard clears before the
     * next tick fires and overlap is not actually prevented. Set
     * `options.allowConcurrent: true` to disable the guard entirely.
     *
     * Lifecycle: the underlying timer is `unref()`d by default so a lone
     * scheduled task will not keep the Node process alive. Pass
     * `options.keepAlive: true` to invert this. `offInterval(handle)` cancels;
     * `clear()` cancels every scheduled task on the bus.
     *
     * @param {number} intervalMs            - Tick period in milliseconds. Must be a positive integer.
     * @param {string} eventName             - Event to emit on each tick.
     * @param {Object} [payload={}]          - Event payload.
     * @param {Object} [options={}]          - Scheduling options.
     * @param {boolean} [options.awaitHandlers=false] - Use emitSync (await handlers) instead of emit.
     * @param {boolean} [options.allowConcurrent=false] - Allow ticks to overlap when prior is still in flight.
     * @param {number}  [options.maxRuns]    - Auto-offInterval after N tick firings. Must be a positive integer when set. Default unbounded.
     * @param {boolean} [options.runImmediately=false] - Fire one tick at registration before the first scheduled tick.
     * @param {boolean} [options.keepAlive=false] - Do not unref() the timer (keeps Node process alive).
     * @returns {number} An integer handle suitable for `offInterval`.
     * @throws {Error} If `intervalMs` is not a positive integer, `eventName` is falsy, or `options.maxRuns` is not a positive integer when set.
     *
     * @example
     * const handle = bus.onInterval(60_000, 'mail.process-queue', { batchSize: 5 });
     * bus.on('mail.process-queue', (event) => mailService.processQueue(event.getData().batchSize));
     * // later:
     * bus.offInterval(handle);
     *
     * @example
     * // Await handlers so the in-flight guard is keyed off handler completion:
     * bus.onInterval(5000, 'metrics.flush', {}, { awaitHandlers: true });
     */
    onInterval(intervalMs, eventName, payload = {}, options = {}) {
        if (!Number.isInteger(intervalMs) || intervalMs <= 0) {
            throw new Error(
                `[EventBus] onInterval requires a positive integer intervalMs; got: ${intervalMs}`,
            );
        }
        if (!eventName || typeof eventName !== 'string') {
            throw new Error('[EventBus] onInterval requires a non-empty string eventName');
        }
        if (options.maxRuns !== undefined && (!Number.isInteger(options.maxRuns) || options.maxRuns <= 0)) {
            throw new Error(
                `[EventBus] onInterval options.maxRuns must be a positive integer when set; got: ${options.maxRuns}`,
            );
        }

        const handle = this._nextHandle++;

        const fire = async () => {
            const entry = this.intervals.get(handle);
            if (!entry) return;
            if (entry.inFlight && !entry.options.allowConcurrent) {
                // Previous tick still running; skip this one.
                return;
            }
            entry.inFlight = true;
            entry.runCount++;
            try {
                if (entry.options.awaitHandlers) {
                    await this.emitSync(entry.eventName, entry.payload);
                }
                else {
                    this.emit(entry.eventName, entry.payload);
                }
            }
            catch (err) {
                // emit/emitSync handler errors are normally handled by safeRun;
                // a top-level throw here only happens when emitSync rejects.
                // Log so a buggy scheduled handler does not silently rot.
                console.error(
                    `[EventBus] onInterval tick for "${entry.eventName}" (handle ${handle}) threw:`,
                    err,
                );
            }
            finally {
                entry.inFlight = false;
                if (entry.options.maxRuns !== undefined && entry.runCount >= entry.options.maxRuns) {
                    this.offInterval(handle);
                }
            }
        };

        const timer = setInterval(fire, intervalMs);
        if (!options.keepAlive && typeof timer.unref === 'function') {
            timer.unref();
        }

        this.intervals.set(handle, {
            eventName,
            inFlight : false,
            options,
            payload,
            runCount : 0,
            timer,
        });

        if (options.runImmediately) {
            // Run on the next microtask so the handle is fully wired before
            // any handler could call offInterval(handle) reentrantly.
            Promise.resolve().then(fire);
        }

        return handle;
    }

    /**
     * Cancel a scheduled interval. Safe to call with an unknown / already-
     * cancelled handle (no-op).
     *
     * @param {number} handle - The handle returned by `onInterval`.
     * @returns {boolean} `true` if a registration was found and cancelled, `false` otherwise.
     *
     * @example
     * const handle = bus.onInterval(60_000, 'mail.poll');
     * // ...later:
     * bus.offInterval(handle);
     */
    offInterval(handle) {
        const entry = this.intervals.get(handle);
        if (!entry) return false;
        clearInterval(entry.timer);
        this.intervals.delete(handle);
        return true;
    }

    /**
     * Remove all listeners and reset internal state, including cancelling
     * every scheduled interval.
     */
    clear() {
        this.adapter.clear();
        this.handlerConfigs  = new WeakMap();
        this.wrappedHandlers = new WeakMap();
        this.handlersByEvent = new Map();
        this.onceHandlers    = new Map();
        for (const entry of this.intervals.values()) {
            clearInterval(entry.timer);
        }
        this.intervals = new Map();
    }

    /**
     * Create a write-only emitter bound to this EventBus instance.
     *
     * The returned {@link WriteEmitter} exposes only `emit(type, data)` —
     * no subscription methods. Place it in the application context so
     * plugins can publish events without holding a reference to the bus.
     *
     * @returns {WriteEmitter} A write-only emitter instance.
     *
     * @example
     * const bus = initEventBus();
     * const emitter = bus.createEmitter();
     *
     * // Place in context for plugins:
     * context.emitter = emitter;
     *
     * // Plugins use it to publish events:
     * context.emitter.emit('mail.send', { to: 'user@example.com' });
     */
    createEmitter() {
        return new WriteEmitter(this.emit.bind(this));
    }

    /**
     * Execute a handler inside a try/catch envelope with two-tier error handling.
     *
     * **Error flow:**
     * 1. `console.error` fires unconditionally (safety net).
     * 2. If the handler's config includes an `errorHandler` (injected by PluginLoader),
     *    call `errorHandler(error, event)`:
     *    - Returns an `Error` instance → notifier dispatch (Tier 2), then emit
     *      `eventbus.error` with the returned error.
     *    - Returns anything else → error is swallowed, NO notifier dispatch and
     *      NO `eventbus.error` emission.
     * 3. If no `errorHandler` exists → notifier dispatch (Tier 2), then emit
     *    `eventbus.error` with the original error.
     * 4. If the errorHandler itself throws → log it, notifier dispatch (Tier 2)
     *    for the ORIGINAL error, then emit `eventbus.error` with the original error.
     * 5. **Recursion guard:** if the event being handled IS `eventbus.error` and
     *    the handler throws, only `console.error` fires — no re-emission, no
     *    notifier dispatch (would loop).
     *
     * **Notifier dispatch (Tier 2):** Handler config may include
     * `onError.notify: ['notifierName', ...]`. Each named notifier registered
     * with the bus has its `notify(subject, error)` method invoked. Notifier
     * dispatch is fire-and-forget — promises are not awaited and notifier
     * errors are logged but do not affect the rest of the error chain.
     *
     * @param {string} eventName    - The event name (for error context).
     * @param {Function} handler    - The original handler function.
     * @param {*} payload           - The Event payload passed to the handler.
     * @param {Object} [presetConfig] - Optional pre-resolved config. Used by
     *                                  `once()`'s wrapper, which must remove
     *                                  the handler from the adapter
     *                                  synchronously (which also wipes
     *                                  `handlerConfigs`) BEFORE the handler
     *                                  runs. Passing the captured config in
     *                                  ensures the error path can still see
     *                                  `pluginName`, `errorHandler`, and
     *                                  `onError.notify` for once-handlers.
     * @private
     */
    async safeRun(eventName, handler, payload, presetConfig) {
        try {
            await handler(payload);
        }
        catch (error) {
            // Step 1: console.error always fires (non-negotiable safety net)
            let config = presetConfig;
            if (!config) {
                const configMap = this.handlerConfigs.get(handler);
                config = (configMap && configMap.get(eventName)) || {};
            }
            const pluginName = config.pluginName || 'unknown';

            console.error(`[EventBus] Error in handler for "${eventName}" (plugin: ${pluginName}):`, error);

            // Recursion guard: if we are already handling eventbus.error, stop here.
            // Skip notifier dispatch and eventbus.error emission to avoid loops.
            if (eventName === 'eventbus.error') {
                return;
            }

            // Step 2: Plugin-level error handler (Tier 1)
            if (typeof config.errorHandler === 'function') {
                try {
                    // Await the result so async errorHandlers — a common
                    // pattern — are correctly inspected. Without the await,
                    // an async errorHandler's returned Promise would never be
                    // instanceof Error and the result would silently fall
                    // into the swallow branch.
                    const result = await config.errorHandler(error, payload);

                    // If errorHandler returns an Error instance, dispatch notifiers
                    // and emit eventbus.error with the (possibly transformed) error.
                    if (result instanceof Error) {
                        this._dispatchNotifiers(config, eventName, pluginName, result);
                        this.emit('eventbus.error', {
                            error      : result,
                            eventName,
                            pluginName,
                        });
                    }
                    // Anything else (undefined, null, non-Error) → swallowed.
                    // No notifier dispatch and no eventbus.error emission.
                }
                catch (errorHandlerError) {
                    // The errorHandler itself threw — log and escalate the original error,
                    // including notifier dispatch for the ORIGINAL error.
                    console.error(
                        `[EventBus] errorHandler for plugin "${pluginName}" threw:`,
                        errorHandlerError,
                    );
                    this._dispatchNotifiers(config, eventName, pluginName, error);
                    this.emit('eventbus.error', {
                        error      : error,
                        eventName,
                        pluginName,
                    });
                }
                return;
            }

            // Step 3: No errorHandler — dispatch notifiers and escalate directly.
            this._dispatchNotifiers(config, eventName, pluginName, error);
            this.emit('eventbus.error', {
                error      : error,
                eventName,
                pluginName,
            });
        }
    }

    /**
     * Fire the configured notifiers for a handler error.
     *
     * Looks up `config.onError.notify` (an array of notifier names). For
     * each name, finds the corresponding notifier in `this.notifiers` and
     * calls its `notify(subject, error)` method. Dispatch is fire-and-forget:
     * notifier promises are not awaited; rejections are caught and logged so
     * one bad notifier cannot crash the bus or block other notifiers.
     *
     * @param {Object} config     - Resolved handler config.
     * @param {string} eventName  - The event the handler was listening for.
     * @param {string} pluginName - The plugin the handler belongs to.
     * @param {Error}  error      - The error to report.
     * @private
     */
    _dispatchNotifiers(config, eventName, pluginName, error) {
        const names = config.onError && Array.isArray(config.onError.notify)
            ? config.onError.notify
            : null;

        if (!names || names.length === 0) {
            return;
        }

        const subject = `[EventBus] "${eventName}" failed in plugin "${pluginName}"`;

        for (const name of names) {
            const notifier = this.notifiers && this.notifiers[name];
            if (!notifier || typeof notifier.notify !== 'function') {
                console.error(
                    `[EventBus] No notifier named "${name}" registered; skipping.`,
                );
                continue;
            }
            // Fire-and-forget: do not await; catch rejections so a bad
            // notifier cannot affect the rest of the error chain.
            Promise.resolve()
                .then(() => notifier.notify(subject, error))
                .catch((notifierError) => {
                    console.error(
                        `[EventBus] Notifier "${name}" threw while dispatching error for "${eventName}":`,
                        notifierError,
                    );
                });
        }
    }
}

module.exports = EventBus;
