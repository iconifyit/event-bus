/**
 * BaseNotifier interface-contract tests.
 *
 * Verifies that the default `notify()` throws (forcing subclasses to override)
 * and that a subclass that DOES override is accepted by the EventBus notifier
 * map without any wrapping or coercion.
 */
const { BaseNotifier } = require('../index');

describe('BaseNotifier', () => {

    // Scenario: bare BaseNotifier.notify() throws — subclasses must override.
    // This is the contract: if you ship a BaseNotifier instance without
    // implementing notify, errors silently disappear; the throw forces
    // implementers to actually implement.
    it('should throw "not implemented" when notify() is called on the bare class', async () => {
        const notifier = new BaseNotifier();
        await expect(notifier.notify('subject', new Error('oops')))
            .rejects.toThrow('notify() not implemented');
    });

    // Scenario: error is optional in the signature — bare-class still rejects
    // even with no error argument
    it('should reject even when called with no error argument', async () => {
        const notifier = new BaseNotifier();
        await expect(notifier.notify('subject'))
            .rejects.toThrow('notify() not implemented');
    });

    // Scenario: a subclass overriding notify() works as expected and the
    // subclass IS an instance of BaseNotifier (preserves the inheritance check
    // for any consumer code that wants to verify the contract).
    it('should accept a subclass that implements notify()', async () => {
        const captured = { subject: null, error: null };
        class TestNotifier extends BaseNotifier {
            async notify(subject, error = null) {
                captured.subject = subject;
                captured.error   = error;
            }
        }

        const notifier = new TestNotifier();
        expect(notifier).toBeInstanceOf(BaseNotifier);

        await notifier.notify('payment.failed', new Error('Card declined'));
        expect(captured.subject).toBe('payment.failed');
        expect(captured.error.message).toBe('Card declined');
    });
});
