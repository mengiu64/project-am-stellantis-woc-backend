'use strict';

// Carica da AWS Secrets Manager il secret unico che contiene TUTTE le URL/path
// di PingFederate e dei servizi upstream (DMS, JOBCARD, V360...), condiviso
// tra le Lambda che le usano (v360, dms, jobcard, djc — v. template.yaml
// risorsa ServiceUrlsSecret). Un solo posto da modificare (console/CLI AWS),
// senza dover cercare la costante duplicata in più Lambda e senza redeploy.
// I valori vengono cachati in memoria per tutta la durata del container
// Lambda (warm start).

const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const smClient = new SecretsManagerClient({});

// Cache del secret — persiste tra invocazioni nello stesso container Lambda (warm start)
let cachedServiceUrls = null;

/**
 * Recupera (con cache in memoria) il JSON del secret "service urls" da
 * AWS Secrets Manager, identificato dalla variabile d'ambiente
 * SERVICE_URLS_SECRET_ID (nome o ARN del secret).
 * @returns {Promise<object>} oggetto chiave/valore con tutte le URL/path
 * @throws {Error} se SERVICE_URLS_SECRET_ID non è configurata o il secret non è recuperabile
 */
async function loadServiceUrls() {
  if (cachedServiceUrls) {
    return cachedServiceUrls;
  }

  const secretId = process.env.SERVICE_URLS_SECRET_ID;
  if (!secretId) {
    throw new Error('[secretsLoader] Variabile d\'ambiente SERVICE_URLS_SECRET_ID non configurata');
  }

  console.log('[secretsLoader] Recupero service URLs da Secrets Manager');
  const response = await smClient.send(new GetSecretValueCommand({ SecretId: secretId }));
  if (!response.SecretString) {
    throw new Error('[secretsLoader] Il secret non contiene SecretString');
  }

  cachedServiceUrls = JSON.parse(response.SecretString);
  console.log('[secretsLoader] Service URLs caricate e salvate in cache');
  return cachedServiceUrls;
}

/**
 * Invalida la cache in memoria. Utile per i test unitari e per forzare un refresh.
 */
function invalidateCache() {
  cachedServiceUrls = null;
}

module.exports = { loadServiceUrls, invalidateCache };
