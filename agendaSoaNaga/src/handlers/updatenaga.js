'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – POST updatenaga
 *
 * event.body must be a JSON string with the appointment payload.
 * event.pathParameters.apptId (or event.params.apptId) must contain the
 * appointment identifier.
 */
exports.handler = async (event) => {
  try {
    const apptId =
      (event.pathParameters && event.pathParameters.apptId) ||
      (event.params && event.params.apptId);

    if (!apptId) {
      return response(400, { success: false, message: 'Missing required param: apptId' });
    }

    const body = event.body ? JSON.parse(event.body) : (event.params || {});
    const client = await buildClient();
    const result = await client.updatenaga(body, apptId);
    return response(result.success ? 200 : 502, result);
  } catch (err) {
    return response(500, { success: false, message: err.message });
  }
};

function response(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
