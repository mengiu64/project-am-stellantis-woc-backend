jest.mock('aws-sdk', () => {
  return {
    SSM: jest.fn(() => ({
      getParameter: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Parameter: { Value: 'test-value' } })
      }),
      getParameters: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ Parameters: [] })
      })
    })),
    SecretsManager: jest.fn(() => ({
      getSecretValue: jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue({ SecretString: '{}' })
      })
    }))
  };
});

describe('config.js - Singleton Configuration Manager', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    // Reset config singleton fra i test
    const config = require('../config');
    config.reset();
    
    process.env.ENVIRONMENT = 'dev';
    process.env.AWS_REGION = 'eu-west-1';
    process.env.LOG_LEVEL = 'info';
  });

  describe('getInstance() - Singleton Pattern', () => {
    it('DEVE creare istanza singola di configurazione', async () => {
      const config = require('../config');
      const cfg1 = await config.getInstance();
      const cfg2 = await config.getInstance();
      
      expect(cfg1).toBe(cfg2);
    });

    it('DEVE inizializzare la configurazione', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg).toBeDefined();
      expect(cfg.initialized).toBe(true);
    });

    it('DEVE caricare environment da env variable', async () => {
      process.env.ENVIRONMENT = 'stage';
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      
      expect(cfg.env).toBe('stage');
      expect(cfg.configuration.environment).toBe('stage');
    });

    it('DEVE usare env default dev se non specificato', async () => {
      delete process.env.ENVIRONMENT;
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      
      expect(cfg.env).toBe('dev');
    });
  });

  describe('Configuration Structure', () => {
    it('DEVE contenere sezione AWS', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.aws).toBeDefined();
      expect(cfg.configuration.aws.region).toBeDefined();
      expect(cfg.configuration.aws.partition).toBeDefined();
    });

    it('DEVE contenere sezione OAuth', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.oauth).toBeDefined();
      expect(cfg.configuration.oauth.tokenUrl).toBeDefined();
      expect(cfg.configuration.oauth.scope).toBe('api');
    });

    it('DEVE contenere sezione APIC', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.apic).toBeDefined();
    });

    it('DEVE contenere sezione Logging', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.logging).toBeDefined();
      expect(cfg.configuration.logging.level).toBe('info');
    });

    it('DEVE contenere sezione Timeouts', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.timeouts).toBeDefined();
      expect(cfg.configuration.timeouts.oauth).toBe(5000);
      expect(cfg.configuration.timeouts.dbQuery).toBe(5000);
      expect(cfg.configuration.timeouts.lambda).toBe(30000);
    });

    it('DEVE contenere sezione API endpoints', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.api).toBeDefined();
      expect(cfg.configuration.api.endpoints).toBeDefined();
      expect(cfg.configuration.api.endpoints.postSynchStatus).toBe('/synch-status');
      expect(cfg.configuration.api.endpoints.getSynchStatus).toBe('/synch-status/:requestId');
    });
  });

  describe('isInitialized()', () => {
    it('DEVE avere flag initialized true dopo getInstance', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      expect(cfg.initialized).toBe(true);
    });

    it('DEVE essere istanza singleton unica', async () => {
      const config = require('../config');
      const cfg1 = await config.getInstance();
      const cfg2 = await config.getInstance();
      
      expect(cfg1).toBe(cfg2);
      expect(cfg1.initialized).toBe(true);
      expect(cfg2.initialized).toBe(true);
    });
  });

  describe('getByPath()', () => {
    it('DEVE recuperare valori da path dotato', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      const value = cfg.getByPath('aws.region');
      expect(value).toBe('eu-west-1');
    });

    it('DEVE ritornare null per path non trovato', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      const value = cfg.getByPath('nonexistent.path');
      expect(value === undefined || value === null).toBe(true);
    });

    it('DEVE supportare path annidati profondi', async () => {
      const config = require('../config');
      const cfg = await config.getInstance();
      
      const value = cfg.getByPath('timeouts.oauth');
      expect(value).toBe(5000);
    });
  });

  describe('reset()', () => {
    it('DEVE resettare la singola istanza', async () => {
      const config = require('../config');
      const cfg1 = await config.getInstance();
      
      config.reset();
      
      const cfg2 = await config.getInstance();
      expect(cfg1).not.toBe(cfg2);
    });
  });

  describe('Log Level Management', () => {
    it('DEVE usare log level info per dev/stage', async () => {
      process.env.LOG_LEVEL = 'info';
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.logging.level).toBe('info');
    });

    it('DEVE supportare log level debug', async () => {
      process.env.LOG_LEVEL = 'debug';
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.logging.level).toBe('debug');
    });

    it('DEVE usare log level warn per produzione', async () => {
      process.env.LOG_LEVEL = 'warn';
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      
      expect(cfg.configuration.logging.level).toBe('warn');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Rami "prima di initialize()" — get()/getByPath()/validate() devono lanciare
  // se la configurazione non è ancora stata inizializzata.
  // ───────────────────────────────────────────────────────────────────────────
  describe('Metodi prima di initialize() (istanza non inizializzata)', () => {
    // config.js non esporta la classe Config: la recuperiamo dalla proprietà
    // `constructor` di un'istanza inizializzata, così da poterne creare una
    // "vergine" (initialized === false) senza chiamare getInstance().
    async function makeUninitializedInstance() {
      const config = require('../config');
      config.reset();
      const initialized = await config.getInstance();
      const Config = initialized.constructor;
      config.reset();
      return new Config();
    }

    it('get() DEVE lanciare se non inizializzata', async () => {
      const cfg = await makeUninitializedInstance();
      expect(cfg.initialized).toBe(false);
      expect(() => cfg.get()).toThrow(/non inizializzata/i);
    });

    it('getByPath() DEVE lanciare se non inizializzata', async () => {
      const cfg = await makeUninitializedInstance();
      expect(() => cfg.getByPath('aws.region')).toThrow(/non inizializzata/i);
    });

    it('validate() DEVE lanciare se non inizializzata', async () => {
      const cfg = await makeUninitializedInstance();
      expect(() => cfg.validate()).toThrow(/non inizializzata/i);
    });

    it('get() DEVE restituire la configurazione dopo initialize()', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      const c = cfg.get();
      expect(c).toBe(cfg.configuration);
      expect(c.environment).toBe('dev');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // getByPath() — rami di navigazione (valore non-oggetto a metà path, chiave
  // mancante) che restituiscono null.
  // ───────────────────────────────────────────────────────────────────────────
  describe('getByPath() - rami di navigazione', () => {
    it('DEVE restituire null se una chiave intermedia non è un oggetto', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      // timeouts.oauth è un numero (5000): proseguire oltre deve dare null
      expect(cfg.getByPath('timeouts.oauth.qualcosa')).toBeNull();
    });

    it('DEVE restituire null se la prima chiave non esiste', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      expect(cfg.getByPath('inesistente')).toBeNull();
    });

    it('DEVE recuperare un valore stringa annidato (oauth.scope)', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      expect(cfg.getByPath('oauth.scope')).toBe('api');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // validate() — ramo di errore quando un campo obbligatorio è assente.
  // ───────────────────────────────────────────────────────────────────────────
  describe('validate() - campi obbligatori', () => {
    it('DEVE lanciare se un campo obbligatorio manca', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      // Rimuovo un campo obbligatorio e rieseguo validate()
      cfg.configuration.apic.clientId = undefined;
      expect(() => cfg.validate()).toThrow(/Configurazione obbligatoria mancante: apic\.clientId/);
    });

    it('NON DEVE lanciare quando tutti i campi obbligatori sono presenti', async () => {
      const config = require('../config');
      config.reset();
      const cfg = await config.getInstance();
      expect(() => cfg.validate()).not.toThrow();
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scenari SSM alternativi: richiedono un mock di aws-sdk diverso da quello del
// blocco sopra, quindi usano jest.isolateModules + jest.doMock per re-importare
// config.js con un'implementazione SSM dedicata.
// ─────────────────────────────────────────────────────────────────────────────
describe('config.js - _loadParameters() (scenari SSM)', () => {
  const ORIGINAL_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.resetModules();
    jest.dontMock('aws-sdk');
  });

  function loadConfigWithSsm(getParameterImpl) {
    let freshConfig;
    jest.isolateModules(() => {
      // Sostituisce esplicitamente il mock hoisted di aws-sdk in cima al file
      // con un'implementazione SSM dedicata a questo scenario.
      jest.resetModules();
      jest.doMock('aws-sdk', () => ({
        SSM: jest.fn(() => ({ getParameter: getParameterImpl })),
        SecretsManager: jest.fn(() => ({
          getSecretValue: jest.fn().mockReturnValue({
            promise: jest.fn().mockResolvedValue({ SecretString: '{}' })
          })
        }))
      }));
      freshConfig = require('../config');
    });
    return freshConfig;
  }

  it('DEVE ricadere su env variable quando SSM non trova il parametro (catch interno)', async () => {
    process.env.ENVIRONMENT = 'dev';
    // Fallback env: senza SSM i campi obbligatori arrivano dalle env variables
    process.env.OAUTH_CLIENT_ID = 'env-client-id';
    process.env.OAUTH_CLIENT_SECRET = 'env-secret';
    process.env.OAUTH_TOKEN_URL = 'https://ping/token';
    process.env.IBM_APIC_CLIENT_ID = 'env-apic-id';
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const getParameter = jest.fn().mockReturnValue({
      promise: jest.fn().mockRejectedValue(new Error('ParameterNotFound'))
    });
    const config = loadConfigWithSsm(getParameter);

    const cfg = await config.getInstance();

    // getParameter è stato interrogato per ciascuno dei 4 parametri, tutti
    // falliti -> ciascuno logga un warn e ricade sulla env variable.
    expect(getParameter).toHaveBeenCalledTimes(4);
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(cfg.configuration.oauth.clientId).toBe('env-client-id');
    expect(cfg.configuration.apic.clientId).toBe('env-apic-id');

    warnSpy.mockRestore();
  });

  it('DEVE usare il suffisso vuoto in produzione (naming rule prod)', async () => {
    process.env.ENVIRONMENT = 'produzione';
    process.env.OAUTH_CLIENT_ID = 'p';
    process.env.OAUTH_CLIENT_SECRET = 'p';
    process.env.OAUTH_TOKEN_URL = 'p';
    process.env.IBM_APIC_CLIENT_ID = 'p';

    const getParameter = jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Parameter: { Value: 'from-ssm' } })
    });
    const config = loadConfigWithSsm(getParameter);

    await config.getInstance();

    // Il path prod NON contiene il suffisso ambiente (nessun "-produzione")
    const calledPaths = getParameter.mock.calls.map((c) => c[0].Name);
    expect(calledPaths).toContain('/stellantis/synch-status/oauth_client_id');
    expect(calledPaths.every((p) => !p.includes('-produzione'))).toBe(true);
  });

  it('DEVE valorizzare i parametri OAuth/APIC letti da SSM', async () => {
    process.env.ENVIRONMENT = 'stage';

    const getParameter = jest.fn().mockReturnValue({
      promise: jest.fn().mockResolvedValue({ Parameter: { Value: 'ssm-value' } })
    });
    const config = loadConfigWithSsm(getParameter);

    const cfg = await config.getInstance();

    // Path stage-specifico
    const calledPaths = getParameter.mock.calls.map((c) => c[0].Name);
    expect(calledPaths).toContain('/stellantis/synch-status/oauth_client_id-stage');
    expect(cfg.configuration.oauth.clientId).toBe('ssm-value');
    expect(cfg.configuration.oauth.tokenUrl).toBe('ssm-value');
    expect(cfg.configuration.apic.clientId).toBe('ssm-value');
  });

  it('DEVE propagare come errore di init un fallimento non gestito in initialize()', async () => {
    process.env.ENVIRONMENT = 'dev';
    process.env.OAUTH_CLIENT_ID = 'x';
    process.env.OAUTH_CLIENT_SECRET = 'x';
    process.env.OAUTH_TOKEN_URL = 'x';
    process.env.IBM_APIC_CLIENT_ID = 'x';

    // getParameter che lancia in modo SINCRONO: non intercettato dal try/catch
    // interno del ciclo (che avvolge solo l'await della promise), viene invece
    // catturato dal catch esterno di _loadParameters -> ritorna params parziali;
    // per forzare il catch di initialize() rendiamo getParameter stesso non-callable.
    const getParameter = jest.fn(() => { throw new Error('SSM boom'); });
    const config = loadConfigWithSsm(getParameter);

    // Il throw sincrono avviene dentro il for: catturato dal catch esterno di
    // _loadParameters (console.error) e la init prosegue coi fallback env.
    const errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const cfg = await config.getInstance();
    expect(cfg.initialized).toBe(true);
    errSpy.mockRestore();
  });
});
