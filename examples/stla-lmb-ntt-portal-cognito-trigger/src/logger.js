const winston = require('winston');

exports.logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return JSON.stringify({
        timestamp,
        logLevel: level.toUpperCase(),
        logMessage: message
      });
    })
  ),
  transports: [new winston.transports.Console()]
});
