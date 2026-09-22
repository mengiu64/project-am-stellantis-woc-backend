const Validator = require('../validator');

describe('validator.js - Validator Class', () => {
  describe('validatePostSynchStatus()', () => {
    it('DEVE accettare payload POST valido con 1 evento', () => {
      const body = {
        events: [
          {
            eventId: '550e8400-e29b-41d4-a716-446655440000',
            timestamp: '2026-09-21T12:00:00Z',
            eventType: 'JOBS_UPDATE',
            dealerId: 'dealer123',
            payload: { data: 'test' }
          }
        ]
      };
      
      const result = Validator.validatePostSynchStatus(body);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('DEVE accettare payload POST con 100 eventi', () => {
      const events = Array(100).fill(null).map((_, i) => ({
        eventId: `550e8400-e29b-41d4-a716-44665544000${i % 10}`,
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123',
        payload: { data: `event${i}` }
      }));
      
      const body = { events };
      const result = Validator.validatePostSynchStatus(body);
      expect(result.valid).toBe(true);
    });

    it('DEVE rigettare payload POST con 0 eventi', () => {
      const body = { events: [] };
      const result = Validator.validatePostSynchStatus(body);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('DEVE rigettare payload POST con > 100 eventi', () => {
      const events = Array(101).fill(null).map((_, i) => ({
        eventId: `550e8400-e29b-41d4-a716-44665544000${i % 10}`,
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123',
        payload: { data: 'test' }
      }));
      
      const body = { events };
      const result = Validator.validatePostSynchStatus(body);
      expect(result.valid).toBe(false);
    });

    it('DEVE rigettare payload POST senza events', () => {
      const body = {};
      const result = Validator.validatePostSynchStatus(body);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('DEVE rimuovere campi non noti (stripUnknown)', () => {
      const body = {
        events: [{
          eventId: '550e8400-e29b-41d4-a716-446655440000',
          timestamp: '2026-09-21T12:00:00Z',
          eventType: 'JOBS_UPDATE',
          dealerId: 'dealer123',
          payload: { data: 'test' }
        }],
        unknownField: 'should be stripped'
      };
      
      const result = Validator.validatePostSynchStatus(body);
      expect(result.valid).toBe(false); // Deve essere false per campo non previsto al top level
    });
  });

  describe('validateGetSynchStatus()', () => {
    it('DEVE accettare UUID v4 valido', () => {
      const requestId = '550e8400-e29b-41d4-a716-446655440000';
      const result = Validator.validateGetSynchStatus(requestId);
      
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.requestId).toBe(requestId);
    });

    it('DEVE rigettare UUID non valido', () => {
      const requestId = 'not-a-uuid';
      const result = Validator.validateGetSynchStatus(requestId);
      
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
    });

    it('DEVE rigettare requestId mancante', () => {
      const result = Validator.validateGetSynchStatus(undefined);
      expect(result.valid).toBe(false);
    });

    it('DEVE rigettare requestId null', () => {
      const result = Validator.validateGetSynchStatus(null);
      expect(result.valid).toBe(false);
    });

    it('DEVE ritornare errore con dettagli del campo', () => {
      const result = Validator.validateGetSynchStatus('invalid');
      
      expect(result.errors).toBeDefined();
      expect(result.errors[0]).toHaveProperty('field');
      expect(result.errors[0]).toHaveProperty('message');
    });
  });

  describe('validateKafkaEvent()', () => {
    it('DEVE accettare evento Kafka valido', () => {
      const event = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123',
        payload: { data: 'test' }
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('DEVE accettare tutti i 4 tipi di eventType supportati', () => {
      const eventTypes = ['JOBS_UPDATE', 'APPOINTMENTS_UPDATE', 'VIDEOCHECK_JOB_UPDATED', 'JOBS_UPDATE_WITH_PREAPPROVAL'];
      
      eventTypes.forEach(eventType => {
        const event = {
          eventId: '550e8400-e29b-41d4-a716-446655440000',
          timestamp: '2026-09-21T12:00:00Z',
          eventType,
          dealerId: 'dealer123',
          payload: { data: 'test' }
        };
        
        const result = Validator.validateKafkaEvent(event);
        expect(result.valid).toBe(true);
      });
    });

    it('DEVE rigettare eventType non supportato', () => {
      const event = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'UNKNOWN_TYPE',
        dealerId: 'dealer123',
        payload: { data: 'test' }
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(false);
    });

    it('DEVE validare eventId come UUID v4', () => {
      const event = {
        eventId: 'not-uuid',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123',
        payload: { data: 'test' }
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(false);
    });

    it('DEVE validare timestamp come ISO8601', () => {
      const event = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: 'not-iso-date',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123',
        payload: { data: 'test' }
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(false);
    });

    it('DEVE validare dealerId min 3 e max 20 caratteri', () => {
      const tooShort = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'ab',
        payload: { data: 'test' }
      };
      
      const result1 = Validator.validateKafkaEvent(tooShort);
      expect(result1.valid).toBe(false);
      
      const tooLong = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer12345678901234567',
        payload: { data: 'test' }
      };
      
      const result2 = Validator.validateKafkaEvent(tooLong);
      expect(result2.valid).toBe(false);
    });

    it('DEVE rigettare evento senza payload', () => {
      const event = {
        eventId: '550e8400-e29b-41d4-a716-446655440000',
        timestamp: '2026-09-21T12:00:00Z',
        eventType: 'JOBS_UPDATE',
        dealerId: 'dealer123'
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(false);
    });

    it('DEVE collezionare TUTTI gli errori (abortEarly: false)', () => {
      const event = {
        eventId: 'invalid',
        timestamp: 'invalid',
        eventType: 'INVALID_TYPE',
        dealerId: 'ab',
        // payload mancante
      };
      
      const result = Validator.validateKafkaEvent(event);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1); // Più di 1 errore
    });
  });

  describe('validateAuthorizationHeader()', () => {
    it('DEVE accettare Authorization header valido', () => {
      const header = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzb2IiOiIxMjM0NTY3ODkwIn0.TJVA95OrM7E2cBab30RMHrHDcEfxjoYZgeFONFh7HgQ';
      const result = Validator.validateAuthorizationHeader(header);
      
      expect(result.valid).toBe(true);
      expect(result.token).toBeDefined();
      expect(result.token).toContain('eyJ');
    });

    it('DEVE estrarre il token JWT dal header', () => {
      const token = 'test-jwt-token-12345';
      const header = `Bearer ${token}`;
      const result = Validator.validateAuthorizationHeader(header);
      
      expect(result.valid).toBe(true);
      expect(result.token).toBe(token);
    });

    it('DEVE rigettare header mancante', () => {
      const result = Validator.validateAuthorizationHeader(undefined);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('mancante');
    });

    it('DEVE rigettare header null', () => {
      const result = Validator.validateAuthorizationHeader(null);
      expect(result.valid).toBe(false);
    });

    it('DEVE rigettare header senza Bearer prefix', () => {
      const header = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const result = Validator.validateAuthorizationHeader(header);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('formato');
    });

    it('DEVE rigettare header con Bearer ma senza token', () => {
      const header = 'Bearer';
      const result = Validator.validateAuthorizationHeader(header);
      
      expect(result.valid).toBe(false);
    });

    it('DEVE rigettare header con schema non Bearer', () => {
      const header = 'Basic dXNlcjpwYXNz';
      const result = Validator.validateAuthorizationHeader(header);
      
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Bearer');
    });
  });
});
