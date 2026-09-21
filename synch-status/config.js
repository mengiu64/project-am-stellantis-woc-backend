// config.js
// Configurazione centralizzata per lambda syncro-kafka-events
// Carica parametri da AWS Parameter Store e Secrets Manager
// Nota: Questa lambda RICEVE SOLO Kafka events e registra in Aurora - NON invia a sistemi esterni

const AWS = require('aws-sdk');

// Inizializza client AWS per caricamento configurazione
const ssm = new AWS.SSM({ region: process.env.AWS_REGION || 'eu-west-1' });
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'eu-west-1' });

// Classe singleton per gestire configurazione centralizzata
class Config {
  constructor() {
    // Ambiente corrente (dev, stage, produzione)
    this.env = process.env.ENVIRONMENT || 'dev';
    // Regione AWS per i servizi
    this.awsRegion = process.env.AWS_REGION || 'eu-west-1';
    // Flag inizializzazione
    this.initialized = false;
  }

  // Carica configurazione da Parameter Store / Secrets Manager
  async initialize() {
    try {
      // Carica parametri da AWS Parameter Store
      const params = await this._loadParameters();
      
      // Struttura configurazione centralizzata
      this.configuration = {
        // Ambiente corrente
        environment: this.env,
        
        // AWS Configuration
        aws: {
          region: this.awsRegion,
          partition: process.env.AWS_PARTITION || 'aws'
        },
        
        // OAuth2 Configuration (PingFederate per autenticazione bearer token)
        oauth: {
          clientId: params.OAUTH_CLIENT_ID || process.env.OAUTH_CLIENT_ID,
          clientSecret: params.OAUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET,
          tokenUrl: params.OAUTH_TOKEN_URL || process.env.OAUTH_TOKEN_URL,
          scope: params.OAUTH_SCOPE || 'api'
        },
        
        // IBM API Connect Configuration (per header X-IBM-Client-Id)
        apic: {
          clientId: params.IBM_APIC_CLIENT_ID || process.env.IBM_APIC_CLIENT_ID,
          url: params.IBM_APIC_URL || process.env.IBM_APIC_URL
        },
        
        // API Configuration
        api: {
          version: '1.0',
          basePath: '/api',
          // Endpoint della lambda: /synch-status (POST/GET)
          endpoints: {
            postSynchStatus: '/synch-status',
            getSynchStatus: '/synch-status/:requestId'
          }
        },
        
        // Logging Configuration
        logging: {
          level: process.env.LOG_LEVEL || 'info',
          retention: 30 // Giorni di retention log su CloudWatch
        },
        
        // Timeout Configuration
        timeouts: {
          oauth: 5000, // 5 secondi per acquisire token OAuth2
          dbQuery: 5000, // 5 secondi per query Aurora
          lambda: 30000 // 30 secondi timeout totale Lambda
        },
        
        // Validazione Configuration
        validation: {
          strictMode: true,
          // Permetti campi futuri nel payload (forward compatibility)
          unknownFields: 'allow'
        }
      };

      // Marca come inizializzato
      this.initialized = true;
      return this.configuration;
    } catch (error) {
      throw new Error(`Errore inizializzazione config: ${error.message}`);
    }
  }

  // Carica parametri da AWS Parameter Store seguendo naming rule
  // Rule: -dev in stage, -stage sarà -stage, produzione non ha suffisso
  async _loadParameters() {
    const params = {};
    
    try {
      // Lista parametri da caricare da Parameter Store
      const paramNames = [
        'OAUTH_CLIENT_ID',           // ID client OAuth2 PingFederate
        'OAUTH_CLIENT_SECRET',       // Secret OAuth2 PingFederate
        'OAUTH_TOKEN_URL',           // Token endpoint PingFederate
        'IBM_APIC_CLIENT_ID'         // Client ID per IBM API Connect
      ];

      // Carica ogni parametro con naming rule ambiente-specifico
      for (const name of paramNames) {
        // Calcola suffisso naming: "" per prod, "-dev" per dev, "-stage" per stage
        const suffix = this.env === 'produzione' ? '' : `-${this.env}`;
        // Path nel Parameter Store: /stellantis/synch-status/{param}-{env}
        const paramPath = `/stellantis/synch-status/${name.toLowerCase()}${suffix}`;
        
        try {
          // Recupera parametro da SSM Parameter Store
          const response = await ssm.getParameter({ Name: paramPath }).promise();
          params[name] = response.Parameter.Value;
        } catch (err) {
          // Se parametro non trovato in Parameter Store, usa environment variable fallback
          console.warn(`Parametro non trovato in SSM: ${paramPath} - uso environment variable`);
        }
      }

      return params;
    } catch (error) {
      // Log errore caricamento parametri
      console.error(`Errore caricamento parametri da SSM: ${error.message}`);
      return params;
    }
  }

  // Ottieni configurazione completa (dopo initialize)
  get() {
    if (!this.initialized) {
      throw new Error('Config non inizializzata - chiama initialize() prima');
    }
    return this.configuration;
  }

  // Ottieni valore specifico per path (es: oauth.clientId oppure apic.clientId)
  getByPath(path) {
    if (!this.initialized) {
      throw new Error('Config non inizializzata');
    }

    // Split path by dot notation (es: "oauth.clientId" → ["oauth", "clientId"])
    const keys = path.split('.');
    let value = this.configuration;

    // Naviga nella struttura per trovare il valore
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        // Path non trovato
        return null;
      }
    }

    return value;
  }

  // Valida configurazione all'avvio - verifica campi obbligatori
  validate() {
    if (!this.initialized) {
      throw new Error('Config non inizializzata');
    }

    // Campi obbligatori per il funzionamento della lambda
    // CORRETTO: Solo OAuth e APIC - rimossi riferimenti a DJC e GCT
    const required = [
      'oauth.clientId',          // Obbligatorio per autenticazione
      'oauth.clientSecret',      // Obbligatorio per autenticazione
      'oauth.tokenUrl',          // Obbligatorio per acquisire token
      'apic.clientId'            // Obbligatorio per header APIC
    ];

    // Verifica che tutti i campi obbligatori siano presenti
    for (const path of required) {
      const value = this.getByPath(path);
      if (!value) {
        throw new Error(`Configurazione obbligatoria mancante: ${path}`);
      }
    }
  }
}

// Singleton instance di Config
let configInstance = null;

// Export module
module.exports = {
  // Metodo factory per ottenere istanza singleton di Config
  // Crea e inizializza una volta sola se non esiste già
  async getInstance() {
    if (!configInstance) {
      configInstance = new Config();
      await configInstance.initialize();
      // Valida che tutti i parametri obbligatori siano presenti
      configInstance.validate();
    }
    return configInstance;
  },

  // Metodo per resettare singleton (utile per testing)
  reset() {
    configInstance = null;
  }
};
