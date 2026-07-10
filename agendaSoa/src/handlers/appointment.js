'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – GET appointment
 *
 * Expected queryStringParameters / body:
 *   { ccs: "...", date: "YYYY-MM-DD", ldapId: "...", pdvId: "...", locale: "..." }
 */
exports.handler = async (event) => {
  try {
    const params = parseParams(event);
    const client = await buildClient();
    const result = await client.appointment(params);
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    return response(500, { success: false, message: err.message });
  }
};

function parseParams(event) {
  return {
    ...(event.queryStringParameters || {}),
    ...(event.body ? JSON.parse(event.body) : {}),
    ...(event.params || {}),
  };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
