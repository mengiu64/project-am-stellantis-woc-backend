// authService.js
// Gestione OAuth2 + IBM API Connect authentication
// Cache token per performance (TTL 60 minuti con 10 sec buffer)

const axios = require('axios');
const AWS = require('aws-sdk');
const jwt_decode = require('jwt-decode');

// Client AWS Secrets Manager
const secretsManager = new AWS.SecretsManager({ region: process.env.AWS_REGION || 'eu-west-1' });

class AuthService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.tokenCache = {
      token: null,
      expiresAt: null
    };
  }

  // Ottieni token OAuth2 (con caching)
  async getOAuth2Token() {
    try {
      this.logger.info('Verifico cache token OAuth2');

      // Se token in cache e non scaduto, restituisci
      if (this.tokenCache.token && this.tokenCache.expiresAt > Date.now()) {
        this.logger.info('Token da cache', { 
          remainingTime: (this.tokenCache.expiresAt - Date.now()) / 1000,
          unit: 'secondi'
        });
        return this.tokenCache.token;
      }

      // Acquisici nuovo token
      this.logger.info('Acquiring OAuth2 token da PingFederate');

      const secret = await this._getSecret('stellantis/synch-status/oauth-credentials');
      const { clientId, clientSecret } = JSON.parse(secret.SecretString);
      
      const oauthConfig = this.config.getByPath('oauth');
      
      const response = await axios.post(
        oauthConfig.tokenUrl,
        {
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
          scope: oauthConfig.scope
        },
        {
          timeout: this.config.getByPath('timeouts.oauth')
        }
      );

      const token = response.data.access_token;
      const expiresIn = response.data.expires_in || 3600; // 1 ora default

      // Cache token con 10 secondi di buffer prima di effettiva scadenza
      this.tokenCache.token = token;
      this.tokenCache.expiresAt = Date.now() + (expiresIn - 10) * 1000;

      this.logger.info('Token OAuth2 acquisito', {
        expiresIn: expiresIn,
        cachedUntil: new Date(this.tokenCache.expiresAt).toISOString()
      });

      return token;
    } catch (error) {
      this.logger.error('Errore acquisizione OAuth2 token', error, {
        tokenUrl: this.config.getByPath('oauth.tokenUrl')
      });
      throw {
        statusCode: 502,
        message: 'Errore autenticazione con server OAuth2'
      };
    }
  }

  // Valida Bearer token format
  validateBearerToken(token) {
    try {
      if (!token || typeof token !== 'string') {
        throw new Error('Token non valido');
      }

      // Decodifica senza verificare firma (fiducia server OAuth2)
      const decoded = jwt_decode(token);
      
      // Verifica exp claim
      if (decoded.exp && decoded.exp * 1000 < Date.now()) {
        throw new Error('Token scaduto');
      }

      this.logger.debug('Token validato', {
        userId: decoded.sub || decoded.user_id,
        expiresAt: new Date(decoded.exp * 1000).toISOString()
      });

      return { valid: true, decoded };
    } catch (error) {
      this.logger.warn('Token validation fallito', { error: error.message });
      return { valid: false, error: error.message };
    }
  }

  // Ottieni header per chiamate sistemi esterni (DJC/GCT)
  async getExternalSystemHeaders() {
    try {
      // Ottieni OAuth2 token
      const oauthToken = await this.getOAuth2Token();

      // Ottieni IBM API Connect client ID
      const apicConfig = this.config.getByPath('apic');
      
      return {
        'Authorization': `Bearer ${oauthToken}`,
        'X-IBM-Client-Id': apicConfig.clientId,
        'Content-Type': 'application/json',
        'User-Agent': 'stellantis-synch-status/1.0'
      };
    } catch (error) {
      this.logger.error('Errore preparazione header esterni', error);
      throw error;
    }
  }

  // Verifica permission dal token JWT
  verifyPermissions(decodedToken, requiredRoles = []) {
    try {
      const roles = decodedToken.roles || decodedToken.resource_access?.roles || [];

      // Se richieste specifiche role, verifica
      if (requiredRoles.length > 0) {
        const hasRole = requiredRoles.some(role => roles.includes(role));
        if (!hasRole) {
          this.logger.warn('Permission denied - ruoli insufficienti', {
            required: requiredRoles,
            actual: roles
          });
          return { authorized: false, reason: 'Ruoli insufficienti' };
        }
      }

      this.logger.debug('Permessi verificati', { roles });
      return { authorized: true };
    } catch (error) {
      this.logger.error('Errore verifica permission', error);
      return { authorized: false, reason: 'Errore verifica permission' };
    }
  }

  // Ottieni secret da AWS Secrets Manager (con caching)
  async _getSecret(secretName) {
    try {
      const response = await secretsManager.getSecretValue({ SecretId: secretName }).promise();
      
      if ('SecretString' in response) {
        return { SecretString: response.SecretString };
      } else {
        return { SecretBinary: response.SecretBinary };
      }
    } catch (error) {
      this.logger.error('Errore caricamento secret', error, { secretName });
      throw {
        statusCode: 500,
        message: 'Errore caricamento secret'
      };
    }
  }

  // Resetta cache token (utile per testing)
  resetCache() {
    this.tokenCache = {
      token: null,
      expiresAt: null
    };
    this.logger.debug('Token cache resettato');
  }
}

module.exports = AuthService;
