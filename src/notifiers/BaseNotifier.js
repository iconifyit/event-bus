/**
 * @module event-bus/notifiers/BaseNotifier
 * @description Interface contract for error notifiers.
 *
 * Notifiers are injected into the EventBus at initialization time.
 * When a handler throws and its config includes `onError.notify: ['slack']`,
 * the EventBus calls the corresponding notifier's `notify()` method.
 *
 * Consumers provide their own notifier implementations. The EventBus package
 * only ships this interface contract.
 *
 * @example
 * class MySlackNotifier extends BaseNotifier {
 *     async notify(subject, error) {
 *         await slack.send(channel, `${subject}: ${error.message}`);
 *     }
 * }
 */
class BaseNotifier {

    /**
     * Send an error notification.
     *
     * @param {string} subject - A short description of what failed.
     * @param {Error|null} [error=null] - The error that was thrown.
     * @returns {Promise<void>}
     */
    async notify(subject, error = null) {
        throw new Error('notify() not implemented');
    }
}

module.exports = BaseNotifier;
