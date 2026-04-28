/**
 * @module event-bus/Event
 * @description Immutable event value object for the EventBus.
 *
 * Every event carries a name, timestamp, optional actor/user/trace metadata,
 * and a frozen data payload. Events are created via `Event.create()` or
 * deserialized via `Event.fromPayload()`.
 *
 * @example
 * const event = Event.create('user.signup', { userId: 42 });
 * console.log(event.getName());   // 'user.signup'
 * console.log(event.getData());   // { userId: 42 } (frozen)
 */
const { deepFreeze } = require('./utils');

class Event {

    /**
     * @param {string} name - The event name (e.g. 'user.signup').
     * @param {Object} [data={}] - The event payload. Will be deep-frozen.
     */
    constructor(name, data) {
        this.name      = name;
        this.timestamp = new Date().toISOString();
        this.actor     = null;
        this.userId    = null;
        this.traceId   = null;
        this.data      = deepFreeze(data || {});
    }

    /**
     * Factory method to create a new Event.
     *
     * @param {string} name - The event name.
     * @param {Object} [data={}] - The event payload.
     * @returns {Event} A new frozen Event instance.
     *
     * @example
     * const event = Event.create('order.confirmation', { orderId: 'abc-123' });
     */
    static create(name, data) {
        return new Event(name, data);
    }

    /**
     * Reconstitute an Event from a serialized payload (e.g. from Redis, SQS).
     *
     * @param {Object} payload - A plain object with event fields.
     * @param {string} payload.name - The event name.
     * @param {Object} [payload.data] - The event data.
     * @param {string} [payload.timestamp] - ISO timestamp.
     * @param {string} [payload.actor] - The actor who triggered the event.
     * @param {string|number} [payload.userId] - The user ID.
     * @param {string} [payload.traceId] - A trace/correlation ID.
     * @returns {Event} A reconstituted Event instance.
     */
    static fromPayload(payload) {
        const event = new Event(payload.name, payload.data);
        event.timestamp = payload.timestamp || event.timestamp;
        event.actor     = payload.actor || null;
        event.userId    = payload.userId || null;
        event.traceId   = payload.traceId || null;
        return event;
    }

    /**
     * Serialize the event to a plain, frozen object suitable for transport.
     *
     * @returns {Object} A frozen plain object representation of the event.
     */
    toPayload() {
        return deepFreeze({
            name      : this.name,
            timestamp : this.timestamp,
            actor     : this.actor,
            userId    : this.userId,
            traceId   : this.traceId,
            data      : this.data,
        });
    }

    /** @returns {string} The event name. */
    getName() {
        return this.name;
    }

    /** @returns {string} ISO 8601 timestamp of when the event was created. */
    getTimestamp() {
        return this.timestamp;
    }

    /** @returns {string|null} The actor who triggered the event. */
    getActor() {
        return this.actor;
    }

    /** @returns {string|number|null} The user ID associated with the event. */
    getUserId() {
        return this.userId;
    }

    /** @returns {string|null} The trace/correlation ID. */
    getTraceId() {
        return this.traceId;
    }

    /** @returns {Object} The frozen event data payload. */
    getData() {
        return this.data;
    }

    /**
     * Set metadata fields on the event. Returns `this` for chaining.
     *
     * @param {Object} meta
     * @param {string} [meta.actor]
     * @param {string|number} [meta.userId]
     * @param {string} [meta.traceId]
     * @returns {Event} This event instance (for chaining).
     *
     * @example
     * const event = Event.create('user.login', { ip: '1.2.3.4' })
     *     .withMeta({ actor: 'auth-service', userId: 42, traceId: 'abc-123' });
     */
    withMeta({ actor, userId, traceId } = {}) {
        if (actor !== undefined) this.actor = actor;
        if (userId !== undefined) this.userId = userId;
        if (traceId !== undefined) this.traceId = traceId;
        return this;
    }

    /**
     * Serialize the event to a JSON string.
     *
     * @returns {string} JSON string representation.
     */
    toString() {
        return JSON.stringify(this.toPayload());
    }
}

module.exports = Event;
