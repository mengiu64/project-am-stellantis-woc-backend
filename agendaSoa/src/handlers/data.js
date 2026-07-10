'use strict';

const { buildClient } = require('../clientFactory');

/** Lambda handler – GET data (appointment detail)  ({ id }) */
exports.handler = async (event) => {
  try {
    const params = parseParams(event);
    if (!params.id) return response(400, { success: false, message: 'Missing required param: id' });
    const client = await buildClient();
    const result = await client.data(params);
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
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
