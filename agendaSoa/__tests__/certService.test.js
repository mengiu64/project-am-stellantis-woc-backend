'use strict';

// ── Mock del modulo http core ──────────────────────────────────────────────────
// Il certService recupera i segreti via `http.get` verso la Secrets Extension su
// localhost:2773. Mockiamo `http.get` per simulare risposte controllate senza rete:
//   - 200 con body JSON { SecretString }
//   - status ≠ 200
//   - body non-JSON (non parsabile)
//   - errore di trasporto
jest.mock('http', () => ({ get: jest.fn() }));

const { EventEmitter } = require('events');
const http = require('http');
const https = require('https');

const {
  getHttpsAgent,
  fetchSecret,
  extractPem,
  _resetCache,
} = require('../src/certService');

// PEM di certificato/chiave fittizi ma con delimitatori realistici.
const FAKE_CERT = '-----BEGIN CERTIFICATE-----\nCERTBODY\n-----END CERTIFICATE-----';
const FAKE_KEY = '-----BEGIN PRIVATE KEY-----\nKEYBODY\n-----END PRIVATE KEY-----';

/**
 * Costruisce un'implementazione di `http.get(options, cb)` che, per ciascun
 * secretId (dedotto dalla query string del path), restituisce una risposta
 * simulata definita in `responsesBySecret`.
 *
 * Ogni entry può essere:
 *   { statusCode, body }         → risposta HTTP con status e body testuale
 *   { transportError: Error }    → errore di trasporto emesso su 'error'
 *
 * Ritorna anche un contatore delle chiamate per secretId.
 */
function makeHttpGet(responsesBySecret) {
  // Contatore delle invocazioni per singolo secretId (per verificare il warm-start).
  const callCounts = {};

  // Implementazione mock: firma identica a http.get(options, callback).
  const impl = (options, cb) => {
    // Estrae il secretId dalla query string del path della richiesta.
    const match = /secretId=([^&]+)/.exec(options.path || '');
    const secretId = match ? decodeURIComponent(match[1]) : undefined;
    // Aggiorna il contatore per il secretId corrente.
    callCounts[secretId] = (callCounts[secretId] || 0) + 1;

    // Recupera la definizione della risposta per questo secretId.
    const def = responsesBySecret[secretId];

    // Oggetto "request" ritornato da http.get: espone .on('error', ...).
    const req = new EventEmitter();

    // Se è previsto un errore di trasporto, lo emettiamo in modo asincrono.
    if (def && def.transportError) {
      process.nextTick(() => req.emit('error', def.transportError));
      return req;
    }

    // Costruisce l'oggetto "response" come EventEmitter con statusCode.
    const res = new EventEmitter();
    res.statusCode = def ? def.statusCode : 200;

    // Invoca il callback con la response e poi emette data/end in modo asincrono.
    process.nextTick(() => {
      cb(res);
      // Emette il body a chunk (se presente) seguito dall'evento di fine.
      if (def && def.body != null) res.emit('data', Buffer.from(def.body, 'utf-8'));
      res.emit('end');
    });

    return req;
  };

  // Espone contatore e implementazione al chiamante.
  return { impl, callCounts };
}

/** Risposte "felici" (200 + SecretString PEM) per cert e key di default. */
function happyResponses() {
  return {
    apicCert: { statusCode: 200, body: JSON.stringify({ SecretString: FAKE_CERT }) },
    apicKey: { statusCode: 200, body: JSON.stringify({ SecretString: FAKE_KEY }) },
  };
}

describe('certService (agendaSoa)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    // Ripristina i mock e azzera la cache in-process tra i test (isolamento).
    jest.clearAllMocks();
    _resetCache();
    // Copia dell'ambiente + token di sessione richiesto dall'header della Extension.
    process.env = { ...OLD_ENV, AWS_SESSION_TOKEN: 'test-session-token' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  // ── getHttpsAgent: percorso felice ─────────────────────────────────────────────

  test('fetches cert and key from the Secrets Extension and builds an https.Agent', async () => {
    const { impl } = makeHttpGet(happyResponses());
    http.get.mockImplementation(impl);

    const agent = await getHttpsAgent();

    // L'agent è un https.Agent valido con cert e key normalizzati (PEM puro).
    expect(agent).toBeInstanceOf(https.Agent);
    expect(agent.options.cert).toBe(FAKE_CERT);
    expect(agent.options.key).toBe(FAKE_KEY);
    // Sono state effettuate due richieste (cert + key).
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  test('sends the session token header and url-encodes the secretId', async () => {
    const { impl } = makeHttpGet(happyResponses());
    http.get.mockImplementation(impl);

    await getHttpsAgent();

    // Le opzioni della prima richiesta devono puntare a localhost:2773 con il token.
    const [options] = http.get.mock.calls[0];
    expect(options.hostname).toBe('localhost');
    expect(options.port).toBe(2773);
    expect(options.path).toContain('/secretsmanager/get?secretId=');
    expect(options.headers['X-Aws-Parameters-Secrets-Token']).toBe('test-session-token');
  });

  // ── getHttpsAgent: warm-start (cache) ──────────────────────────────────────────

  test('caches the agent so the Extension is contacted only once across invocations', async () => {
    const { impl, callCounts } = makeHttpGet(happyResponses());
    http.get.mockImplementation(impl);

    const agent1 = await getHttpsAgent();
    const agent2 = await getHttpsAgent();

    // Warm start: stessa istanza restituita e nessuna nuova chiamata alla Extension.
    expect(agent1).toBe(agent2);
    expect(callCounts.apicCert).toBe(1);
    expect(callCounts.apicKey).toBe(1);
    expect(http.get).toHaveBeenCalledTimes(2); // 1 cert + 1 key totali
  });

  // ── getHttpsAgent: HTTP ≠ 200 → errore + cache invalidata ───────────────────────

  test('rejects with an error that names the secretId (without its value) on non-200, and invalidates the cache', async () => {
    // Prima risposta: cert con status 500; key ok. Deve fallire il recupero del cert.
    const failing = makeHttpGet({
      apicCert: { statusCode: 500, body: 'internal error with SUPER-SECRET-VALUE' },
      apicKey: { statusCode: 200, body: JSON.stringify({ SecretString: FAKE_KEY }) },
    });
    http.get.mockImplementation(failing.impl);

    // Il getHttpsAgent rigetta con messaggio che nomina il segreto ma non il valore.
    await expect(getHttpsAgent()).rejects.toThrow(/apicCert/);
    await expect(getHttpsAgent().catch((e) => e.message)).resolves.not.toContain('SUPER-SECRET-VALUE');

    // Dopo il fallimento la cache è invalidata: un nuovo tentativo "felice" riesce.
    const happy = makeHttpGet(happyResponses());
    http.get.mockImplementation(happy.impl);
    const agent = await getHttpsAgent();
    expect(agent).toBeInstanceOf(https.Agent);
  });

  // ── fetchSecret: body non parsabile → errore ───────────────────────────────────

  test('fetchSecret rejects when the response body is not valid JSON', async () => {
    const { impl } = makeHttpGet({
      apicCert: { statusCode: 200, body: 'not-json-at-all' },
    });
    http.get.mockImplementation(impl);

    // Il messaggio identifica il segreto ma non espone alcun valore.
    await expect(fetchSecret('apicCert')).rejects.toThrow(/apicCert/);
  });

  test('fetchSecret rejects with a message that names the secretId but not its value on non-200', async () => {
    const { impl } = makeHttpGet({
      apicKey: { statusCode: 403, body: 'forbidden VALUE-LEAK' },
    });
    http.get.mockImplementation(impl);

    const err = await fetchSecret('apicKey').catch((e) => e);
    expect(err.message).toContain('apicKey');
    expect(err.message).not.toContain('VALUE-LEAK');
  });

  test('fetchSecret rejects on transport error', async () => {
    const { impl } = makeHttpGet({
      apicCert: { transportError: new Error('ECONNREFUSED') },
    });
    http.get.mockImplementation(impl);

    await expect(fetchSecret('apicCert')).rejects.toThrow('ECONNREFUSED');
  });

  // ── getHttpsAgent: PEM non valido → errore ──────────────────────────────────────

  test('rejects when https.Agent construction fails on invalid PEM material, and invalidates the cache', async () => {
    // Simula materiale PEM non valido: la costruzione dell'https.Agent solleva un errore.
    const { impl } = makeHttpGet(happyResponses());
    http.get.mockImplementation(impl);

    // Forza il fallimento della sola costruzione dell'agent per questo test.
    const agentSpy = jest.spyOn(https, 'Agent').mockImplementationOnce(() => {
      throw new Error('error:0909006C:PEM routines:get_name:no start line');
    });

    // getHttpsAgent propaga l'errore di costruzione dell'agent.
    await expect(getHttpsAgent()).rejects.toThrow(/PEM routines/);
    agentSpy.mockRestore();

    // La cache è stata invalidata: un recupero valido successivo riesce.
    const happy = makeHttpGet(happyResponses());
    http.get.mockImplementation(happy.impl);
    const agent = await getHttpsAgent();
    expect(agent).toBeInstanceOf(https.Agent);
  });

  // ── extractPem ─────────────────────────────────────────────────────────────────

  describe('extractPem', () => {
    test('returns a pure PEM (starting with -----BEGIN) trimmed and unchanged', () => {
      const pem = `\n  ${FAKE_CERT}  \n`;
      expect(extractPem(pem)).toBe(FAKE_CERT);
    });

    test('extracts the PEM block from a JSON-like wrapper value', () => {
      const jsonLike = `{"apicCert": "${FAKE_CERT}"}`;
      expect(extractPem(jsonLike)).toBe(FAKE_CERT);
    });

    test('returns the original value when no PEM block is present', () => {
      expect(extractPem('no pem here')).toBe('no pem here');
    });

    test('passes through non-string values unchanged', () => {
      const obj = { some: 'object' };
      expect(extractPem(obj)).toBe(obj);
      expect(extractPem(undefined)).toBeUndefined();
      expect(extractPem(null)).toBeNull();
    });
  });
});
