jest.mock('../src/http.js');
jest.mock('../src/logger.js', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn() }
}));

describe('auth.js', () => {
  let getValidToken, invalidateToken;
  let httpsPost;

  const validAuthConfig = {
    url: 'https://auth.example.com/token',
    client_id: 'client123',
    client_secret: 'secret456',
    scope: 'read:all'
  };

  const tokenResponse = { status: 200, data: { access_token: 'tok123', expires_in: 3600 } };

  beforeEach(() => {
    jest.resetModules();
    ({ httpsPost } = require('../src/http.js'));
    ({ getValidToken, invalidateToken } = require('../src/auth.js'));
  });

  describe('getValidToken', () => {
    it('fetches and returns a new token when cache is empty', async () => {
      httpsPost.mockResolvedValueOnce(tokenResponse);

      const token = await getValidToken(validAuthConfig);

      expect(token).toBe('tok123');
      expect(httpsPost).toHaveBeenCalledTimes(1);
    });

    it('returns cached token on subsequent call without re-fetching', async () => {
      httpsPost.mockResolvedValue(tokenResponse);

      await getValidToken(validAuthConfig);
      const token = await getValidToken(validAuthConfig);

      expect(token).toBe('tok123');
      expect(httpsPost).toHaveBeenCalledTimes(1);
    });

    it('re-fetches token after invalidation', async () => {
      httpsPost.mockResolvedValue(tokenResponse);

      await getValidToken(validAuthConfig);
      invalidateToken();

      httpsPost.mockResolvedValueOnce({ status: 200, data: { access_token: 'tok-new', expires_in: 3600 } });
      const token = await getValidToken(validAuthConfig);

      expect(token).toBe('tok-new');
      expect(httpsPost).toHaveBeenCalledTimes(2);
    });

    it('makes only one HTTP call for concurrent token requests', async () => {
      httpsPost.mockResolvedValue(tokenResponse);

      const [t1, t2, t3] = await Promise.all([
        getValidToken(validAuthConfig),
        getValidToken(validAuthConfig),
        getValidToken(validAuthConfig)
      ]);

      expect(t1).toBe('tok123');
      expect(t2).toBe('tok123');
      expect(t3).toBe('tok123');
      expect(httpsPost).toHaveBeenCalledTimes(1);
    });

    it('sends correct OAuth client_credentials body', async () => {
      httpsPost.mockResolvedValueOnce(tokenResponse);

      await getValidToken(validAuthConfig);

      const [, , body] = httpsPost.mock.calls[0];
      expect(body).toContain('grant_type=client_credentials');
      expect(body).toContain('client_id=client123');
      expect(body).toContain('scope=read%3Aall');
    });

    it('throws NTTInternalServerError when required config keys are missing', async () => {
      const { NTTInternalServerError } = require('../src/responseHelper.js');
      const badConfig = { url: 'https://auth.example.com' };

      await expect(getValidToken(badConfig)).rejects.toBeInstanceOf(NTTInternalServerError);
      expect(httpsPost).not.toHaveBeenCalled();
    });

    it('throws NTTError when OAuth server returns non-2xx', async () => {
      const { NTTError } = require('../src/responseHelper.js');
      httpsPost.mockResolvedValueOnce({ status: 401, data: { error: 'invalid_client' } });

      await expect(getValidToken(validAuthConfig)).rejects.toBeInstanceOf(NTTError);
    });

    it('throws NTTInternalServerError when access_token is absent in response', async () => {
      const { NTTInternalServerError } = require('../src/responseHelper.js');
      httpsPost.mockResolvedValueOnce({ status: 200, data: { token_type: 'Bearer' } });

      await expect(getValidToken(validAuthConfig)).rejects.toBeInstanceOf(NTTInternalServerError);
    });

    it('throws NTTInternalServerError on request timeout', async () => {
      const { NTTInternalServerError } = require('../src/responseHelper.js');
      const timeoutError = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
      httpsPost.mockRejectedValueOnce(timeoutError);

      await expect(getValidToken(validAuthConfig)).rejects.toBeInstanceOf(NTTInternalServerError);
    });

    it('throws NTTInternalServerError on unexpected network error', async () => {
      const { NTTInternalServerError } = require('../src/responseHelper.js');
      httpsPost.mockRejectedValueOnce(new Error('ECONNRESET'));

      await expect(getValidToken(validAuthConfig)).rejects.toBeInstanceOf(NTTInternalServerError);
    });
  });

  describe('invalidateToken', () => {
    it('clears the cached token so next call re-fetches', async () => {
      httpsPost.mockResolvedValue(tokenResponse);

      await getValidToken(validAuthConfig);
      invalidateToken();
      await getValidToken(validAuthConfig);

      expect(httpsPost).toHaveBeenCalledTimes(2);
    });
  });
});
