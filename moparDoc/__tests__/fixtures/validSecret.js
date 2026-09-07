'use strict';

/**
 * Fixture condivisa del Secret a sei chiavi (Req 5.1).
 * Riutilizzata dai test di secretsLoader, config e moparDocService per garantire
 * coerenza sul contenuto del secret dopo l'aggiunta dei due codici di accesso.
 *
 * Le sei chiavi corrispondono esattamente a quelle validate da secretsLoader.loadSecrets()
 * e mappate da config.buildConfig().
 */
const VALID_SECRET = {
  MOPARDOC_IBM_CLIENT_ID: 'ibm-id',
  MOPARDOC_IBM_CLIENT_SECRET: 'ibm-secret',
  MOPARDOC_PING_CLIENT_ID: 'ping-id',
  MOPARDOC_PING_CLIENT_SECRET: 'ping-secret',
  MOPARDOC_API_ACCESS_CODE: 'api-code-secret', // Nuovo: codice di accesso API usato da createAccessToken
  MOPARDOC_TAM_ACCESS_CODE: 'tam-code-secret', // Nuovo: codice di accesso TAM usato da createJobCard
};

// Esporta la fixture condivisa per i test dei tre moduli
module.exports = { VALID_SECRET };
