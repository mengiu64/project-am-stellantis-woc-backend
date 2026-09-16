// test/utils/factories.js
// Factory functions per generare dati di test

const { v4: uuidv4 } = require('uuid');

class TestDataFactory {
  // Crea evento Kafka valido
  static createKafkaEvent(overrides = {}) {
    return {
      eventId: uuidv4(),
      timestamp: new Date().toISOString(),
      eventType: 'JOBS_UPDATE',
      dealerId: 'DEALER001',
      payload: {
        jobId: 'JOB123',
        status: 'COMPLETED',
        ...overrides.payload
      },
      ...overrides
    };
  }

  // Crea array di eventi Kafka
  static createKafkaEvents(count = 5, overrides = {}) {
    return Array.from({ length: count }, (_, i) => 
      this.createKafkaEvent({
        eventId: uuidv4(),
        dealerId: `DEALER${String(i + 1).padStart(3, '0')}`,
        ...overrides
      })
    );
  }

  // Crea payload POST /api/synch-status
  static createPostSynchStatusRequest(events = null, overrides = {}) {
    return {
      events: events || this.createKafkaEvents(3),
      ...overrides
    };
  }

  // Crea API Gateway event per POST
  static createApiGatewayPostEvent(body = null, headers = {}) {
    return {
      requestContext: {
        http: {
          method: 'POST',
          path: '/api/synch-status'
        }
      },
      rawPath: '/api/synch-status',
      httpMethod: 'POST',
      body: JSON.stringify(body || this.createPostSynchStatusRequest()),
      headers: {
        'content-type': 'application/json',
        'authorization': 'Bearer test-token-123',
        ...headers
      }
    };
  }

  // Crea API Gateway event per GET
  static createApiGatewayGetEvent(requestId = null, headers = {}) {
    return {
      requestContext: {
        http: {
          method: 'GET',
          path: `/api/synch-status/${requestId || uuidv4()}`
        }
      },
      rawPath: `/api/synch-status/${requestId || uuidv4()}`,
      httpMethod: 'GET',
      pathParameters: {
        requestId: requestId || uuidv4()
      },
      headers: {
        'authorization': 'Bearer test-token-123',
        ...headers
      }
    };
  }

  // Crea JWT token decodificato
  static createDecodedToken(overrides = {}) {
    return {
      sub: 'test-user-id',
      user_id: 'test-user-id',
      roles: ['api_user'],
      exp: Math.floor(Date.now() / 1000) + 3600, // 1 ora da ora
      iat: Math.floor(Date.now() / 1000),
      iss: 'https://ping-dev.local',
      ...overrides
    };
  }

  // Crea risposta OAuth2
  static createOAuth2Response(overrides = {}) {
    return {
      access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'api',
      ...overrides
    };
  }

  // Crea risposta DJC/GCT
  static createExternalSystemResponse(system = 'djc', overrides = {}) {
    return {
      status: 200,
      data: {
        message: `Evento ricevuto da ${system.toUpperCase()}`,
        eventCount: 3,
        timestamp: new Date().toISOString(),
        ...overrides
      }
    };
  }
}

module.exports = TestDataFactory;
