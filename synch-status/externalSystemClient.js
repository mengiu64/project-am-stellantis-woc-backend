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

  // Invia evento a sistema esterno (DJC o GCT) con autenticazione completa
  async sendEvent(system, events, bearerToken, xIbmClientId, xIbmClientSecret) {
    // Recupera trace ID dalla logger per tracciamento end-to-end
    const traceId = this.logger.getTraceId();
    
    try {
      // Logga inizio invio evento
      this.logger.info(`Invio evento a ${system.toUpperCase()}`, {
        eventCount: events.length,
        system,
        traceId
      });

      // Valida parametri obbligatori prima di procedere
      if (!bearerToken) {
        throw new Error('Bearer token mancante per autenticazione OAuth2');
      }
      if (!xIbmClientId) {
        throw new Error('X-IBM-Client-Id mancante per autenticazione APIC');
      }
      if (!xIbmClientSecret) {
        throw new Error('X-IBM-Client-Secret mancante per autenticazione APIC');
      }

      // Recupera configurazione sistema esterno (endpoint, timeout, etc.)
      const config = this.config.getByPath(`externalSystems.${system.toLowerCase()}`);
      if (!config) {
        throw new Error(`Sistema esterno non configurato: ${system}`);
      }

      // Logga configurazione sistema (senza esporre secrets)
      this.logger.debug(`Configurazione sistema ${system}`, {
        endpoint: config.endpoint,
        timeout: config.timeout
      });

      // Prepara payload JSON da inviare al sistema esterno
      const payload = {
        traceId,
        events,
        timestamp: new Date().toISOString()
      };

      // Logga payload (senza dati sensibili)
      this.logger.debug(`Payload prepared`, {
        eventCount: events.length,
        traceId
      });

      // Prepara header HTTP con autenticazione OAuth2 + IBM APIC
      const headers = {
        // Header Authorization con Bearer token (OAuth2 da PingFederate)
        'Authorization': `Bearer ${bearerToken}`,
        // IBM API Connect client ID - identifica il client consumer
        'X-IBM-Client-Id': xIbmClientId,
        // IBM API Connect client secret - autentica il client consumer (CRITICO)
        'X-IBM-Client-Secret': xIbmClientSecret,
        // Type di contenuto: JSON
        'Content-Type': 'application/json',
        // Trace ID per correlazione end-to-end
        'X-Trace-Id': traceId
      };

      // Logga header (mascherando dati sensibili)
      this.logger.debug(`HTTP Headers prepared`, {
        hasAuthorization: !!headers['Authorization'],
        hasIbmClientId: !!headers['X-IBM-Client-Id'],
        hasIbmClientSecret: !!headers['X-IBM-Client-Secret'],
        traceId
      });

      // Invia payload con retry e exponential backoff
      const response = await this._sendWithRetry(
        config.endpoint,
        payload,
        headers,
        config.timeout,
        system
      );

      // Logga successo invio
      this.logger.info(`Evento inviato a ${system.toUpperCase()}`, {
        statusCode: response.status,
        eventCount: events.length,
        traceId
      });

      // Ritorna risultato di successo
      return {
        success: true,
        statusCode: response.status,
        system,
        data: response.data,
        traceId
      };
    } catch (error) {
      // Logga errore con dettagli per troubleshooting
      this.logger.error(`Errore invio evento a ${system.toUpperCase()}`, error, {
        system,
        eventCount: events.length,
        statusCode: error.response?.status,
        errorCode: error.code,
        message: error.message,
        traceId
      });

      // Determina HTTP status da restituire al client
      const statusCode = this._mapErrorToStatusCode(error);
      
      // Lancia errore con informazioni strutturate
      throw {
        statusCode,
        system,
        message: error.message,
        traceId,
        originalError: error
      };
    }
  }

  // Invia con retry e exponential backoff - gestisce errori transitori
  async _sendWithRetry(url, payload, headers, timeout, system, attempt = 0) {
    try {
      // Logga tentativo di invio corrente
      this.logger.debug(`Tentativo invio ${attempt + 1}/${this.maxRetries}`, {
        url,
        system,
        attempt: attempt + 1,
        timeoutMs: timeout
      });

      // Esegue POST HTTP verso sistema esterno con timeout
      const response = await axios.post(url, payload, {
        headers,
        timeout,
        // Disabilita retry automatico di axios (gestiamo noi il backoff)
        validateStatus: () => true // Non lancia eccezione per status non 2xx
      });

      // Logga risposta ricevuta
      this.logger.debug(`Risposta ricevuta da ${system}`, {
        statusCode: response.status,
        hasData: !!response.data,
        attempt: attempt + 1
      });

      // Restituisce risposta (anche se status non è 2xx per gestione client)
      return response;
    } catch (error) {
      // Estrae HTTP status code da errore axios (se presente)
      const statusCode = error.response?.status;
      
      // Determina se errore è retryable (5xx o timeout)
      const isRetryable = this.retryableStatuses.includes(statusCode) || 
                          error.code === 'ECONNABORTED' || // Timeout
                          error.code === 'ECONNREFUSED' || // Refused
                          error.code === 'ENOTFOUND'; // DNS not found

      // Se non retryable o superati tentativi, lancia errore senza retry
      if (!isRetryable || attempt >= this.maxRetries - 1) {
        // Logga fallimento definitivo
        this.logger.error(`Invio fallito definitivamente dopo ${attempt + 1} tentativo/i`, error, {
          retryable: isRetryable,
          statusCode,
          errorCode: error.code,
          attempt: attempt + 1,
          system,
          url
        });
        // Lancia eccezione per risalire nel call stack
        throw error;
      }

      // Calcola delay per prossimo tentativo (exponential backoff)
      const delay = this.retryDelays[attempt];
      
      // Logga warning che retry sarà tentato
      this.logger.warn(`Retry scheduling dopo errore`, {
        nextAttempt: attempt + 2,
        delayMs: delay,
        statusCode,
        errorCode: error.code,
        system,
        retryable: isRetryable
      });

      // Attendi il delay prima di ritentare (non blocca async)
      await this._delay(delay);

      // Ricorsione: ritenta invio con attempt incrementato
      return this._sendWithRetry(url, payload, headers, timeout, system, attempt + 1);
    }
  }

  // Map errore a HTTP status code per risposta Lambda verso client
  _mapErrorToStatusCode(error) {
    // Estrae status code da response HTTP (se è stata una chiamata HTTP)
    const statusCode = error.response?.status;

    // Se sistema esterno ha ritornato 4xx → 502 Bad Gateway (errore client)
    if (statusCode) {
      if (statusCode >= 400 && statusCode < 500) {
        this.logger.debug(`Map 4xx error to 502`, { originalStatus: statusCode });
        return 502; // Bad Gateway - sistema esterno ha rifiutato richiesta
      }
      // Se sistema esterno ha ritornato 5xx → 504 Gateway Timeout (esauriti retry)
      if (statusCode >= 500) {
        this.logger.debug(`Map 5xx error to 504`, { originalStatus: statusCode });
        return 504; // Gateway Timeout - sistema esterno non disponibile dopo retry
      }
    }

    // Se errore è timeout → 504 Gateway Timeout
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      this.logger.debug(`Map timeout error to 504`, { errorCode: error.code });
      return 504; // Gateway Timeout - timeout della richiesta
    }

    // Se errore è rifiuto connessione → 502 Bad Gateway
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      this.logger.debug(`Map network error to 502`, { errorCode: error.code });
      return 502; // Bad Gateway - impossibile raggiungere sistema
    }

    // Default per errori sconosciuti
    this.logger.warn(`Map unknown error to 502`, { errorCode: error.code, message: error.message });
    return 502; // Bad Gateway - errore generico
  }

  // Utility: delay non-blocking per exponential backoff
  _delay(ms) {
    // Ritorna promise che si risolve dopo ms millisecondi
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Invia a più sistemi contemporaneamente (DJC + GCT) - pattern parallel
  async sendToMultipleSystems(events, bearerToken, xIbmClientId, xIbmClientSecret, systems = ['djc', 'gct']) {
    // Logga inizio invio parallelo
    this.logger.info(`Inizio invio parallelo a ${systems.length} sistemi`, {
      systems,
      eventCount: events.length
    });

    // Container per risultati di successo e fallimento
    const results = {
      successful: [],
      failed: []
    };

    // Itera su ogni sistema esterno
    for (const system of systems) {
      try {
        // Tenta invio al sistema corrente
        this.logger.debug(`Sending to system: ${system}`);
        const result = await this.sendEvent(system, events, bearerToken, xIbmClientId, xIbmClientSecret);
        // Aggiunge a lista successi
        results.successful.push(result);
        this.logger.info(`Invio a ${system} riuscito`);
      } catch (error) {
        // Logga errore singolo sistema ma continua con prossimi
        this.logger.error(`Invio a ${system} fallito`, error, {
          system,
          errorMessage: error.message
        });
        // Aggiunge a lista fallimenti
        results.failed.push({
          system,
          statusCode: error.statusCode,
          message: error.message,
          traceId: error.traceId
        });
      }
    }

    // Logga riepilogo finale
    this.logger.info('Invio parallelo completato', {
      successful: results.successful.length,
      failed: results.failed.length,
      totalSystems: systems.length
    });

    // Ritorna risultati aggregati
    return results;
  }
}

module.exports = ExternalSystemClient;
