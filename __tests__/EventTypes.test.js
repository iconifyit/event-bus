/**
 * EventTypes registry tests.
 *
 * Tests cover: registration, duplicate prevention, bulk registration,
 * read-only proxy, and getEventTypes().
 */
const {
    registerEventType,
    registerEventTypes,
    getEventTypes,
    EventTypes,
} = require('../src/EventTypes');

describe('EventTypes', () => {

    // NOTE: Because the registry is a shared module-level singleton, tests
    // accumulate state. Each test uses unique names to avoid conflicts.

    // Scenario: Registering a single event type makes it accessible via EventTypes proxy
    it('should register and access a single event type', () => {
        registerEventType('TEST_SIGNUP', 'test.signup');
        expect(EventTypes.TEST_SIGNUP).toBe('test.signup');
    });

    // Scenario: Re-registering the same name with the same value should be idempotent
    it('should allow re-registering with the same value', () => {
        registerEventType('TEST_IDEMPOTENT', 'test.idempotent');
        expect(() => registerEventType('TEST_IDEMPOTENT', 'test.idempotent')).not.toThrow();
    });

    // Scenario: Re-registering the same name with a different value should throw
    it('should throw when re-registering with a different value', () => {
        registerEventType('TEST_CONFLICT', 'test.conflict.v1');
        expect(() => registerEventType('TEST_CONFLICT', 'test.conflict.v2')).toThrow(
            /already registered/
        );
    });

    // Scenario: registerEventType requires a non-empty string name
    it('should throw for invalid name', () => {
        expect(() => registerEventType('', 'value')).toThrow();
        expect(() => registerEventType(null, 'value')).toThrow();
        expect(() => registerEventType(123, 'value')).toThrow();
    });

    // Scenario: registerEventType requires a non-empty string value
    it('should throw for invalid value', () => {
        expect(() => registerEventType('VALID_NAME', '')).toThrow();
        expect(() => registerEventType('VALID_NAME_2', null)).toThrow();
        expect(() => registerEventType('VALID_NAME_3', 123)).toThrow();
    });

    // Scenario: registerEventTypes registers multiple types at once
    it('should register multiple event types via registerEventTypes()', () => {
        registerEventTypes({
            TEST_BULK_A : 'test.bulk.a',
            TEST_BULK_B : 'test.bulk.b',
        });
        expect(EventTypes.TEST_BULK_A).toBe('test.bulk.a');
        expect(EventTypes.TEST_BULK_B).toBe('test.bulk.b');
    });

    // Scenario: registerEventTypes throws for non-object input
    it('should throw for non-object input to registerEventTypes()', () => {
        expect(() => registerEventTypes(null)).toThrow();
        expect(() => registerEventTypes('string')).toThrow();
    });

    // Scenario: The EventTypes proxy is read-only — direct assignment throws
    it('should prevent direct assignment to EventTypes', () => {
        expect(() => { EventTypes.HACKED = 'hacked.event'; }).toThrow(
            /read-only/
        );
    });

    // Scenario: Accessing an unregistered type returns undefined
    it('should return undefined for unregistered event types', () => {
        expect(EventTypes.DOES_NOT_EXIST).toBeUndefined();
    });

    // Scenario: getEventTypes returns a frozen snapshot of the registry
    it('should return a frozen snapshot via getEventTypes()', () => {
        registerEventType('TEST_SNAPSHOT', 'test.snapshot');
        const types = getEventTypes();
        expect(types.TEST_SNAPSHOT).toBe('test.snapshot');
        expect(Object.isFrozen(types)).toBe(true);
    });

    // Scenario: delete on EventTypes should throw (read-only enforcement)
    it('should prevent deletion of EventTypes properties', () => {
        registerEventType('TEST_DELETE_TARGET', 'test.delete-target');
        expect(() => { delete EventTypes.TEST_DELETE_TARGET; }).toThrow(/read-only/);
        expect(EventTypes.TEST_DELETE_TARGET).toBe('test.delete-target');
    });

    // Scenario: Object.defineProperty on EventTypes should throw
    it('should prevent Object.defineProperty on EventTypes', () => {
        expect(() => {
            Object.defineProperty(EventTypes, 'INJECTED', { value: 'injected.event' });
        }).toThrow(/read-only/);
    });
});
