'use strict';

// Caricamento dei segreti da AWS SSM Parameter Store + Secrets Manager.
// Pattern (identico a moparDoc): env WYZ_PARAM_NAME → parametro SSM (contiene l'ARN del secret)
// → Secrets Manager (contiene le credenziali). Cache in memoria per i warm start.

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Client AWS inizializzati una sola volta e riutilizzati tra le invocazioni
const ssmClient = new SSMClient({});
const smClient = new SecretsManagerClient({});

// Cache dei segreti: persiste nello stesso container Lambda (warm start)
let cachedSecrets = null;

/**
 * Recupera un parametro da SSM Parameter Store (con decrittazione).
 * @param {string} paramName - percorso del parametro (valore = ARN/id del secret)
 * @returns {Promise<string>}
 */
async function getSsmParameter(paramName) {
  console.log(`[secrets] Recupero parametro SSM: ${paramName}`);
  const response = await ssmClient.send(new GetParameterCommand({ Name: paramName, WithDecryption: true }));
  return response.Parameter.Value;
}

/**
 * Recupera e parsa un secret JSON da Secrets Manager.
 * @param {string} secretArn
 * @returns {Promise<object>}
 * @throws {Error} se il secret non contiene SecretString
 */
async function getSecretValue(secretArn) {
  // Non si logga mai l'ARN completo né il contenuto del secret
  console.log('[secrets] Recupero secret da Secrets Manager');
  const response = await smClient.send(new GetSecretValueCommand({ SecretId: secretArn }));
  if (!response.SecretString) {
    throw new Error('[secrets] Il secret non contiene SecretString');
  }
  return JSON.parse(response.SecretString);
}

/**
 * Carica le credenziali Wyz (SSM → Secrets Manager) con cache in memoria.
 * Chiavi obbligatorie: WYZ_CLIENT_ID, WYZ_CLIENT_SECRET.
 * Chiavi opzionali: WYZ_BASE_URL, WYZ_IAM_BASE_URL, WYZ_TENANT (override dei default preprod).
 * @returns {Promise<object>}
 * @throws {Error} se WYZ_PARAM_NAME manca, o parametro/secret non sono recuperabili/completi
 */
async function loadSecrets() {
  if (cachedSecrets) {
    console.log('[secrets] Credenziali recuperate dalla cache in memoria');
    return cachedSecrets;
  }

  const ssmParamPath = process.env.WYZ_PARAM_NAME;
  if (!ssmParamPath) {
    throw new Error("[secrets] Variabile d'ambiente WYZ_PARAM_NAME non configurata");
  }

  // Passo 1: ARN del secret dal parametro SSM
  const secretArn = await getSsmParameter(ssmParamPath);
  console.log('[secrets] ARN del secret recuperato da SSM');

  // Passo 2: credenziali dal secret
  const secrets = await getSecretValue(secretArn);

  // Validazione delle chiavi obbligatorie
  const requiredKeys = ['WYZ_CLIENT_ID', 'WYZ_CLIENT_SECRET'];
  const missingKeys = requiredKeys.filter((k) => !secrets[k]);
  if (missingKeys.length > 0) {
    throw new Error(`[secrets] Chiavi mancanti nel secret: ${missingKeys.join(', ')}`);
  }

  cachedSecrets = secrets;
  console.log('[secrets] Credenziali caricate e salvate in cache');
  return secrets;
}

/** Invalida la cache dei segreti (test / refresh forzato). */
function invalidateCache() {
  cachedSecrets = null;
}

module.exports = { loadSecrets, invalidateCache };
