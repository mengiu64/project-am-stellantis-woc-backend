'use strict';

jest.mock('http');

const http = require('http');
const certService = require('../certService');

function buildMockRes(statusCode, body) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') cb();
    }),
  };
}

describe('pkDocsoa/certService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    certService._resetCache();
    process.env.AWS_SESSION_TOKEN = 'test-session-token';
  });

  afterEach(() => {
    certService._resetCache();
    delete process.env.AWS_SESSION_TOKEN;
  });

  describe('fetchSecret', () => {
    test('resolves with SecretString on HTTP 200', async () => {
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: 'cert-content' }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      const result = await certService.fetchSecret('apicCert');
      expect(result).toBe('cert-content');
    });

    test('sends the X-Aws-Parameters-Secrets-Token header from AWS_SESSION_TOKEN, default port 2773', async () => {
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: 'x' }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await certService.fetchSecret('apicCert');

      const [options] = http.get.mock.calls[0];
      expect(options.hostname).toBe('localhost');
      expect(options.port).toBe(2773);
      expect(options.path).toBe('/secretsmanager/get?secretId=apicCert');
      expect(options.headers['X-Aws-Parameters-Secrets-Token']).toBe('test-session-token');
    });

    test('rejects when the extension returns a non-200 status', async () => {
      const mockRes = buildMockRes(500, 'internal error');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(certService.fetchSecret('apicCert')).rejects.toThrow(
        '[certService] secret "apicCert" fetch failed: HTTP 500'
      );
    });

    test('rejects when the response body is not valid JSON', async () => {
      const mockRes = buildMockRes(200, 'not-json');
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      await expect(certService.fetchSecret('apicCert')).rejects.toThrow(
        '[certService] invalid response retrieving secret "apicCert"'
      );
    });

    test('rejects on request error', async () => {
      let errorCb;
      http.get.mockImplementation(() => ({
        on: jest.fn((event, cb) => { if (event === 'error') errorCb = cb; }),
      }));

      const promise = certService.fetchSecret('apicCert');
      errorCb(new Error('ECONNREFUSED'));
      await expect(promise).rejects.toThrow('ECONNREFUSED');
    });

    test('extracts the PEM value when the secret was saved as a JSON-like object with real embedded newlines', async () => {
      const pem = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      const wrapped = `{\n  "apicCert": "${pem}"\n}`;
      const mockRes = buildMockRes(200, JSON.stringify({ SecretString: wrapped }));
      http.get.mockImplementation((options, cb) => { cb(mockRes); return { on: jest.fn() }; });

      const result = await certService.fetchSecret('apicCert');
      expect(result).toBe(pem);
    });
  });

  describe('extractPem', () => {
    test('returns a plain PEM value unchanged (trimmed)', () => {
      const pem = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      expect(certService.extractPem(`  ${pem}  `)).toBe(pem);
    });

    test('extracts a PEM block wrapped in a JSON-like object with extra keys', () => {
      const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----';
      const wrapped = `{\n  "description": "apicKey",\n  "apicKey": "${pem}"\n}`;
      expect(certService.extractPem(wrapped)).toBe(pem);
    });

    test('returns the original value unchanged when no PEM block is found', () => {
      expect(certService.extractPem('{"apicCert":"not-a-pem-value"}')).toBe('{"apicCert":"not-a-pem-value"}');
    });

    test('returns the original value unchanged when it is plain non-PEM text', () => {
      expect(certService.extractPem('plain-value')).toBe('plain-value');
    });

    test('returns the original value unchanged for non-string input', () => {
      expect(certService.extractPem(undefined)).toBeUndefined();
    });
  });

  describe('getHttpsAgent', () => {
    test('builds an https.Agent from apicCert/apicKey secrets (gli stessi usati da myPeople)', async () => {
      http.get.mockImplementation((options, cb) => {
        const secretId = options.path.includes('apicCert') ? 'cert-value' : 'key-value';
        cb(buildMockRes(200, JSON.stringify({ SecretString: secretId })));
        return { on: jest.fn() };
      });

      const agent = await certService.getHttpsAgent();
      expect(agent.options.cert).toBe('cert-value');
      expect(agent.options.key).toBe('key-value');
    });

    test('caches the agent across calls (fetches secrets only once)', async () => {
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(200, JSON.stringify({ SecretString: 'v' })));
        return { on: jest.fn() };
      });

      const agent1 = await certService.getHttpsAgent();
      const agent2 = await certService.getHttpsAgent();

      expect(agent1).toBe(agent2);
      expect(http.get).toHaveBeenCalledTimes(2); // apicCert + apicKey, once each
    });

    test('resets the cache and allows retry when the secret fetch fails', async () => {
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(500, 'boom'));
        return { on: jest.fn() };
      });

      await expect(certService.getHttpsAgent()).rejects.toThrow();

      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(200, JSON.stringify({ SecretString: 'v' })));
        return { on: jest.fn() };
      });

      const agent = await certService.getHttpsAgent();
      expect(agent).toBeDefined();
    });
  });
});
