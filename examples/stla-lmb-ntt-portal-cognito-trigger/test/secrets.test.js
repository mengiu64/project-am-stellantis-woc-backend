
// Mock the entire AWS SDK module
jest.mock('@aws-sdk/client-secrets-manager', () => {
  const mockSend = jest.fn();
  return {
    SecretsManagerClient: jest.fn(() => ({ send: mockSend })),
    GetSecretValueCommand: jest.fn(),
    __mockSend: mockSend
  };
});

describe('getSecret', () => {
  const secretName = 'my-secret';
  const secretValue = JSON.stringify({ pfx: 'MIIJ...', password: 'pass123' });
  let mockSend;
  let getSecret;

  beforeEach(() => {
    jest.resetModules(); // reset cached credentials & module state

    // Re-create AWS mocks AFTER resetModules
    jest.doMock('@aws-sdk/client-secrets-manager', () => ({
      SecretsManagerClient: jest.fn().mockImplementation(() => ({
        send: mockSend
      })),
      GetSecretValueCommand: jest.fn((x) => x)
    }));

    // Recreate mock logger
    jest.doMock('../src/logger.js', () => ({
      logger: { info: jest.fn(), error: jest.fn() }
    }));

    mockSend = jest.fn(); // recreate mock each test

    // Must import AFTER mocks are redefined
    getSecret = require('../src/secrets.js').getSecret;
  });

  it('should return parsed secret from Secrets Manager', async () => {
    mockSend.mockResolvedValue({ SecretString: secretValue });

    const secret = await getSecret(secretName);

    expect(secret).toEqual({ pfx: 'MIIJ...', password: 'pass123' });
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should return cached secret on second call', async () => {
    mockSend.mockResolvedValue({ SecretString: secretValue });


    // First call: fetches from AWS
    const secret1 = await getSecret(secretName);
    // Second call: returns from cache
    const secret2 = await getSecret(secretName);

    expect(secret1).toEqual(secret2);
    expect(mockSend).toHaveBeenCalledTimes(1); // Only called once because cache used
  });

  it('should throw error if secret not found', async () => {
    mockSend.mockResolvedValue({ SecretString: null });


    await expect(getSecret(secretName)).rejects.toThrow('Secret not found');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('should throw error if secret is not JSON', async () => {
    const rawSecret = 'plain-text-secret';
    mockSend.mockResolvedValue({ SecretString: rawSecret });


    await expect(getSecret(secretName)).rejects.toThrow('Secret is not in JSON format');

  });
});