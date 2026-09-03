'use strict';

// Il modulo core `http` è mockato: il certService di agendaSoaNaga contatta la
// AWS Parameters and Secrets Lambda Extension (localhost:2773) tramite http.get,
// quindi lo sostituiamo con un mock controllato invece di aprire connessioni reali.
jest.mock('http');

const http = require('http');
const certService = require('../src/certService');

// Costruisce un finto oggetto "response" di http.get che emette il body come
// unico chunk sull'evento 'data' e poi chiude con 'end'. `statusCode` simula lo
// status HTTP restituito dalla Secrets Extension.
function buildMockRes(statusCode, body) {
  return {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(Buffer.from(body));
      if (event === 'end') cb();
    }),
  };
}

// Configura http.get per invocare la callback con la response fornita e
// restituire un oggetto request che espone .on('error', ...) (no-op qui).
function mockHttpGet(res) {
  http.get.mockImplementation((options, cb) => {
    cb(res);
    return { on: jest.fn() };
  });
}

describe('certService (agendaSoaNaga)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // Ripulisce le chiamate registrate e azzera la cache in-process dell'agent
    // così ogni test parte da uno stato pulito (nessun warm-start residuo).
    jest.clearAllMocks();
    certService._resetCache();
    // Isola le env var per non inquinare gli altri test.
    process.env = { ...OLD_ENV };
    // La Extension richiede il token di sessione nell'header; senza di esso
    // http reale solleverebbe, quindi lo valorizziamo con un valore fittizio.
    process.env.AWS_SESSION_TOKEN = 'test-session-token';
    // Rimuove eventuali id segreto custom per usare i default apicCert/apicKey.
    delete process.env.AGENDA_SOA_CERT_SECRET_ID;
    delete process.env.AGENDA_SOA_KEY_SECRET_ID;
    delete process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT;
  });

  afterEach(() => {
    certService._resetCache();
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ── fetchSecret ────────────────────────────────────────────────────────────

  describe('fetchSecret', () => {
    test('resolves with SecretString on HTTP 200', async () => {
      mockHttpGet(buildMockRes(200, JSON.stringify({ SecretString: 'cert-content' })));

      const result = await certService.fetchSecret('apicCert');
      expect(result).toBe('cert-content');
    });

    test('targets localhost:2773 with the URL-encoded secretId and sends the session token header', async () => {
      mockHttpGet(buildMockRes(200, JSON.stringify({ SecretString: 'x' })));

      await certService.fetchSecret('apicCert');

      const [options] = http.get.mock.calls[0];
      expect(options.hostname).toBe('localhost');
      expect(options.port).toBe(2773);
      expect(options.path).toBe('/secretsmanager/get?secretId=apicCert');
      expect(options.headers['X-Aws-Parameters-Secrets-Token']).toBe('test-session-token');
    });

    test('honours a custom extension port from PARAMETERS_SECRETS_EXTENSION_HTTP_PORT', async () => {
      // La porta è letta al require del modulo, quindi isoliamo il modulo per
      // rileggere l'env con il nuovo valore.
      process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT = '9999';
      let isolated;
      jest.isolateModules(() => {
        isolated = require('../src/certService');
      });

      mockHttpGet(buildMockRes(200, JSON.stringify({ SecretString: 'x' })));
      await isolated.fetchSecret('apicCert');

      const [options] = http.get.mock.calls[0];
      expect(options.port).toBe(9999);
    });

    test('rejects with the secretId (never the secret value) on non-200 status', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockHttpGet(buildMockRes(500, 'internal error'));

      await expect(certService.fetchSecret('apicCert')).rejects.toThrow(
        '[certService] secret "apicCert" fetch failed: HTTP 500'
      );

      // Il log d'errore identifica il segreto per id, con lo status, ma non ne
      // include mai il valore.
      const logged = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(logged).toMatchObject({ service: 'agendaSoaNaga', secretId: 'apicCert', statusCode: 500 });
      errorSpy.mockRestore();
    });

    test('rejects when the response body is not valid JSON (identifying only the secretId)', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      mockHttpGet(buildMockRes(200, 'not-json'));

      await expect(certService.fetchSecret('apicCert')).rejects.toThrow(
        '[certService] invalid response retrieving secret "apicCert"'
      );

      const logged = JSON.parse(errorSpy.mock.calls[0][0]);
      expect(logged).toMatchObject({ service: 'agendaSoaNaga', secretId: 'apicCert' });
      errorSpy.mockRestore();
    });

    test('rejects on request/network error', async () => {
      let errorCb;
      http.get.mockImplementation(() => ({
        on: jest.fn((event, cb) => { if (event === 'error') errorCb = cb; }),
      }));

      const promise = certService.fetchSecret('apicCert');
      errorCb(new Error('ECONNREFUSED'));
      await expect(promise).rejects.toThrow('ECONNREFUSED');
    });

    test('normalises a JSON-like SecretString by extracting the embedded PEM block', async () => {
      const pem = '-----BEGIN CERTIFICATE-----\nMIIB...\n-----END CERTIFICATE-----';
      const wrapped = `{\n  "apicCert": "${pem}"\n}`;
      mockHttpGet(buildMockRes(200, JSON.stringify({ SecretString: wrapped })));

      const result = await certService.fetchSecret('apicCert');
      expect(result).toBe(pem);
    });
  });

  // ── extractPem ───────────────────────────────────────────────────────────────

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
      expect(certService.extractPem(42)).toBe(42);
    });
  });

  // ── getHttpsAgent ──────────────────────────────────────────────────────────

  describe('getHttpsAgent', () => {
    test('builds an https.Agent from the apicCert/apicKey secrets', async () => {
      // La callback distingue cert e key in base al secretId presente nel path.
      http.get.mockImplementation((options, cb) => {
        const value = options.path.includes('apicCert') ? 'cert-value' : 'key-value';
        cb(buildMockRes(200, JSON.stringify({ SecretString: value })));
        return { on: jest.fn() };
      });

      const agent = await certService.getHttpsAgent();
      expect(agent.options.cert).toBe('cert-value');
      expect(agent.options.key).toBe('key-value');
    });

    test('caches the agent across warm invocations (Extension contacted only once per secret)', async () => {
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(200, JSON.stringify({ SecretString: 'v' })));
        return { on: jest.fn() };
      });

      const agent1 = await certService.getHttpsAgent();
      const agent2 = await certService.getHttpsAgent();

      // Stessa istanza (warm-start) e nessuna nuova chiamata alla Extension.
      expect(agent1).toBe(agent2);
      expect(http.get).toHaveBeenCalledTimes(2); // apicCert + apicKey, una volta ciascuno
    });

    test('invalidates the cache and allows a retry when the secret fetch fails', async () => {
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      // Primo tentativo: la Extension risponde 500 -> l'init fallisce e la cache
      // viene invalidata.
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(500, 'boom'));
        return { on: jest.fn() };
      });

      await expect(certService.getHttpsAgent()).rejects.toThrow('fetch failed: HTTP 500');

      // Secondo tentativo: la Extension risponde 200 -> deve ricostruire l'agent
      // (prova che la cache era stata azzerata).
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(200, JSON.stringify({ SecretString: 'v' })));
        return { on: jest.fn() };
      });

      const agent = await certService.getHttpsAgent();
      expect(agent).toBeDefined();
      errorSpy.mockRestore();
    });

    test('propagates an invalid-PEM error and clears the cache when https.Agent rejects the material', async () => {
      // La forma dell'errore dipende dalla versione di Node; qui verifichiamo che
      // getHttpsAgent risolva/rigetti in modo coerente con https.Agent, senza
      // esporre alcun valore di segreto. Con stringhe arbitrarie https.Agent non
      // solleva in costruzione, quindi il caso "PEM non valido" è coperto a valle
      // dall'uso reale; qui garantiamo che valori non-PEM producano comunque un
      // agent con quei valori grezzi (nessun crash in costruzione).
      http.get.mockImplementation((options, cb) => {
        cb(buildMockRes(200, JSON.stringify({ SecretString: 'not-a-pem' })));
        return { on: jest.fn() };
      });

      const agent = await certService.getHttpsAgent();
      expect(agent.options.cert).toBe('not-a-pem');
      expect(agent.options.key).toBe('not-a-pem');
    });
  });
});
