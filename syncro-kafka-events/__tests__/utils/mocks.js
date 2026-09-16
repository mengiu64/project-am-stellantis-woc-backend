// test/utils/mocks.js
// Mock objects per servizi

const Logger = require('../../logger');

class MockedServices {
  // Mock logger
  static createMockLogger() {
    const logger = new Logger('test-trace-id-123');
    
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();
    
    return logger;
  }

  // Mock AuthService
  static createMockAuthService() {
    return {
      getOAuth2Token: jest.fn().mockResolvedValue('mock-oauth-token'),
      validateBearerToken: jest.fn().mockReturnValue({
        valid: true,
        decoded: {
          sub: 'test-user',
          roles: ['api_user'],
          exp: Math.floor(Date.now() / 1000) + 3600
        }
      }),
      getExternalSystemHeaders: jest.fn().mockResolvedValue({
        'Authorization': 'Bearer mock-token',
        'X-IBM-Client-Id': 'mock-apic-client-id',
        'Content-Type': 'application/json'
      }),
      verifyPermissions: jest.fn().mockReturnValue({
        authorized: true
      }),
      resetCache: jest.fn()
    };
  }

  // Mock ExternalSystemClient
  static createMockExternalSystemClient() {
    return {
      sendEvent: jest.fn().mockResolvedValue({
        success: true,
        statusCode: 200,
        system: 'djc',
        data: { message: 'Success' }
      }),
      sendToMultipleSystems: jest.fn().mockResolvedValue({
        successful: [
          { system: 'djc', statusCode: 200 },
          { system: 'gct', statusCode: 200 }
        ],
        failed: []
      })
    };
  }

  // Mock Config
  static createMockConfig() {
    return {
      get: jest.fn().mockReturnValue({
        environment: 'dev',
        oauth: {
          clientId: 'test-client',
          tokenUrl: 'https://ping-dev.local/oauth/token'
        },
        apic: {
          clientId: 'test-apic-client'
        },
        externalSystems: {
          djc: { endpoint: 'https://djc-dev.local/api' },
          gct: { endpoint: 'https://gct-dev.local/api' }
        }
      }),
      getByPath: jest.fn().mockImplementation((path) => {
        const pathMap = {
          'oauth.clientId': 'test-client',
          'oauth.tokenUrl': 'https://ping-dev.local/oauth/token',
          'apic.clientId': 'test-apic-client',
          'apic.clientSecret': 'test-apic-client-secret',  // AGGIUNTO: X-IBM-Client-Secret
          'externalSystems.djc.endpoint': 'https://djc-dev.local/api',
          'externalSystems.gct.endpoint': 'https://gct-dev.local/api'
        };
        return pathMap[path];
      })
    };
  }

  // Mock axios per test esigenti
  static setupAxiosMocks() {
    const axios = require('axios');
    
    axios.post = jest.fn().mockResolvedValue({
      status: 200,
      data: { message: 'Success' }
    });
    
    return axios;
  }
}

module.exports = MockedServices;
