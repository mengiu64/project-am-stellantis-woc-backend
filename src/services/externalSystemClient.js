// externalSystemClient.js
// Client HTTP per chiamate a sistemi esterni (DJC/GCT)
// Implementa retry con exponential backoff

const axios = require('axios');

class ExternalSystemClient {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    
    // Configurazione retry
    this.maxRetries = 3;
    this.retryDelays = [1000, 2000, 4000]; // millisecondi
    this.retryableStatuses = [500, 502, 503, 504]; // Server errors
  }

  // Invia evento a sistema esterno (DJC o GCT)
  async sendEvent(system, events, bearerToken, xIbmClientId) {
    const traceId = this.logger.getTraceId();
    
    try {
      this.logger.info(`Invio evento a ${system.toUpperCase()}`, {
        eventCount: events.length,
        system
      });

      const config = this.config.getByPath(`externalSystems.${system.toLowerCase()}`);
      if (!config) {
        throw new Error(`Sistema esterno non configurato: ${system}`);
      }

      // Prepara payload
      const payload = {
        traceId,
        events,
        timestamp: new Date().toISOString()
      };

      // Prepara header
      const headers = {
        'Authorization': `Bearer ${bearerToken}`,
        'X-IBM-Client-Id': xIbmClientId,
        'Content-Type': 'application/json',
        'X-Trace-Id': traceId
      };

      // Invia con retry
      const response = await this._sendWithRetry(
        config.endpoint,
        payload,
        headers,
        config.timeout,
        system
      );

      this.logger.info(`Evento inviato a ${system.toUpperCase()}`, {
        statusCode: response.status,
        eventCount: events.length
      });

      return {
        success: true,
        statusCode: response.status,
        system,
        data: response.data
      };
    } catch (error) {
      this.logger.error(`Errore invio evento a ${system.toUpperCase()}`, error, {
        system,
        eventCount: events.length,
        statusCode: error.response?.status
      });

      // Determina HTTP status da restituire
      const statusCode = this._mapErrorToStatusCode(error);
      
      throw {
        statusCode,
        system,
        message: error.message,
        originalError: error
      };
    }
  }

  // Invia con retry e exponential backoff
  async _sendWithRetry(url, payload, headers, timeout, system, attempt = 0) {
    try {
      this.logger.debug(`Tentativo invio ${attempt + 1}/${this.maxRetries}`, {
        url,
        system,
        attempt: attempt + 1
      });

      const response = await axios.post(url, payload, {
        headers,
        timeout
      });

      return response;
    } catch (error) {
      const statusCode = error.response?.status;
      const isRetryable = this.retryableStatuses.includes(statusCode) || 
                          error.code === 'ECONNABORTED'; // timeout

      // Se non retryable o superati tentativi, lancia errore
      if (!isRetryable || attempt >= this.maxRetries - 1) {
        this.logger.error(`Invio fallito dopo ${attempt + 1} tentativo/i`, error, {
          retryable: isRetryable,
          statusCode,
          attempt: attempt + 1
        });
        throw error;
      }

      // Calcola delay per prossimo tentativo
      const delay = this.retryDelays[attempt];
      
      this.logger.warn(`Retry scheduling`, {
        nextAttempt: attempt + 2,
        delayMs: delay,
        statusCode,
        system
      });

      // Attendi prima di ritentare
      await this._delay(delay);

      // Ricorsione per retry
      return this._sendWithRetry(url, payload, headers, timeout, system, attempt + 1);
    }
  }

  // Map errore a HTTP status code per risposta Lambda
  _mapErrorToStatusCode(error) {
    const statusCode = error.response?.status;

    // Status code diretto da external system
    if (statusCode) {
      if (statusCode >= 400 && statusCode < 500) {
        return 502; // Bad Gateway - external system returned 4xx
      }
      if (statusCode >= 500) {
        return 504; // Gateway Timeout - external system returned 5xx after retries
      }
    }

    // Timeout
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return 504; // Gateway Timeout
    }

    // Network error
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return 502; // Bad Gateway
    }

    // Default
    return 502; // Bad Gateway
  }

  // Utility: delay per retry backoff
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Invia a più sistemi (DJC + GCT)
  async sendToMultipleSystems(events, bearerToken, xIbmClientId, systems = ['djc', 'gct']) {
    const results = {
      successful: [],
      failed: []
    };

    for (const system of systems) {
      try {
        const result = await this.sendEvent(system, events, bearerToken, xIbmClientId);
        results.successful.push(result);
      } catch (error) {
        results.failed.push({
          system,
          statusCode: error.statusCode,
          message: error.message
        });
      }
    }

    this.logger.info('Send to multiple systems completato', {
      successful: results.successful.length,
      failed: results.failed.length
    });

    return results;
  }
}

module.exports = ExternalSystemClient;
