'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – POST createnaga
 *
 * Full appointment payload must be in event.body (JSON string).
 */
exports.handler = async (event) => {
  try {
    const body = event.body ? JSON.parse(event.body) : (event.params || {});
    const client = buildClient();
    const result = await client.createnaga(body);
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    return response(500, { success: false, message: err.message });
  }
};

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
