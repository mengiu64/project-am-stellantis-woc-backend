'use strict';

/**
 * Test unitari per secretsLoader.js (moparDoc).
 * Mock di @aws-sdk/client-ssm e @aws-sdk/client-secrets-manager.
 * Copre: success, cache hit, MOPARDOC_PARAM_NAME mancante, chiavi mancanti,
 * SecretString assente.
 */

// Mock dei client AWS SDK
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

const SECRET_ARN = 'arn:aws:secretsmanager:eu-west-1:237024525379:secret:sm-np-bsn0027990-dev-mopardoc_ibm-fPNxKG';

const VALID_SECRET = {
  MOPARDOC_IBM_CLIENT_ID: 'ibm-id',
  MOPARDOC_IBM_CLIENT_SECRET: 'ibm-secret',
  MOPARDOC_PING_CLIENT_ID: 'ping-id',
  MOPARDOC_PING_CLIENT_SECRET: 'ping-secret',
};

describe('secretsLoader.js – loadSecrets (moparDoc)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.MOPARDOC_PARAM_NAME;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('carica le credenziali da SSM -> Secrets Manager con successo', async () => {
    process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

    const { loadSecrets } = require('../secretsLoader');
    const secrets = await loadSecrets();

    expect(secrets).toEqual(VALID_SECRET);
    expect(mockSsmSend).toHaveBeenCalledTimes(1);
    expect(mockSmSend).toHaveBeenCalledTimes(1);
  });

  it('restituisce i valori dalla cache alla seconda chiamata (nessuna nuova chiamata AWS)', async () => {
    process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

    const { loadSecrets } = require('../secretsLoader');
    await loadSecrets();
    await loadSecrets();

    // Le chiamate AWS restano 1 sola (cache hit sulla seconda)
    expect(mockSsmSend).toHaveBeenCalledTimes(1);
    expect(mockSmSend).toHaveBeenCalledTimes(1);
  });

  it('lancia errore se MOPARDOC_PARAM_NAME non è configurata', async () => {
    const { loadSecrets } = require('../secretsLoader');
    await expect(loadSecrets()).rejects.toThrow(
      '[secrets] Variabile d\'ambiente MOPARDOC_PARAM_NAME non configurata'
    );
  });

  it('lancia errore se il secret non contiene tutte le chiavi richieste', async () => {
    process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({
      SecretString: JSON.stringify({ MOPARDOC_IBM_CLIENT_ID: 'only-one' }),
    });

    const { loadSecrets } = require('../secretsLoader');
    await expect(loadSecrets()).rejects.toThrow('[secrets] Chiavi mancanti nel secret:');
  });

  it('lancia errore se il secret non contiene SecretString', async () => {
    process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({});

    const { loadSecrets } = require('../secretsLoader');
    await expect(loadSecrets()).rejects.toThrow('[secrets] Il secret non contiene SecretString');
  });

  it('invalidateCache forza una nuova lettura da AWS', async () => {
    process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
    mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
    mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

    const { loadSecrets, invalidateCache } = require('../secretsLoader');
    await loadSecrets();
    invalidateCache();
    await loadSecrets();

    expect(mockSsmSend).toHaveBeenCalledTimes(2);
    expect(mockSmSend).toHaveBeenCalledTimes(2);
  });
});
