'use strict';

const pending = new Map();

async function loadSettings(reference = 'WOC_CONFIG_SECRET_ID') {
  const secretId = process.env[reference];
  if (!secretId) {
    if (process.env.AWS_LAMBDA_FUNCTION_NAME) {
      throw new Error(`[runtimeConfig] ${reference} is required`);
    }
    return process.env;
  }
  if (!pending.has(secretId)) {
    pending.set(secretId, readSecret(secretId).catch((error) => {
      pending.delete(secretId);
      throw error;
    }));
  }
  return pending.get(secretId);
}

async function readSecret(secretId) {
  const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
  let response;
  try {
    response = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
  } catch (error) {
    throw new Error('[runtimeConfig] Cannot retrieve configuration secret', { cause: error });
  }
  let settings;
  try {
    settings = JSON.parse(response.SecretString);
  } catch (error) {
    throw new Error('[runtimeConfig] Configuration secret must contain JSON');
  }
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('[runtimeConfig] Configuration secret must contain a JSON object');
  }
  return settings;
}

function requireSettings(settings, keys) {
  const missing = keys.filter((key) => settings[key] === undefined || settings[key] === null || settings[key] === '');
  if (missing.length) {
    throw new Error(`[runtimeConfig] Missing configuration keys: ${missing.join(', ')}`);
  }
  return settings;
}

function resetCache() {
  pending.clear();
}

module.exports = { loadSettings, requireSettings, resetCache };
