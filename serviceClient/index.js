'use strict';

const SERVICES = new Set([
  'dms', 'dbmanager', 'pkeper', 'pkdocsoa', 'pkmenupricing',
  'session', 'mypeople', 'v360', 'agendasoanaga', 'jobcard', 'dmlconfigsync',
]);

async function callService(service, operation, payload = {}) {
  if (!SERVICES.has(service) || !/^[a-zA-Z][a-zA-Z0-9-]*$/.test(operation)) {
    throw new Error('[serviceClient] servizio/operazione non validi');
  }
  const { loadSettings, requireSettings } = require('../runtimeConfig');
  const settings = await loadSettings('WOC_INTERNAL_CONFIG_SECRET_ID');
  if (process.env.WOC_INTERNAL_CONFIG_SECRET_ID) {
    requireSettings(settings, ['WOC_INTERNAL_API_URL', 'WOC_INTERNAL_TIMEOUT_MS']);
  }
  const base = settings.WOC_INTERNAL_API_URL;
  const region = process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION;
  if (!base || !region) {
    throw new Error('[serviceClient] WOC_INTERNAL_API_URL e AWS_REGION sono obbligatori');
  }
  const url = new URL(base);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('[serviceClient] WOC_INTERNAL_API_URL deve essere un URL HTTPS senza credenziali/query');
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/internal/${service}/${operation}`;
  const timeout = Number(settings.WOC_INTERNAL_TIMEOUT_MS ?? 25000);
  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error('[serviceClient] WOC_INTERNAL_TIMEOUT_MS deve essere positivo');
  }
  const body = JSON.stringify(payload);
  const { SignatureV4 } = require('@smithy/signature-v4');
  const { defaultProvider } = require('@aws-sdk/credential-provider-node');
  const { Sha256 } = require('@aws-crypto/sha256-js');
  const signer = new SignatureV4({
    credentials: defaultProvider(), region, service: 'execute-api', sha256: Sha256,
  });
  const signed = await signer.sign({
    protocol: url.protocol, hostname: url.hostname,
    ...(url.port ? { port: Number(url.port) } : {}),
    method: 'POST', path: url.pathname,
    headers: { host: url.host, 'content-type': 'application/json' }, body,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'POST', headers: signed.headers, body, signal: controller.signal, redirect: 'manual',
    });
    const text = await response.text();
    let result;
    try {
      result = JSON.parse(text);
    } catch (_) {
      throw new Error(`[serviceClient] ${service}/${operation}: risposta non JSON (HTTP ${response.status})`);
    }
    if (!response.ok) {
      const error = new Error(`[serviceClient] ${service}/${operation}: HTTP ${response.status}: ${result?.message || 'richiesta fallita'}`);
      error.statusCode = response.status;
      throw error;
    }
    if (!result || !Object.prototype.hasOwnProperty.call(result, 'data')) {
      throw new Error(`[serviceClient] ${service}/${operation}: contratto della risposta non valido`);
    }
    return result.data;
  } finally {
    clearTimeout(timer);
  }
}

function isInternalRequest(event = {}) {
  return /^\/internal\//.test(event.path || event.rawPath || '');
}

function jsonResponse(statusCode, payload) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) };
}

async function handleInternal(event, service, operations) {
  const path = event.path || event.rawPath || '';
  const match = path.match(/^\/internal\/([^/]+)\/([a-zA-Z][a-zA-Z0-9-]*)$/);
  if (!match || match[1] !== service) return jsonResponse(404, { message: 'Rotta interna non trovata' });
  // L'identita' IAM viene valorizzata da API Gateway, non da header/body client.
  if (!event.requestContext?.identity?.userArn) {
    return jsonResponse(403, { message: 'Autenticazione IAM richiesta' });
  }
  if (event.httpMethod !== 'POST') return jsonResponse(405, { message: 'Metodo non supportato' });
  const operation = operations[match[2]];
  if (!Object.prototype.hasOwnProperty.call(operations, match[2]) || typeof operation !== 'function') {
    return jsonResponse(404, { message: 'Operazione interna non trovata' });
  }
  let payload;
  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64').toString('utf8')
      : event.body;
    payload = typeof body === 'string' ? JSON.parse(body) : body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('object required');
  } catch (_) {
    return jsonResponse(400, { message: 'Body JSON oggetto obbligatorio' });
  }
  try {
    const data = await operation(payload);
    return jsonResponse(200, { data: data === undefined ? null : data });
  } catch (error) {
    console.error(`[internal:${service}/${match[2]}]`, error.message);
    return jsonResponse(error.statusCode || (error.message.includes('is required') ? 400 : 502), { message: error.message });
  }
}

function requireArgs(payload) {
  if (!Array.isArray(payload.args)) {
    const error = new Error('"args" is required (array)');
    error.statusCode = 400;
    throw error;
  }
  return payload.args;
}

module.exports = { callService, isInternalRequest, handleInternal, requireArgs };
