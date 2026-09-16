// test/setup.js
// Setup globale per Jest - mock variabili environment

process.env.ENVIRONMENT = 'dev';
process.env.AWS_REGION = 'eu-west-1';
process.env.AWS_PARTITION = 'aws';
process.env.LOG_LEVEL = 'error'; // Silenzioso durante test
process.env.OAUTH_CLIENT_ID = 'test-client-id';
process.env.OAUTH_TOKEN_URL = 'https://ping-dev.local/oauth/token';
process.env.IBM_APIC_CLIENT_ID = 'test-apic-client';
process.env.IBM_APIC_URL = 'https://apic-dev.local';
process.env.DJC_ENDPOINT = 'https://djc-dev.local/api/events';
process.env.GCT_ENDPOINT = 'https://gct-dev.local/api/events';

// Mock AWS SDK per test
jest.mock('aws-sdk', () => {
  return {
    SSM: jest.fn().mockImplementation(() => ({
      getParameter: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          Parameter: {
            Value: 'test-param-value'
          }
        })
      })
    })),
    SecretsManager: jest.fn().mockImplementation(() => ({
      getSecretValue: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({
          SecretString: JSON.stringify({
            clientId: 'test-oauth-client',
            clientSecret: 'test-oauth-secret'
          })
        })
      })
    }))
  };
});
