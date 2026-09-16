// logger.js
// Modulo logging strutturato con Winston per CloudWatch
// Include: timestamp, livello log, traceId, messaggio, metadati
// Implementa redacting di dati sensibili (password, token, secrets, etc.)

const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Pattern regex per identificare chiavi sensibili - matcha password, secret, token, apikey, etc.
const SENSITIVE_KEY_PATTERN = /pass(word)?|secret|token|api[-_]?key|authorization|bearer|credentials|pwd|auth/i;

// Lunghezza massima di un log body prima di truncare
const MAX_LOG_BODY_LENGTH = 4000;

// Funzione utility: trunca stringa se troppo lunga
function truncate(str) {
  // Se non è stringa, ritorna come è
  if (typeof str !== 'string') return str;
  // Se lunghezza supera limite, trunca con ellipsis
  return str.length > MAX_LOG_BODY_LENGTH
    ? `${str.slice(0, MAX_LOG_BODY_LENGTH)}...[TRUNCATED]`
    : str;
}

// Funzione utility: redatta ricorsivamente dati sensibili in oggetto
function redactValue(value) {
  // Se null o undefined, ritorna come è
  if (value == null) return value;

  // Se è stringa, trunca se necessario
  if (typeof value === 'string') {
    // Se è Bearer token, redatta completamente
    if (value.startsWith('Bearer ') || value.includes('ghp_') || value.includes('secret')) {
      return '***REDACTED***';
    }
    // Altrimenti, trunca se necessario
    return truncate(value);
  }

  // Se è array, mappa redaction su ogni elemento
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }

  // Se è oggetto, redatta ricorsivamente
  if (typeof value === 'object') {
    const redacted = {};
    for (const [key, val] of Object.entries(value)) {
      // Se chiave è sensibile, redatta il valore
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        redacted[key] = '***REDACTED***';
      } else {
        // Altrimenti, ricorri per key-value annidati
        redacted[key] = redactValue(val);
      }
    }
    return redacted;
  }

  // Per altri tipi, ritorna come è
  return value;
}

// Configurazione formato log personalizzato con redacting
const customFormat = winston.format.combine(
  // Aggiunge timestamp ISO al log
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  // Gestisce stack trace di errori
  winston.format.errors({ stack: true }),
  // Supporta string interpolation nei log
  winston.format.splat(),
  // Formatta come JSON
  winston.format.printf(({ timestamp, level, message, ...metadata }) => {
    // Redatta ricorsivamente metadata per removere secrets
    const redactedMeta = redactValue(metadata);
    // Redatta il messaggio stesso se contiene dati sensibili
    const redactedMessage = redactValue(message);
    // Costruisce JSON finale
    return JSON.stringify({
      timestamp,
      level,
      message: redactedMessage,
      ...redactedMeta
    });
  })
);

// Crea logger Winston con configurazione
const logger = winston.createLogger({
  // Livello log da env var (default: info)
  level: process.env.LOG_LEVEL || 'info',
  // Formato personalizzato con redacting
  format: customFormat,
  // Metadati di default su tutti i log
  defaultMeta: {
    service: 'syncro-kafka-events',
    environment: process.env.ENVIRONMENT || 'dev'
  },
  // Transport di output (Console per CloudWatch)
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        // Colora output per readabilità
        winston.format.colorize(),
        // Formatta per console (umano-leggibile)
        winston.format.printf(({ timestamp, level, message, traceId, ...meta }) => {
          // Redatta metadata prima di stampare
          const redactedMeta = redactValue(meta);
          // Redatta messaggio
          const redactedMessage = redactValue(message);
          // Costruisce stringa finale
          const metaStr = Object.keys(redactedMeta).length ? JSON.stringify(redactedMeta) : '';
          return `[${timestamp}] ${level}: [traceId: ${traceId}] ${redactedMessage} ${metaStr}`;
        })
      )
    })
  ]
});

// Classe Logger wrapper con trace ID e redacting
class Logger {
  // Costruttore: accetta traceId opzionale
  constructor(traceId = null) {
    // Genera UUID v4 se traceId non fornito
    this.traceId = traceId || uuidv4();
  }

  // Log informativo - livello INFO
  info(message, meta = {}) {
    try {
      // Redatta metadati sensibili prima di loggare
      const redactedMeta = redactValue(meta);
      // Redatta messaggio
      const redactedMessage = redactValue(message);
      // Logga con Winston
      logger.info(redactedMessage, { traceId: this.traceId, ...redactedMeta });
    } catch (error) {
      // Se redacting fallisce, logga l'errore di logging (non il messaggio originale)
      logger.error('Errore durante logging info', { 
        traceId: this.traceId, 
        error: error.message,
        originalMessageLength: String(message).length 
      });
    }
  }

  // Log errore - livello ERROR
  error(message, error = null, meta = {}) {
    try {
      // Prepara metadati errore (stack trace, message)
      const errorMeta = error ? { 
        errorStack: error.stack,
        errorMessage: error.message,
        errorCode: error.code 
      } : {};
      // Redatta metadati sensibili
      const redactedMeta = redactValue({ ...errorMeta, ...meta });
      // Redatta messaggio
      const redactedMessage = redactValue(message);
      // Logga con Winston
      logger.error(redactedMessage, { traceId: this.traceId, ...redactedMeta });
    } catch (logError) {
      // Se redacting fallisce, logga errore di logging
      logger.error('Errore durante logging error', { 
        traceId: this.traceId, 
        error: logError.message 
      });
    }
  }

  // Log warning - livello WARN
  warn(message, meta = {}) {
    try {
      // Redatta metadati sensibili
      const redactedMeta = redactValue(meta);
      // Redatta messaggio
      const redactedMessage = redactValue(message);
      // Logga con Winston
      logger.warn(redactedMessage, { traceId: this.traceId, ...redactedMeta });
    } catch (error) {
      // Se redacting fallisce, logga errore di logging
      logger.error('Errore durante logging warn', { 
        traceId: this.traceId, 
        error: error.message 
      });
    }
  }

  // Log debug - livello DEBUG (solo se LOG_LEVEL=debug)
  debug(message, meta = {}) {
    try {
      // Redatta metadati sensibili
      const redactedMeta = redactValue(meta);
      // Redatta messaggio
      const redactedMessage = redactValue(message);
      // Logga con Winston
      logger.debug(redactedMessage, { traceId: this.traceId, ...redactedMeta });
    } catch (error) {
      // Se redacting fallisce, logga errore di logging
      logger.error('Errore durante logging debug', { 
        traceId: this.traceId, 
        error: error.message 
      });
    }
  }

  // Factory: crea nuovo logger con trace ID differente
  withTraceId(traceId) {
    // Valida che traceId sia stringa non-empty
    if (!traceId || typeof traceId !== 'string') {
      this.error('TraceId invalido fornito a withTraceId', null, { traceId });
      // Fallback a nuovo UUID
      return new Logger();
    }
    // Ritorna nuovo Logger con traceId specifico
    return new Logger(traceId);
  }

  // Getter: ritorna trace ID corrente
  getTraceId() {
    // Valida che traceId sia disponibile
    if (!this.traceId) {
      throw new Error('TraceId non disponibile');
    }
    return this.traceId;
  }
}

module.exports = Logger;
