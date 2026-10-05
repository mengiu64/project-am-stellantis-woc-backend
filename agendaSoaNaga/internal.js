'use strict';

const { handleInternal } = require('../serviceClient');
const { handler } = require('./src/handlers/updatenaga');
const create = require('./src/handlers/createnaga').handler;

async function unwrap(response) {
  const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
  if (response.statusCode >= 400) {
    const error = new Error(body.message || body.error || 'Operazione NAGA fallita');
    error.statusCode = response.statusCode;
    throw error;
  }
  return body;
}

exports.handler = (event) => handleInternal(event, 'agendasoanaga', {
  updatenaga: async (payload) => unwrap(await handler({
    pathParameters: { apptId: payload.apptId }, body: JSON.stringify(payload),
  })),
  createnaga: async (payload) => unwrap(await create({ body: JSON.stringify(payload) })),
});
