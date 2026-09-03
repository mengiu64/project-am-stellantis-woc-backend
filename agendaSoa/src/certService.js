'use strict';

// Modulo HTTP core per contattare la Secrets Extension in locale (nessuna dipendenza esterna).
const http = require('http');
// Modulo HTTPS core per costruire l'https.Agent usato nell'autenticazione mTLS.
const https = require('https');

// Nome del servizio usato nei log strutturati di questo modulo.
const SERVICE = 'agendaSoa';

// Identificatore del segreto che contiene il certificato client mTLS (default: apicCert). (Req 1.3)
const CERT_SECRET_ID = process.env.AGENDA_SOA_CERT_SECRET_ID || 'apicCert';
// Identificatore del segreto che contiene la chiave privata mTLS (default: apicKey). (Req 1.3)
const KEY_SECRET_ID = process.env.AGENDA_SOA_KEY_SECRET_ID || 'apicKey';
// Porta locale su cui la Secrets Extension espone la sua cache HTTP (default: 2773). (Req 1.4)
const EXTENSION_PORT = Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773;

// Cache in-process della promise dell'https.Agent: sopravvive tra invocazioni "warm"
// della stessa istanza Lambda, evitando di ricontattare la Extension ad ogni chiamata. (Req 2.1)
let cachedAgentPromise = null;

/**
 * Emette un log strutturato JSON per la diagnostica del certService.
 * Non registra MAI il valore in chiaro dei segreti, del certificato o della chiave. (Req 5.1, 5.3)
 *
 * @param {string} logType - tipo di evento (es. "cert_fetch", "cert_error").
 * @param {object} [fields] - campi aggiuntivi non sensibili da includere nel log.
 */
function log(logType, fields = {}) {
  // Serializza un oggetto piatto con service e logType, così i log restano interrogabili.
  console.log(JSON.stringify({ service: SERVICE, logType, ...fields }));
}

/**
 * Recupera un segreto da AWS Secrets Manager tramite la AWS Parameters and Secrets
 * Lambda Extension (layer), che espone una cache locale su http://localhost:<port>.
 * https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 *
 * @param {string} secretId - nome/ARN del segreto (es. "apicCert").
 * @returns {Promise<string>} il valore SecretString del segreto, normalizzato in PEM.
 */
function fetchSecret(secretId) {
  // Ritorna una Promise così da comporre facilmente i due recuperi con Promise.all.
  return new Promise((resolve, reject) => {
    // Opzioni della richiesta HTTP verso la Extension locale (Req 1.1).
    const options = {
      // La Extension è sempre in ascolto su localhost, all'interno dell'ambiente Lambda.
      hostname: 'localhost',
      // Porta configurabile via env, con default 2773 (Req 1.4).
      port: EXTENSION_PORT,
      // Percorso dell'endpoint di lettura segreti; il secretId è url-encoded per sicurezza.
      path: `/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      headers: {
        // Token di sessione richiesto dalla Extension per autorizzare la lettura (Req 1.2).
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN,
      },
    };

    // Traccia l'avvio del recupero riferendo il segreto solo per identificativo (mai il valore). (Req 5.3)
    log('cert_fetch', { secretId });

    // Effettua la GET verso la Extension e accumula il corpo della risposta.
    http.get(options, (res) => {
      // Buffer testuale in cui concateniamo i chunk della risposta.
      let data = '';
      // Ogni chunk ricevuto viene aggiunto al buffer.
      res.on('data', (chunk) => { data += chunk; });
      // Alla fine della risposta valutiamo status e corpo.
      res.on('end', () => {
        // Status diverso da 200: errore che identifica il segreto SENZA includerne il valore (Req 6.1, 5.3).
        if (res.statusCode !== 200) {
          // Log dell'errore con il solo status HTTP e l'identificativo del segreto.
          log('cert_error', { secretId, statusCode: res.statusCode });
          // Non includiamo mai il corpo/valore del segreto nel messaggio d'errore.
          reject(new Error(`[certService] secret "${secretId}" fetch failed: HTTP ${res.statusCode}`));
          return;
        }
        try {
          // La Extension risponde con un JSON contenente SecretString.
          const parsed = JSON.parse(data);
          // Normalizza il valore in PEM prima dell'uso a valle (Req 1.5).
          resolve(extractPem(parsed.SecretString));
        } catch (err) {
          // Risposta non interpretabile: errore che identifica il segreto SENZA valore (Req 6.2, 5.3).
          log('cert_error', { secretId, reason: 'unparsable_response' });
          reject(new Error(`[certService] invalid response retrieving secret "${secretId}"`));
        }
      });
    }).on('error', (err) => {
      // Errore di trasporto verso la Extension: logghiamo solo il messaggio, senza il valore del segreto.
      log('cert_error', { secretId, reason: 'transport_error' });
      reject(err);
    });
  });
}

/**
 * Alcuni segreti sono stati salvati su Secrets Manager come oggetto "JSON-like"
 * (es. {"apicCert": "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----"},
 * spesso con newline reali non escapate dentro le virgolette, quindi non è detto sia
 * JSON valido) invece che come PEM puro in "Plaintext". Questa funzione normalizza
 * entrambi i casi: se il valore è già un PEM (inizia con "-----BEGIN") lo restituisce
 * trimmato, altrimenti cerca ovunque nella stringa un blocco "-----BEGIN ... -----END
 * ...-----" e lo estrae; se non trova nulla restituisce il valore originale invariato.
 *
 * @param {string} value - valore grezzo del segreto (SecretString).
 * @returns {string} il PEM normalizzato oppure il valore originale.
 */
function extractPem(value) {
  // Passthrough: se il valore non è una stringa lo restituiamo invariato (Req 1.5).
  if (typeof value !== 'string') return value;

  // Rimuove spazi/newline ai bordi per valutare l'inizio del contenuto.
  const trimmed = value.trim();
  // Se è già un PEM puro (inizia con "-----BEGIN") ritorniamo direttamente la versione trimmata.
  if (trimmed.startsWith('-----BEGIN')) return trimmed;

  // Altrimenti cerchiamo un blocco PEM completo incapsulato dentro il valore (forma JSON-like). (Req 6.3)
  const match = value.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  // Se troviamo il blocco lo estraiamo, altrimenti restituiamo il valore originale invariato.
  return match ? match[0] : value;
}

/**
 * Restituisce l'https.Agent per l'mTLS verso il servizio AgendaSOA, usando una cache
 * in-process per servire le invocazioni warm senza ricontattare la Extension. (Req 2.1, 2.2)
 * In caso di errore invalida la cache per consentire un nuovo tentativo. (Req 2.3)
 *
 * Nota compatibilità: la firma resta senza argomenti; il valore di ritorno è ora
 * sempre un https.Agent (mTLS obbligatorio), non più undefined.
 *
 * @returns {Promise<https.Agent>}
 */
function getHttpsAgent() {
  // Se non c'è una promise in cache la creiamo (cold start o dopo invalidazione).
  if (!cachedAgentPromise) {
    // Avvia il caricamento e aggancia un catch che azzera la cache su errore (Req 2.3).
    cachedAgentPromise = loadHttpsAgent().catch((err) => {
      // Invalida la cache così che la prossima invocazione ritenti il recupero.
      cachedAgentPromise = null;
      // Ri-solleva l'errore per propagarlo al chiamante.
      throw err;
    });
  }
  // Warm start: ritorna la promise cache-ata senza contattare la Extension (Req 2.2).
  return cachedAgentPromise;
}

/**
 * Recupera in parallelo cert e key da Secrets Manager e costruisce l'https.Agent mTLS. (Req 1.6)
 *
 * @returns {Promise<https.Agent>}
 */
async function loadHttpsAgent() {
  // Recupero parallelo del certificato e della chiave privata per ridurre la latenza (Req 1.6).
  const [cert, key] = await Promise.all([
    fetchSecret(CERT_SECRET_ID),
    fetchSecret(KEY_SECRET_ID),
  ]);

  // Log di avvenuta costruzione dell'agent, senza alcun riferimento al valore dei segreti (Req 5.3).
  log('cert_agent_built', { certSecretId: CERT_SECRET_ID, keySecretId: KEY_SECRET_ID });

  // Costruisce l'https.Agent con cert e key normalizzati (PEM non valido → errore sollevato qui/a valle). (Req 1.6, 6.3)
  return new https.Agent({ cert, key });
}

/** Resetta la cache (solo per i test). */
function _resetCache() {
  // Azzera la promise cache-ata così che il prossimo getHttpsAgent riparta da zero.
  cachedAgentPromise = null;
}

// Firma pubblica invariata: espone getHttpsAgent, fetchSecret, extractPem, _resetCache.
module.exports = { getHttpsAgent, fetchSecret, extractPem, _resetCache };
