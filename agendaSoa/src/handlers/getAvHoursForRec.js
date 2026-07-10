'use strict';

const { buildClient } = require('../clientFactory');

/**
 * Lambda handler – GET available hours for receptionist (getAvHoursForRec)
 *
 * Calls availableHours + appointment internally, then filters out busy slots.
 *
 * Expected params: { pdvId, date, ccs, locale, ldapId? }
 *   date: YYYYMMDD or YYYY-MM-DD
 */
exports.handler = async (event) => {
  try {
    const params = parseParams(event);
    const { pdvId, date, ccs, locale, ldapId } = params;

    const missing = ['pdvId', 'date', 'ccs', 'locale'].filter((k) => !params[k]);
    if (missing.length) {
      return response(400, { success: false, message: `Missing required params: ${missing.join(', ')}` });
    }

    const client = await buildClient();
    const result = await client.getAvHoursForRec(pdvId, date, ccs, locale, ldapId);
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
