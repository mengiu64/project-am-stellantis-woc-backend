'use strict';

/**
 * Central Lambda entry-point for NAGA appointment operations.
 * Routes events to the correct handler based on event.action.
 *
 * event shape (when used as a single dispatcher):
 * {
 *   "action": "createnaga" | "updatenaga",
 *   "body": "{ ... }"      // JSON string with appointment payload
 * }
 */

require('dotenv').config();

const handlers = {
  createnaga: require('./src/handlers/createnaga'),
  updatenaga: require('./src/handlers/updatenaga'),
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
