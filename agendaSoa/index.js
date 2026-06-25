'use strict';

/**
 * Central Lambda entry-point.
 * Routes events to the correct handler based on event.method + event.action,
 * or you can invoke each handler directly as separate Lambda functions.
 *
 * event shape (when used as a single dispatcher):
 * {
 *   "action": "appointment" | "availableHours" |
 *             "cCSList" | "data",
 *   "queryStringParameters": { ... },
 *   "pathParameters": { ... },
 *   "body": "{ ... }"      // JSON string
 * }
 */

require('dotenv').config();

const handlers = {
  appointment:        require('./src/handlers/appointment'),
  availableHours:     require('./src/handlers/availableHours'),
  cCSList:            require('./src/handlers/cCSList'),
  data:               require('./src/handlers/data'),
};

exports.handler = async (event, context) => {
  const action = event.action || event.httpMethod;

  if (!action || !handlers[action]) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Unknown action: "${action}". Valid actions: ${Object.keys(handlers).join(', ')}`,
      }),
    };
  }

  return handlers[action].handler(event, context);
};
