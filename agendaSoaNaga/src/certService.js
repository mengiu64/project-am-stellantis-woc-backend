'use strict';

// Modulo HTTP core per contattare la AWS Parameters and Secrets Lambda Extension in locale.
const http = require('http');
// Modulo HTTPS core per costruire l'https.Agent con il materiale mTLS (cert + key).
const https = require('https');

// Servizio usato nei log strutturati di questo modulo (specularmente ad agendaSoa, qui "agendaSoaNaga").
const SERVICE = 'agendaSoaNaga';

// Identificatore del segreto contenente il certificato client mTLS (PEM); default "apicCert" (Req 1.3).
const CERT_SECRET_ID = process.env.AGENDA_SOA_CERT_SECRET_ID || 'apicCert';
// Identificatore del segreto contenente la chiave privata mTLS (PEM); default "apicKey" (Req 1.3).
const KEY_SECRET_ID = process.env.AGENDA_SOA_KEY_SECRET_ID || 'apicKey';
// Porta HTTP locale esposta dalla Secrets Extension; default 2773 (Req 1.4).
const EXTENSION_PORT = Number(process.env.PARAMETERS_SECRETS_EXTENSION_HTTP_PORT) || 2773;

// Cache in-process della promise dell'https.Agent (sopravvive tra invocazioni "warm"
// della stessa istanza Lambda), per evitare di richiedere i segreti ad ogni invocazione (Req 2).
let cachedAgentPromise = null;

/**
 * Recupera un segreto da AWS Secrets Manager tramite la AWS Parameters and Secrets
 * Lambda Extension (layer), che espone una cache locale su http://localhost:<port>.
 * https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html
 *
 * @param {string} secretId - nome/ARN del segreto (es. "apicCert")
 * @returns {Promise<string>} il valore SecretString del segreto, normalizzato a PEM
 */
function fetchSecret(secretId) {
  // Restituisce una Promise perché http.get è basato su callback/eventi.
  return new Promise((resolve, reject) => {
    // Opzioni della richiesta HTTP verso la Extension locale.
    const options = {
      // La Extension ascolta sempre su localhost.
      hostname: 'localhost',
      // Porta configurabile via env (default 2773).
      port: EXTENSION_PORT,
      // Endpoint della Extension per il recupero di un segreto; il secretId è URL-encoded.
      path: `/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
      // Header di autenticazione richiesto dalla Extension (veicola AWS_SESSION_TOKEN).
      headers: {
        'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN,
      },
    };

    // Effettua la GET verso la Extension.
    http.get(options, (res) => {
      // Accumula il corpo della risposta in una stringa.
      let data = '';
      // Concatena ogni chunk ricevuto.
      res.on('data', (chunk) => { data += chunk; });
      // Alla fine della risposta valuta status e corpo.
      res.on('end', () => {
        // Se lo status non è 200, rigetta con un errore che identifica il segreto SENZA il suo valore (Req 6.1).
        if (res.statusCode !== 200) {
          // Log strutturato dell'errore: nessun valore di segreto viene incluso, solo l'identificativo.
          console.error(JSON.stringify({ service: SERVICE, logType: 'secret_fetch_error', secretId, statusCode: res.statusCode }));
          // Rigetta con messaggio contenente il secretId e lo status, ma non il valore del segreto.
          reject(new Error(`[certService] secret "${secretId}" fetch failed: HTTP ${res.statusCode}`));
          return;
        }
        try {
          // Prova a interpretare il corpo come JSON (la Extension risponde con { SecretString, ... }).
          const parsed = JSON.parse(data);
          // Normalizza il SecretString a PEM e risolve.
          resolve(extractPem(parsed.SecretString));
        } catch (err) {
          // Se il corpo non è JSON parsabile, rigetta identificando il segreto SENZA il suo valore (Req 6.2).
          console.error(JSON.stringify({ service: SERVICE, logType: 'secret_parse_error', secretId }));
          // Il messaggio include solo l'identificativo del segreto e la causa di parsing, mai il valore.
          reject(new Error(`[certService] invalid response retrieving secret "${secretId}": ${err.message}`));
        }
      });
    }).on('error', reject); // Propaga eventuali errori di rete/connessione.
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
 * @param {string} value
 * @returns {string}
 */
function extractPem(value) {
  // Se il valore non è una stringa, lo restituisce invariato (passthrough) (Req 1.5).
  if (typeof value !== 'string') return value;

  // Rimuove spazi/newline iniziali e finali per il controllo del prefisso.
  const trimmed = value.trim();
  // Se il valore (trimmato) è già un PEM puro, lo restituisce così com'è.
  if (trimmed.startsWith('-----BEGIN')) return trimmed;

  // Altrimenti cerca un blocco PEM completo incapsulato in contenuto aggiuntivo (es. JSON-like).
  const match = value.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  // Ritorna il blocco PEM estratto se trovato, altrimenti il valore originale invariato.
  return match ? match[0] : value;
}

/**
 * Scarica il certificato client (PEM) e la chiave privata (PEM) da Secrets Manager
 * (segreti "apicCert"/"apicKey", configurabili via env) e costruisce un https.Agent
 * da usare per l'autenticazione mTLS verso il servizio AgendaSOA-Naga.
 *
 * La promise dell'agent è cache-ata in-process (warm start): sulle invocazioni "warm"
 * la Extension non viene ricontattata. In caso di errore la cache viene invalidata,
 * così la successiva invocazione ritenta il recupero (Req 2).
 *
 * @returns {Promise<https.Agent>}
 */
function getHttpsAgent() {
  // Se la cache è vuota (cold start o precedente fallimento) inizializza la promise.
  if (!cachedAgentPromise) {
    // Avvia il caricamento e collega un catch che invalida la cache in caso di errore.
    cachedAgentPromise = loadHttpsAgent().catch((err) => {
      // Azzera la cache per consentire un nuovo tentativo alla prossima chiamata (Req 2.3).
      cachedAgentPromise = null;
      // Ri-solleva l'errore così che il chiamante possa gestirlo.
      throw err;
    });
  }
  // Ritorna sempre la promise cache-ata (warm start = nessuna nuova chiamata Extension).
  return cachedAgentPromise;
}

/**
 * Recupera in parallelo cert e key dalla Extension e costruisce l'https.Agent mTLS.
 * @returns {Promise<https.Agent>}
 */
async function loadHttpsAgent() {
  // Recupera contemporaneamente certificato e chiave per ridurre la latenza di init.
  const [cert, key] = await Promise.all([
    fetchSecret(CERT_SECRET_ID),
    fetchSecret(KEY_SECRET_ID),
  ]);

  // Costruisce l'agent HTTPS con il materiale mTLS normalizzato.
  return new https.Agent({ cert, key });
}

/** Resetta la cache (solo per i test). */
function _resetCache() {
  // Azzera la promise cache-ata così i test partono da uno stato pulito.
  cachedAgentPromise = null;
}

// Firma pubblica invariata rispetto agli altri moduli (getHttpsAgent, fetchSecret, extractPem, _resetCache).
module.exports = { getHttpsAgent, fetchSecret, extractPem, _resetCache };
