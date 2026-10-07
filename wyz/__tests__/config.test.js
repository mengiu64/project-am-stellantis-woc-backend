'use strict';

jest.mock('fs');
const mockLoadSecrets = jest.fn();
jest.mock('../secretsLoader', () => ({ loadSecrets: (...a) => mockLoadSecrets(...a) }));

let fs;

describe('config.getConfig (wyz)', () => {
  const originalEnv = process.env;
  let getConfig;
  let invalidateConfig;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env = { ...originalEnv };
    ['WYZ_PARAM_NAME', 'WYZ_CLIENT_ID', 'WYZ_CLIENT_SECRET', 'WYZ_BASE_URL', 'WYZ_IAM_BASE_URL', 'WYZ_TENANT']
      .forEach((k) => delete process.env[k]);
    fs = require('fs');
    fs.existsSync.mockReturnValue(false);
    ({ getConfig, invalidateConfig } = require('../config'));
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = originalEnv; });

  it('in Lambda usa SSM/Secrets Manager e applica i default preprod', async () => {
    process.env.WYZ_PARAM_NAME = '/app/np-BSN0027990-dev/wyz';
    mockLoadSecrets.mockResolvedValue({ WYZ_CLIENT_ID: 'wi-advisor', WYZ_CLIENT_SECRET: 's' });

    const cfg = await getConfig();

    expect(cfg.auth.url).toBe('https://preprod-iam.wyzexchange.com/realms/STA/protocol/openid-connect/token');
    expect(cfg.auth.clientId).toBe('wi-advisor');
    expect(cfg.auth.grantType).toBe('client_credentials');
    expect(cfg.api.baseUrl).toBe('https://api-preprod.wyzexchange.com');
    expect(cfg.partner).toBe('WIADVISOR');
  });

  it('il secret può sovrascrivere URL e tenant', async () => {
    process.env.WYZ_PARAM_NAME = '/p';
    mockLoadSecrets.mockResolvedValue({
      WYZ_CLIENT_ID: 'a', WYZ_CLIENT_SECRET: 'b',
      WYZ_BASE_URL: 'https://api.wyz.test', WYZ_IAM_BASE_URL: 'https://iam.wyz.test', WYZ_TENANT: 'PRD',
    });

    const cfg = await getConfig();
    expect(cfg.api.baseUrl).toBe('https://api.wyz.test');
    expect(cfg.auth.url).toBe('https://iam.wyz.test/realms/PRD/protocol/openid-connect/token');
  });

  it('in locale usa le variabili d\'ambiente', async () => {
    process.env.WYZ_CLIENT_ID = 'id';
    process.env.WYZ_CLIENT_SECRET = 'sec';
    const cfg = await getConfig();
    expect(cfg.auth.clientSecret).toBe('sec');
    expect(mockLoadSecrets).not.toHaveBeenCalled();
  });

  it('in locale lancia errore se mancano le variabili obbligatorie', async () => {
    await expect(getConfig()).rejects.toThrow('Variabili d\'ambiente obbligatorie mancanti: WYZ_CLIENT_ID, WYZ_CLIENT_SECRET');
  });

  it('carica il file .env senza sovrascrivere process.env, ignorando commenti e righe malformate', async () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('# commento\n\nNOEQUALS\nWYZ_CLIENT_ID=fromfile\nWYZ_CLIENT_SECRET = sec2 \n=novalue\n');
    process.env.WYZ_CLIENT_SECRET = 'fromenv';

    const cfg = await getConfig();
    expect(cfg.auth.clientId).toBe('fromfile');
    expect(cfg.auth.clientSecret).toBe('fromenv');
  });

  it('usa la cache e la rilegge dopo invalidateConfig', async () => {
    process.env.WYZ_CLIENT_ID = 'id';
    process.env.WYZ_CLIENT_SECRET = 'sec';
    const first = await getConfig();
    expect(await getConfig()).toBe(first);
    invalidateConfig();
    expect(await getConfig()).not.toBe(first);
  });
});
