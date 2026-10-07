'use strict';

const mockSsmSend = jest.fn();
const mockSmSend = jest.fn();

jest.mock('@aws-sdk/client-ssm', () => ({
  SSMClient: jest.fn(() => ({ send: mockSsmSend })),
  GetParameterCommand: jest.fn((input) => ({ __type: 'GetParameterCommand', input })),
}));
jest.mock('@aws-sdk/client-secrets-manager', () => ({
  SecretsManagerClient: jest.fn(() => ({ send: mockSmSend })),
  GetSecretValueCommand: jest.fn((input) => ({ __type: 'GetSecretValueCommand', input })),
}));

const SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:sm-np-bsn0027990-dev-wyz-AbCdEf';
const VALID_SECRET = { WYZ_CLIENT_ID: 'wi-advisor', WYZ_CLIENT_SECRET: 'shh' };

describe('secretsLoader.loadSecrets (wyz)', () => {
  const originalEnv = process.env;
  let loadSecrets;
  let invalidateCache;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env = { ...originalEnv, WYZ_PARAM_NAME: '/app/np-BSN0027990-dev/wyz' };
    ({ loadSecrets, invalidateCache } = require('../secretsLoader'));
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(() => { process.env = originalEnv; });

  it('carica le credenziali da SSM -> Secrets Manager', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

    await expect(loadSecrets()).resolves.toEqual(VALID_SECRET);
    expect(mockSsmSend.mock.calls[0][0].input).toEqual({ Name: '/app/np-BSN0027990-dev/wyz', WithDecryption: true });
    expect(mockSmSend.mock.calls[0][0].input).toEqual({ SecretId: SECRET_ARN });
  });

  it('usa la cache in memoria alla seconda chiamata e la rilegge dopo invalidateCache', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

    await loadSecrets();
    await loadSecrets();
    expect(mockSsmSend).toHaveBeenCalledTimes(1);

    invalidateCache();
    await loadSecrets();
    expect(mockSsmSend).toHaveBeenCalledTimes(2);
  });

  it('lancia errore se WYZ_PARAM_NAME non è configurata', async () => {
    delete process.env.WYZ_PARAM_NAME;
    await expect(loadSecrets()).rejects.toThrow('WYZ_PARAM_NAME non configurata');
  });

  it('lancia errore se il secret non ha SecretString', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({});
    await expect(loadSecrets()).rejects.toThrow('non contiene SecretString');
  });

  it('lancia errore elencando le chiavi mancanti', async () => {
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify({ WYZ_CLIENT_ID: 'x' }) });
    await expect(loadSecrets()).rejects.toThrow('Chiavi mancanti nel secret: WYZ_CLIENT_SECRET');
  });

  it('propaga gli errori di SSM', async () => {
    mockSsmSend.mockRejectedValue(new Error('ParameterNotFound'));
    await expect(loadSecrets()).rejects.toThrow('ParameterNotFound');
  });
});
