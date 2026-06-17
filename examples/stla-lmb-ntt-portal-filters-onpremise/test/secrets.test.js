jest.mock('@aws-sdk/client-secrets-manager');
jest.mock('@aws-sdk/client-ssm');
jest.mock('../src/logger.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

describe('secrets.js', () => {
  let getSecretConfig, getURLParameter;
  let mockSmSend, mockSsmSend;

  beforeEach(() => {
    jest.resetModules();

    const smModule = require('@aws-sdk/client-secrets-manager');
    const ssmModule = require('@aws-sdk/client-ssm');

    mockSmSend = jest.fn();
    mockSsmSend = jest.fn();

    smModule.SecretsManagerClient.mockImplementation(() => ({ send: mockSmSend }));
    ssmModule.SSMClient.mockImplementation(() => ({ send: mockSsmSend }));

    ({ getSecretConfig, getURLParameter } = require('../src/secrets.js'));
  });

  describe('getSecretConfig', () => {
    it('fetches and returns a parsed JSON secret', async () => {
      const secretValue = { client_id: 'id123', client_secret: 'sec456' };
      mockSmSend.mockResolvedValueOnce({ SecretString: JSON.stringify(secretValue) });

      const result = await getSecretConfig('my-secret');

      expect(result).toEqual(secretValue);
      expect(mockSmSend).toHaveBeenCalledTimes(1);
    });

    it('returns raw string when secret is not valid JSON', async () => {
      mockSmSend.mockResolvedValueOnce({ SecretString: 'plain-string-secret' });

      const result = await getSecretConfig('my-secret');

      expect(result).toBe('plain-string-secret');
    });

    it('returns cached value on subsequent calls without re-fetching', async () => {
      mockSmSend.mockResolvedValue({ SecretString: JSON.stringify({ key: 'val' }) });

      await getSecretConfig('my-secret');
      await getSecretConfig('my-secret');

      expect(mockSmSend).toHaveBeenCalledTimes(1);
    });

    it('throws NTTInternalServerError when SecretString is missing', async () => {
      mockSmSend.mockResolvedValueOnce({ SecretString: null });

      await expect(getSecretConfig('my-secret')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });

    it('throws NTTInternalServerError when SecretString is empty string', async () => {
      mockSmSend.mockResolvedValueOnce({ SecretString: '' });

      await expect(getSecretConfig('my-secret')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });

    it('throws NTTInternalServerError on AWS SDK error', async () => {
      mockSmSend.mockRejectedValueOnce(new Error('AccessDeniedException'));

      await expect(getSecretConfig('my-secret')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });
  });

  describe('getURLParameter', () => {
    it('fetches and returns the parameter value', async () => {
      mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: 'https://api.example.com' } });

      const result = await getURLParameter('/my/param');

      expect(result).toBe('https://api.example.com');
      expect(mockSsmSend).toHaveBeenCalledTimes(1);
    });

    it('returns cached value on subsequent calls without re-fetching', async () => {
      mockSsmSend.mockResolvedValue({ Parameter: { Value: 'https://api.example.com' } });

      await getURLParameter('/my/param');
      await getURLParameter('/my/param');

      expect(mockSsmSend).toHaveBeenCalledTimes(1);
    });

    it('throws NTTInternalServerError when Parameter.Value is null', async () => {
      mockSsmSend.mockResolvedValueOnce({ Parameter: { Value: null } });

      await expect(getURLParameter('/my/param')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });

    it('throws NTTInternalServerError when Parameter is missing entirely', async () => {
      mockSsmSend.mockResolvedValueOnce({});

      await expect(getURLParameter('/my/param')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });

    it('throws NTTInternalServerError on SSM SDK error', async () => {
      mockSsmSend.mockRejectedValueOnce(new Error('ParameterNotFound'));

      await expect(getURLParameter('/my/param')).rejects.toMatchObject({
        statusCode: 500,
        error: 'INTERNAL_SERVER_ERROR'
      });
    });
  });
});
