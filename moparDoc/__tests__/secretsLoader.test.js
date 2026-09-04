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

// Fixture condivisa a sei chiavi (Req 5.1)
const { VALID_SECRET } = require('./fixtures/validSecret');

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

  /**
   * Property 1: La validazione del Secret fallisce su chiave di accesso mancante.
   * Per qualunque secret che contenga tutte le chiavi tranne una tra
   * MOPARDOC_API_ACCESS_CODE e MOPARDOC_TAM_ACCESS_CODE, loadSecrets() DEVE lanciare
   * un errore il cui messaggio nomina la chiave mancante e NON deve popolare la cache.
   *
   * Tag: Feature: mopardoc-access-codes-to-secret, Property 1
   * Validates: Requirements 1.1, 2.1, 2.2, 5.4
   */
  describe('Property 1: validazione del Secret su chiave di accesso mancante', () => {
    // Le due nuove chiavi di accesso sensibili sottoposte a validazione
    const ACCESS_CODE_KEYS = ['MOPARDOC_API_ACCESS_CODE', 'MOPARDOC_TAM_ACCESS_CODE'];

    // Generatore inline (fast-check non è tra le dipendenze): produce un secret
    // valido a cui viene rimossa esattamente una delle due chiavi di accesso.
    // Randomizza anche i valori delle altre chiavi per esplorare lo spazio di input.
    function generateSecretMissingKey(iteration) {
      // Sceglie in modo deterministico-pseudocasuale quale delle due chiavi rimuovere
      const missingKey = ACCESS_CODE_KEYS[iteration % ACCESS_CODE_KEYS.length];
      // Parte da una copia della fixture a sei chiavi
      const secret = { ...VALID_SECRET };
      // Randomizza i valori (non-vuoti) delle altre chiavi per variare gli input generati
      for (const key of Object.keys(secret)) {
        secret[key] = `${key.toLowerCase()}-${iteration}-${Math.random().toString(36).slice(2)}`;
      }
      // Rimuove la chiave selezionata: è la condizione che deve far fallire loadSecrets
      delete secret[missingKey];
      // Restituisce il secret generato e la chiave mancante attesa nel messaggio d'errore
      return { secret, missingKey };
    }

    it('lancia errore che nomina la chiave mancante e non popola la cache (>=100 iterazioni)', async () => {
      // Numero di iterazioni generate: soddisfa il minimo di 100 richiesto dalla proprietà
      const ITERATIONS = 120;

      for (let i = 0; i < ITERATIONS; i++) {
        // Reset completo dei mock e dei moduli a ogni iterazione per isolare la cache
        jest.clearAllMocks();
        jest.resetModules();
        process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';

        // Genera un secret privo di una delle due chiavi di accesso
        const { secret, missingKey } = generateSecretMissingKey(i);

        // Configura la pipeline mock SSM -> Secrets Manager con il secret incompleto
        mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
        mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(secret) });

        // Carica una nuova istanza del modulo (cache azzerata da resetModules)
        const { loadSecrets } = require('../secretsLoader');

        // Asserzione 1: loadSecrets rigetta con un errore che nomina la chiave mancante
        await expect(loadSecrets()).rejects.toThrow(missingKey);

        // Asserzione 2: la cache non è stata popolata. Se lo fosse, una seconda chiamata
        // con un secret ora VALIDO sarebbe servita dalla cache (nessuna nuova chiamata AWS).
        // Verifichiamo invece che la pipeline AWS venga interrogata di nuovo (cache vuota).
        mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });
        const secondCallCountBefore = mockSmSend.mock.calls.length;
        const secrets = await loadSecrets();
        // La seconda chiamata ha effettivamente contattato Secrets Manager => cache era vuota
        expect(mockSmSend.mock.calls.length).toBe(secondCallCountBefore + 1);
        // E ora restituisce il secret valido completo
        expect(secrets).toEqual(VALID_SECRET);
      }
    });
  });

  /**
   * Test di esempio: nessun valore di codice nei log di secretsLoader.
   * Spia su console.log/console.error e verifica che nessun argomento loggato
   * contenga i valori dei codici di accesso, sia sul percorso di successo sia su
   * quello di errore (chiave mancante).
   *
   * Validates: Requirement 4.1
   */
  describe('nessun valore di codice nei log', () => {
    // Estrae i valori sensibili dei due codici dalla fixture
    const CODE_VALUES = [
      VALID_SECRET.MOPARDOC_API_ACCESS_CODE,
      VALID_SECRET.MOPARDOC_TAM_ACCESS_CODE,
    ];

    // Serializza ogni argomento loggato in stringa per la ricerca dei valori sensibili
    function collectLoggedText(spy) {
      // Concatena tutti gli argomenti di tutte le chiamate in un'unica stringa
      return spy.mock.calls
        .flat()
        .map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg)))
        .join(' | ');
    }

    it('non stampa i valori dei codici sul percorso di successo', async () => {
      process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
      mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
      mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(VALID_SECRET) });

      // Spia su console.log e console.error senza sopprimere il comportamento reale
      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const { loadSecrets } = require('../secretsLoader');
      await loadSecrets();

      // Nessun valore di codice deve comparire tra gli argomenti loggati
      const loggedText = `${collectLoggedText(logSpy)} | ${collectLoggedText(errorSpy)}`;
      for (const value of CODE_VALUES) {
        expect(loggedText).not.toContain(value);
      }

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });

    it('non stampa i valori dei codici sul percorso di errore (chiave mancante)', async () => {
      process.env.MOPARDOC_PARAM_NAME = '/app/np-BSN0027990-dev/mopardoc_ibm';
      mockSsmSend.mockResolvedValue({ Parameter: { Value: SECRET_ARN } });
      // Secret che include comunque i valori dei codici ma con una chiave "mancante"
      // sotto un nome errato, per verificare che i valori non finiscano nei log d'errore.
      const secretWithWrongKey = {
        MOPARDOC_IBM_CLIENT_ID: 'ibm-id',
        MOPARDOC_IBM_CLIENT_SECRET: 'ibm-secret',
        MOPARDOC_PING_CLIENT_ID: 'ping-id',
        MOPARDOC_PING_CLIENT_SECRET: 'ping-secret',
        MOPARDOC_API_ACCESS_CODE: VALID_SECRET.MOPARDOC_API_ACCESS_CODE,
        // MOPARDOC_TAM_ACCESS_CODE volutamente assente per innescare l'errore
        SOME_STALE_VALUE: VALID_SECRET.MOPARDOC_TAM_ACCESS_CODE,
      };
      mockSmSend.mockResolvedValue({ SecretString: JSON.stringify(secretWithWrongKey) });

      const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      const { loadSecrets } = require('../secretsLoader');
      // Il caricamento fallisce perché MOPARDOC_TAM_ACCESS_CODE è assente
      await expect(loadSecrets()).rejects.toThrow('MOPARDOC_TAM_ACCESS_CODE');

      // Anche sul percorso di errore, nessun valore di codice deve comparire nei log
      const loggedText = `${collectLoggedText(logSpy)} | ${collectLoggedText(errorSpy)}`;
      for (const value of CODE_VALUES) {
        expect(loggedText).not.toContain(value);
      }

      logSpy.mockRestore();
      errorSpy.mockRestore();
    });
  });
});
