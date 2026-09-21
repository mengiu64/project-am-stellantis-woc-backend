// config.js
// Configurazione centralizzata dell'applicazione
// Carica parametri da environment, Parameter Store, Secrets Manager

const AWS = require('aws-sdk');

// Inizializza client AWS
const ssm = new AWS.SSM({ region: process.env.AWS_REGION || 'eu-west-1' });
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'eu-west-1' });

class Config {
  constructor() {
    this.env = process.env.ENVIRONMENT || 'dev';
    this.awsRegion = process.env.AWS_REGION || 'eu-west-1';
    this.initialized = false;
  }

  // Carica configurazione da Parameter Store / Secrets Manager
  async initialize() {
    try {
      // Carica parametri da Parameter Store con naming convention
      const params = await this._loadParameters();
      
      this.configuration = {
        environment: this.env,
        aws: {
          region: this.awsRegion,
          partition: process.env.AWS_PARTITION || 'aws'
        },
        oauth: {
          clientId: params.OAUTH_CLIENT_ID || process.env.OAUTH_CLIENT_ID,
          clientSecret: params.OAUTH_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET,
          tokenUrl: params.OAUTH_TOKEN_URL || process.env.OAUTH_TOKEN_URL,
          scope: params.OAUTH_SCOPE || 'api'
        },
        apic: {
          clientId: params.IBM_APIC_CLIENT_ID || process.env.IBM_APIC_CLIENT_ID,
          url: params.IBM_APIC_URL || process.env.IBM_APIC_URL
        },
        externalSystems: {
          djc: {
            endpoint: params.DJC_ENDPOINT || process.env.DJC_ENDPOINT,
            timeout: 10000 // 10 secondi
          },
          gct: {
            endpoint: params.GCT_ENDPOINT || process.env.GCT_ENDPOINT,
            timeout: 10000
          }
        },
        api: {
          version: '1.0',
          basePath: '/api'
        },
        logging: {
          level: process.env.LOG_LEVEL || 'info',
          retention: 30 // giorni
        },
        timeouts: {
          oauth: 5000, // 5 secondi
          externalSystem: 10000, // 10 secondi
          lambda: 30000 // 30 secondi
        },
        validation: {
          strictMode: true,
          unknownFields: 'allow' // consenti campi futuri
        }
      };

      this.initialized = true;
      return this.configuration;
    } catch (error) {
      throw new Error(`Errore inizializzazione config: ${error.message}`);
    }
  }

  // Carica parametri da Parameter Store (con naming rule: -dev, -stage, none per prod)
  async _loadParameters() {
    const params = {};
    
    try {
      // Naming rule: stellantis/synch-status/{param-name}-{env}
      const paramNames = [
        'OAUTH_CLIENT_ID',
        'OAUTH_CLIENT_SECRET',
        'OAUTH_TOKEN_URL',
        'IBM_APIC_CLIENT_ID',
        'IBM_APIC_URL',
        'DJC_ENDPOINT',
        'GCT_ENDPOINT'
      ];

      // Carica ogni parametro (usa suffix -dev, -stage, none per prod)
      for (const name of paramNames) {
        const suffix = this.env === 'produzione' ? '' : `-${this.env}`;
        const paramPath = `/stellantis/synch-status/${name.toLowerCase()}${suffix}`;
        
        try {
          const response = await ssm.getParameter({ Name: paramPath }).promise();
          params[name] = response.Parameter.Value;
        } catch (err) {
          // Se non trovato, usa default da environment
          console.warn(`Parametro non trovato: ${paramPath}`);
        }
      }

      return params;
    } catch (error) {
      console.error(`Errore caricamento parametri: ${error.message}`);
      return params;
    }
  }

  // Ottieni configurazione completa
  get() {
    if (!this.initialized) {
      throw new Error('Config non inizializzata - chiama initialize() prima');
    }
    return this.configuration;
  }

  // Ottieni valore specifico per path (es: oauth.clientId)
  getByPath(path) {
    if (!this.initialized) {
      throw new Error('Config non inizializzata');
    }

    const keys = path.split('.');
    let value = this.configuration;

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return null;
      }
    }

    return value;
  }

  // Valida config all'avvio
  validate() {
    if (!this.initialized) {
      throw new Error('Config non inizializzata');
    }

    const required = [
      'oauth.clientId',
      'oauth.clientSecret',
      'oauth.tokenUrl',
      'apic.clientId',
      'externalSystems.djc.endpoint'
    ];

    for (const path of required) {
      const value = this.getByPath(path);
      if (!value) {
        throw new Error(`Configurazione richiesta mancante: ${path}`);
      }
    }
  }
}

// Singleton instance
let configInstance = null;

module.exports = {
  // Inizializza e restituisci config
  async getInstance() {
    if (!configInstance) {
      configInstance = new Config();
      await configInstance.initialize();
      configInstance.validate();
    }
    return configInstance;
  },

  // Resetta singleton (utile per testing)
  reset() {
    configInstance = null;
  }
};
