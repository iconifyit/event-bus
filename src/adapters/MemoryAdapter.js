/**
 * @module event-bus/adapters/MemoryAdapter
 * @description In-memory EventBus adapter backed by mitt.
 *
 * This is the default (and only built-in) adapter. It handles event
 * pub/sub within a single Node.js process. For cross-process eventing,
 * implement a custom adapter (e.g. Redis, SQS) extending BaseEventBusAdapter.
 */
const mitt = require('mitt');
const BaseEventBusAdapter = require('./BaseEventBusAdapter');

class MemoryAdapter extends BaseEventBusAdapter {

    constructor() {
        super();
        this.emitter = mitt();
    }

    /** @inheritdoc */
    on(event, handler) {
        this.emitter.on(event, handler);
    }

    /** @inheritdoc */
    off(event, handler) {
        this.emitter.off(event, handler);
    }

    /** @inheritdoc */
    once(event, handler) {
        const onceHandler = (payload) => {
            this.off(event, onceHandler);
            handler(payload);
        };
        this.on(event, onceHandler);
    }

    /** @inheritdoc */
    emit(event, payload) {
        this.emitter.emit(event, payload);
    }

    /** @inheritdoc */
    clear() {
        this.emitter.all.clear();
    }
}

module.exports = MemoryAdapter;
