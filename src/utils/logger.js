// logger.js
// Modulo logging strutturato con Winston per CloudWatch
// Include: timestamp, livello log, traceId, messaggio, metadati

const winston = require('winston');
const { v4: uuidv4 } = require('uuid');

// Configurazione formato log personalizzato
const customFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.splat(),
  winston.format.json()
);

// Crea logger Winston
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: customFormat,
  defaultMeta: {
    service: 'syncro-kafka-events',
    environment: process.env.ENVIRONMENT || 'dev'
  },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, traceId, ...meta }) => {
          const metaStr = Object.keys(meta).length ? JSON.stringify(meta) : '';
          return `[${timestamp}] ${level}: [traceId: ${traceId}] ${message} ${metaStr}`;
        })
      )
    })
  ]
});

// Classe Logger wrapper con trace ID
class Logger {
  constructor(traceId = null) {
    this.traceId = traceId || uuidv4();
  }

  // Log informativo
  info(message, meta = {}) {
    logger.info(message, { traceId: this.traceId, ...meta });
  }

  // Log errore
  error(message, error = null, meta = {}) {
    const errorMeta = error ? { errorStack: error.stack, errorMessage: error.message } : {};
    logger.error(message, { traceId: this.traceId, ...errorMeta, ...meta });
  }

  // Log warning
  warn(message, meta = {}) {
    logger.warn(message, { traceId: this.traceId, ...meta });
  }

  // Log debug
  debug(message, meta = {}) {
    logger.debug(message, { traceId: this.traceId, ...meta });
  }

  // Copia logger con nuovo trace ID
  withTraceId(traceId) {
    return new Logger(traceId);
  }

  // Ottieni trace ID corrente
  getTraceId() {
    return this.traceId;
  }
}

module.exports = Logger;
