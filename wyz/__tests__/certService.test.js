'use strict';

// Mock dei moduli core usati dal certService.
jest.mock('fs');
jest.mock('http');

const { EventEmitter } = require('events');

// Istanze mock riassegnate dopo ogni jest.resetModules().
let fs;
let http;

/** Simula una risposta della Secrets Extension. */
function mockExtension(responses) {
  http.get.mockImplementation((options, cb) => {
    const req = new EventEmitter();
    req.destroy = jest.fn((err) => req.emit('error', err));
    const secretId = decodeURIComponent(options.path.split('secretId=')[1]);
    const r = responses[secretId];
    process.nextTick(() => {
      if (r instanceof Error) return req.emit('error', r);
      if (r === 'timeout') return req.emit('timeout');
      const res = new EventEmitter();
      res.statusCode = r.statusCode;
      cb(res);
      res.emit('data', r.body);
      res.emit('end');
    });
    return req;
  });
}

const CERT = '-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----';
const KEY = '-----BEGIN RSA PRIVATE KEY-----\nBBB\n-----END RSA PRIVATE KEY-----';
const ok = (secret) => ({ statusCode: 200, body: JSON.stringify({ SecretString: secret }) });

describe('certService (wyz)', () => {
  const originalEnv = process.env;
  let svc;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env = { ...originalEnv, WYZ_CERT_SECRET_ID: 'sm-cert', WYZ_KEY_SECRET_ID: 'sm-key', AWS_SESSION_TOKEN: 'tok' };
    delete process.env.WYZ_CERT_FILE;
    delete process.env.WYZ_KEY_FILE;
    fs = require('fs');
    http = require('http');
    svc = require('../certService');
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = originalEnv; });

  describe('extractPem', () => {
    it('restituisce il PEM puro trim-mato', () => {
      expect(svc.extractPem(`  ${CERT}\n`)).toBe(CERT);
    });
    it('estrae il PEM da un valore JSON-like convertendo i "\\n" letterali', () => {
      expect(svc.extractPem('{"apiCert":"-----BEGIN CERTIFICATE-----\\nAAA\\n-----END CERTIFICATE-----"}')).toBe(CERT);
    });
    it('valori senza PEM o non stringa restano invariati', () => {
      expect(svc.extractPem('nope')).toBe('nope');
      expect(svc.extractPem(undefined)).toBeUndefined();
    });
  });

  it('costruisce l\'agent dai secret via Extension e lo mette in cache', async () => {
    mockExtension({ 'sm-cert': ok(CERT), 'sm-key': ok(KEY) });
    const agent = await svc.getHttpsAgent();
    expect(agent.options.cert).toBe(CERT);
    expect(agent.options.key).toBe(KEY);
    expect(http.get.mock.calls[0][0].port).toBe(2773);
    expect(http.get.mock.calls[0][0].headers['X-Aws-Parameters-Secrets-Token']).toBe('tok');
    expect(await svc.getHttpsAgent()).toBe(agent);
    expect(http.get).toHaveBeenCalledTimes(2);
  });

  it('usa la porta 2773 di default e quella passata dal chiamante; ricostruisce l\'agent dopo invalidateAgent', async () => {
    mockExtension({ 'sm-cert': ok(CERT), 'sm-key': ok(KEY) });
    const first = await svc.getHttpsAgent();
    svc.invalidateAgent();
    expect(await svc.getHttpsAgent({ extensionPort: 9999 })).not.toBe(first);
    expect(http.get.mock.calls[0][0].port).toBe(2773);
    expect(http.get.mock.calls[2][0].port).toBe(9999);
  });

  it('in locale legge i file PEM indicati da WYZ_CERT_FILE/WYZ_KEY_FILE', async () => {
    process.env.WYZ_CERT_FILE = 'c.cer';
    process.env.WYZ_KEY_FILE = 'k.key';
    fs.readFileSync.mockImplementation((f) => (f === 'c.cer' ? CERT : KEY));
    const agent = await svc.getHttpsAgent();
    expect(agent.options.cert).toBe(CERT);
    expect(http.get).not.toHaveBeenCalled();
  });

  it('errore se mancano gli id dei secret', async () => {
    delete process.env.WYZ_CERT_SECRET_ID;
    await expect(svc.getHttpsAgent()).rejects.toThrow('WYZ_CERT_SECRET_ID');
  });

  it('errore se il materiale non è PEM; la cache viene azzerata', async () => {
    mockExtension({ 'sm-cert': ok('not-a-pem'), 'sm-key': ok(KEY) });
    await expect(svc.getHttpsAgent()).rejects.toThrow('non in formato PEM');
    mockExtension({ 'sm-cert': ok(CERT), 'sm-key': ok(KEY) });
    await expect(svc.getHttpsAgent()).resolves.toBeDefined();
  });

  it.each([
    ['status != 200', { statusCode: 404, body: 'x' }, 'HTTP 404'],
    ['JSON non valido', { statusCode: 200, body: '{bad' }, 'Risposta non valida'],
    ['SecretString assente', { statusCode: 200, body: '{}' }, 'Risposta non valida'],
    ['errore di trasporto', new Error('ECONNREFUSED'), 'ECONNREFUSED'],
    ['timeout', 'timeout', 'Timeout Extension'],
  ])('fetchSecret: %s', async (_, response, msg) => {
    mockExtension({ s: response });
    await expect(svc.fetchSecret('s')).rejects.toThrow(msg);
  });
});
