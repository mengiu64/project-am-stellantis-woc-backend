'use strict';

// Modulo per il caricamento dei segreti da AWS SSM Parameter Store e Secrets Manager.
// Pattern: variabile d'ambiente → SSM Parameter (contiene ARN del secret) → Secrets Manager (contiene le credenziali).
// I valori vengono cachati in memoria per tutta la durata del container Lambda (warm start).

const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

// Client AWS — inizializzati una sola volta e riutilizzati tra invocazioni
const ssmClient = new SSMClient({});
const smClient = new SecretsManagerClient({});

// Cache dei segreti — persiste tra invocazioni nello stesso container Lambda (warm start)
let cachedSecrets = null;

/**
 * Recupera un parametro da AWS SSM Parameter Store.
 * @param {string} paramName - Percorso del parametro SSM (es. /app/np-BSN0027990-dev/SRP_V360_OTA)
 * @returns {Promise<string>} Valore del parametro (in questo caso l'ARN del secret)
 * @throws {Error} Se il parametro non è recuperabile
 */
async function getSsmParameter(paramName) {
  // Log dell'operazione in corso
  console.log(`[secrets] Recupero parametro SSM: ${paramName}`);
  // Esegue la chiamata a SSM con decrittazione abilitata
  const command = new GetParameterCommand({ Name: paramName, WithDecryption: true });
  const response = await ssmClient.send(command);
  // Restituisce il valore del parametro (ARN del secret in Secrets Manager)
  return response.Parameter.Value;
}

/**
 * Recupera il valore di un secret da AWS Secrets Manager.
 * @param {string} secretArn - ARN del secret in Secrets Manager
 * @returns {Promise<object>} Oggetto JSON con le credenziali
 * @throws {Error} Se il secret non è recuperabile o non contiene SecretString
 */
async function getSecretValue(secretArn) {
  // Log dell'operazione (mostra solo parte dell'ARN per sicurezza)
  console.log(`[secrets] Recupero secret da Secrets Manager`);
  // Esegue la chiamata a Secrets Manager
  const command = new GetSecretValueCommand({ SecretId: secretArn });
  const response = await smClient.send(command);
  // Verifica che il secret contenga una stringa (non un binary)
  if (!response.SecretString) {
    throw new Error('[secrets] Il secret non contiene SecretString');
  }
  // Parsa il JSON e restituisce l'oggetto con le credenziali
  return JSON.parse(response.SecretString);
}

/**
 * Carica le credenziali dal percorso SSM → Secrets Manager.
 * Utilizza la cache in memoria per evitare chiamate ripetute durante il warm start.
 * @returns {Promise<object>} Oggetto con le 4 credenziali:
 *   { SRP_V360_OTA_PING_CLIENT_ID, SRP_V360_OTA_PING_CLIENT_SECRET,
 *     SRP_V360_OTA_IBM_CLIENT_ID, SRP_V360_OTA_IBM_CLIENT_SECRET }
 * @throws {Error} Se la variabile d'ambiente SRP_V360_OTA_SECRET_ARN_PARAM non è configurata
 * @throws {Error} Se il parametro SSM o il secret non sono recuperabili
 */
async function loadSecrets() {
  // Se i segreti sono già in cache, li restituisce senza chiamate AWS
  if (cachedSecrets) {
    console.log('[secrets] Credenziali recuperate dalla cache in memoria');
    return cachedSecrets;
  }

  // Legge il percorso del parametro SSM dalla variabile d'ambiente
  const ssmParamPath = process.env.SRP_V360_OTA_SECRET_ARN_PARAM;
  // Verifica che la variabile d'ambiente sia presente
  if (!ssmParamPath) {
    throw new Error('[secrets] Variabile d\'ambiente SRP_V360_OTA_SECRET_ARN_PARAM non configurata');
  }

  // Passo 1: recupera l'ARN del secret dal parametro SSM
  const secretArn = await getSsmParameter(ssmParamPath);
  console.log(`[secrets] ARN del secret recuperato da SSM`);

  // Passo 2: recupera le credenziali dal secret in Secrets Manager
  const secrets = await getSecretValue(secretArn);

  // Validazione: verifica che tutte le chiavi attese siano presenti nel secret
  const requiredKeys = [
    'SRP_V360_OTA_PING_CLIENT_ID',
    'SRP_V360_OTA_PING_CLIENT_SECRET',
    'SRP_V360_OTA_IBM_CLIENT_ID',
    'SRP_V360_OTA_IBM_CLIENT_SECRET',
  ];
  // Filtra le chiavi mancanti
  const missingKeys = requiredKeys.filter((k) => !secrets[k]);
  // Se mancano delle chiavi, lancia un errore descrittivo
  if (missingKeys.length > 0) {
    throw new Error(
      `[secrets] Chiavi mancanti nel secret: ${missingKeys.join(', ')}`
    );
  }

  // Salva in cache per le invocazioni successive (warm start)
  cachedSecrets = secrets;
  console.log('[secrets] Credenziali caricate e salvate in cache');

  // Restituisce l'oggetto con le credenziali
  return secrets;
}

/**
 * Invalida la cache dei segreti.
 * Utile per i test unitari e per forzare un refresh delle credenziali.
 */
function invalidateCache() {
  cachedSecrets = null;
}

// Esporta le funzioni per utilizzo nel modulo config e nei test
module.exports = { loadSecrets, invalidateCache };
