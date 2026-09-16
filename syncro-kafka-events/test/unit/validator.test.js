// test/unit/validator.test.js
// Test suite per validator.js

const Validator = require('../../src/utils/validator');
const TestDataFactory = require('../utils/factories');

describe('Validator - Validazione Request', () => {
  
  describe('validatePostSynchStatus', () => {
    test('✓ Valida payload valido con 1 evento', () => {
      // Arrange
      const payload = TestDataFactory.createPostSynchStatusRequest();

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toBeNull();
      expect(result.data).toEqual(payload);
    });

    test('✓ Rifiuta payload con array vuoto', () => {
      // Arrange
      const payload = { events: [] };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0].message).toContain('almeno 1 evento');
    });

    test('✓ Rifiuta payload senza events', () => {
      // Arrange
      const payload = {};

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors[0].field).toBe('events');
    });

    test('✓ Rifiuta evento con eventId non UUID', () => {
      // Arrange
      const event = TestDataFactory.createKafkaEvent({ eventId: 'not-uuid' });
      const payload = { events: [event] };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    test('✓ Rifiuta evento con eventType non valido', () => {
      // Arrange
      const event = TestDataFactory.createKafkaEvent({ eventType: 'INVALID_TYPE' });
      const payload = { events: [event] };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('eventType non riconosciuto');
    });

    test('✓ Rifiuta evento con dealerId troppo corto', () => {
      // Arrange
      const event = TestDataFactory.createKafkaEvent({ dealerId: 'AB' });
      const payload = { events: [event] };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('almeno 3 caratteri');
    });

    test('✓ Consente campi aggiuntivi in evento (forward compatibility)', () => {
      // Arrange
      const event = TestDataFactory.createKafkaEvent({
        futurField: 'future-value'
      });
      const payload = { events: [event] };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(true);
    });

    test('✓ Rifiuta payload > 100 eventi', () => {
      // Arrange
      const events = TestDataFactory.createKafkaEvents(101);
      const payload = { events };

      // Act
      const result = Validator.validatePostSynchStatus(payload);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('non può superare 100 eventi');
    });
  });

  describe('validateGetSynchStatus', () => {
    test('✓ Valida requestId UUID valido', () => {
      // Arrange
      const requestId = '550e8400-e29b-41d4-a716-446655440000';

      // Act
      const result = Validator.validateGetSynchStatus(requestId);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.data.requestId).toBe(requestId);
    });

    test('✓ Rifiuta requestId non UUID', () => {
      // Arrange
      const requestId = 'not-uuid';

      // Act
      const result = Validator.validateGetSynchStatus(requestId);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('UUID v4 valido');
    });

    test('✓ Rifiuta requestId mancante', () => {
      // Arrange
      const requestId = null;

      // Act
      const result = Validator.validateGetSynchStatus(requestId);

      // Assert
      expect(result.valid).toBe(false);
    });
  });

  describe('validateAuthorizationHeader', () => {
    test('✓ Valida header Authorization valido', () => {
      // Arrange
      const header = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...';

      // Act
      const result = Validator.validateAuthorizationHeader(header);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...');
      expect(result.error).toBeNull();
    });

    test('✓ Rifiuta header mancante', () => {
      // Arrange
      const header = null;

      // Act
      const result = Validator.validateAuthorizationHeader(header);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Authorization header mancante');
    });

    test('✓ Rifiuta header con formato non valido', () => {
      // Arrange
      const header = 'InvalidFormat token123';

      // Act
      const result = Validator.validateAuthorizationHeader(header);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.error).toContain('formato non valido');
    });

    test('✓ Rifiuta header senza "Bearer"', () => {
      // Arrange
      const header = 'token123';

      // Act
      const result = Validator.validateAuthorizationHeader(header);

      // Assert
      expect(result.valid).toBe(false);
    });
  });
});
