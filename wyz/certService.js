'use strict';

// certService.js — https.Agent mTLS (certificato client + chiave) per StockPrixService.
// In Lambda cert e key arrivano dagli STESSI secret usati da agendaSoa (getAvHoursForRec/cCSList),
// letti tramite la AWS Parameters and Secrets Lambda Extension (localhost:2773).
// In locale (CLI) si possono indicare i file PEM con WYZ_CERT_FILE / WYZ_KEY_FILE.

// Modulo filesystem: lettura dei file PEM in esecuzione locale.
const fs = require('fs');
// Modulo HTTP core: chiamata alla Secrets Extension in ascolto su localhost.
const http = require('http');
// Modulo HTTPS core: costruzione dell'https.Agent con certificato client.
const https = require('https');

// Porta di default della Secrets Extension, usata se il secret wyz non la specifica.
const DEFAULT_EXTENSION_PORT = 2773;
// Timeout (ms) della chiamata alla Extension locale: evita blocchi fino al timeout Lambda.
const EXTENSION_TIMEOUT_MS = 5000;

// Cache in memoria della promise dell'agent: riusata nelle invocazioni warm.
let cachedAgentPromise = null;

/**
 * Log strutturato JSON del certService. Non registra MAI certificato, chiave o valori dei secret.
 * @param {string} logType - tipo evento (cert_fetch, cert_error, cert_agent_built, ...)
 * @param {object} [fields] - campi aggiuntivi non sensibili
 */
function log(logType, fields = {}) {
  // Oggetto piatto serializzato: interrogabile con CloudWatch Logs Insights.
  console.log(JSON.stringify({ service: 'wyz', component: 'certService', logType, ...fields }));
}

/**
 * Normalizza il valore di un secret in PEM: accetta PEM puro oppure un oggetto "JSON-like"
 * (es. {"apiCert": "-----BEGIN CERTIFICATE-----..."}) da cui estrae il primo blocco PEM.
 * @param {string} value - SecretString grezzo
 * @returns {string} PEM normalizzato o valore originale
 */
function extractPem(value) {
  // Valori non stringa: restituiti invariati (l'errore emergerà alla costruzione dell'agent).
  if (typeof value !== 'string') return value;
  // Rimozione di spazi/newline ai bordi.
  const trimmed = value.trim();
  // PEM puro: restituito direttamente.
  if (trimmed.startsWith('-----BEGIN')) return trimmed;
  // Ricerca di un blocco PEM completo incapsulato nel valore (forma JSON-like).
  const match = value.match(/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/);
  // Le newline salvate come sequenza "\n" letterale vengono riconvertite in newline reali.
  return match ? match[0].replace(/\\n/g, '\n') : value;
}

/**
 * Recupera un secret tramite la AWS Parameters and Secrets Lambda Extension.
 * @param {string} secretId - nome/ARN del secret
 * @param {number} [extensionPort] - porta della Extension (dal secret wyz)
 * @returns {Promise<string>} PEM normalizzato
 */
function fetchSecret(secretId, extensionPort) {
  // Porta della Extension, con default 2773.
  const port = Number(extensionPort) || DEFAULT_EXTENSION_PORT;
  // Promise per comporre i due recuperi (cert e key) in parallelo.
  return new Promise((resolve, reject) => {
    // Log dell'avvio del recupero: solo l'identificativo del secret, mai il valore.
    log('cert_fetch', { secretId });
    // GET verso l'endpoint locale della Extension.
    const req = http.get(
      {
        // La Extension è raggiungibile solo da localhost dentro l'ambiente Lambda.
        hostname: 'localhost',
        // Porta della Extension.
        port,
        // Endpoint di lettura secret con id url-encoded.
        path: `/secretsmanager/get?secretId=${encodeURIComponent(secretId)}`,
        // Timeout di socket della chiamata locale.
        timeout: EXTENSION_TIMEOUT_MS,
        // Token di sessione richiesto dalla Extension per autorizzare la lettura.
        headers: { 'X-Aws-Parameters-Secrets-Token': process.env.AWS_SESSION_TOKEN },
      },
      (res) => {
        // Buffer della risposta.
        let data = '';
        // Accumulo dei chunk ricevuti.
        res.on('data', (chunk) => { data += chunk; });
        // Fine risposta: verifica dello status e parsing.
        res.on('end', () => {
          // Status diverso da 200: errore senza includere il corpo (potrebbe contenere dati sensibili).
          if (res.statusCode !== 200) {
            // Log dell'errore con il solo status HTTP.
            log('cert_error', { secretId, statusCode: res.statusCode });
            // Rifiuto con messaggio non sensibile.
            reject(new Error(`[certService] Recupero secret "${secretId}" fallito: HTTP ${res.statusCode}`));
            return;
          }
          try {
            // La Extension risponde con JSON { SecretString, ... }.
            const parsed = JSON.parse(data);
            // Secret senza SecretString (es. binario): non utilizzabile come PEM.
            if (typeof parsed.SecretString !== 'string' || parsed.SecretString.trim() === '') {
              // Rilancio per confluire nel ramo d'errore comune.
              throw new Error('SecretString assente');
            }
            // Normalizzazione in PEM e risoluzione.
            resolve(extractPem(parsed.SecretString));
          } catch (err) {
            // Risposta non interpretabile: log senza valore del secret.
            log('cert_error', { secretId, reason: 'unparsable_response' });
            // Rifiuto con messaggio non sensibile.
            reject(new Error(`[certService] Risposta non valida per il secret "${secretId}"`));
          }
        });
      }
    );
    // Timeout della chiamata alla Extension: la richiesta viene annullata con errore esplicito.
    req.on('timeout', () => req.destroy(new Error(`[certService] Timeout Extension dopo ${EXTENSION_TIMEOUT_MS}ms`)));
    // Errore di trasporto verso la Extension (layer assente, porta errata, timeout).
    req.on('error', (err) => {
      // Log del solo messaggio di errore.
      log('cert_error', { secretId, reason: 'transport_error', error: err.message });
      // Propagazione dell'errore al chiamante.
      reject(err);
    });
  });
}

/**
 * Carica cert e key: da file locali (solo CLI/sviluppo) oppure da Secrets Manager via Extension.
 * @param {number} [extensionPort] - porta della Extension
 * @returns {Promise<{cert: string, key: string, source: string}>}
 * @throws {Error} se la configurazione non permette di recuperarli
 */
async function loadPemMaterial(extensionPort) {
  // Percorsi dei file PEM locali (valorizzati solo in sviluppo tramite .env).
  const certFile = process.env.WYZ_CERT_FILE;
  // Percorso della chiave privata locale.
  const keyFile = process.env.WYZ_KEY_FILE;
  // Modalità locale: entrambi i file sono indicati.
  if (certFile && keyFile) {
    // Log della sorgente locale (i percorsi non sono dati sensibili).
    log('cert_fetch', { source: 'file', certFile, keyFile });
    // Lettura sincrona: eseguita una sola volta grazie alla cache dell'agent.
    return {
      // Certificato client normalizzato in PEM.
      cert: extractPem(fs.readFileSync(certFile, 'utf8')),
      // Chiave privata normalizzata in PEM.
      key: extractPem(fs.readFileSync(keyFile, 'utf8')),
      // Sorgente usata (solo per il log).
      source: 'file',
    };
  }

  // Id del secret del certificato (da template.yaml).
  const certSecretId = process.env.WYZ_CERT_SECRET_ID;
  // Id del secret della chiave privata (da template.yaml).
  const keySecretId = process.env.WYZ_KEY_SECRET_ID;
  // Configurazione mancante: errore esplicito invece di ripiegare su secret di altri ambienti.
  if (!certSecretId || !keySecretId) {
    // Rilancio con l'elenco delle variabili da configurare.
    throw new Error('[certService] Configurare WYZ_CERT_SECRET_ID e WYZ_KEY_SECRET_ID (oppure WYZ_CERT_FILE e WYZ_KEY_FILE in locale)');
  }
  // Recupero parallelo di certificato e chiave per ridurre la latenza.
  const [cert, key] = await Promise.all([fetchSecret(certSecretId, extensionPort), fetchSecret(keySecretId, extensionPort)]);
  // Restituzione del materiale con la sorgente.
  return { cert, key, source: 'secretsmanager' };
}

/**
 * Costruisce l'https.Agent mTLS.
 * @param {number} [extensionPort] - porta della Extension
 * @returns {Promise<https.Agent>}
 */
async function buildAgent(extensionPort) {
  // Recupero di certificato e chiave.
  const { cert, key, source } = await loadPemMaterial(extensionPort);
  // Verifica minima del formato: evita errori TLS poco leggibili più a valle.
  if (!String(cert).includes('-----BEGIN') || !String(key).includes('-----BEGIN')) {
    // Log senza contenuto del materiale crittografico.
    log('cert_error', { source, reason: 'invalid_pem' });
    // Errore esplicito di configurazione.
    throw new Error('[certService] Certificato o chiave non in formato PEM');
  }
  // Agent con certificato client; keepAlive riusa la connessione TLS tra invocazioni warm.
  const agent = new https.Agent({ cert, key, keepAlive: true });
  // Log di avvenuta costruzione (nessun dato sensibile).
  log('cert_agent_built', { source });
  // Restituzione dell'agent.
  return agent;
}

/**
 * Restituisce l'https.Agent mTLS con cache in memoria; in caso di errore la cache viene azzerata.
 * @param {{extensionPort?: number}} [options] - porta della Extension (dal secret wyz)
 * @returns {Promise<https.Agent>}
 */
function getHttpsAgent({ extensionPort } = {}) {
  // Cold start o cache invalidata: avvio della costruzione.
  if (!cachedAgentPromise) {
    // Promise cache-ata; su errore la cache viene azzerata per permettere un nuovo tentativo.
    cachedAgentPromise = buildAgent(extensionPort).catch((err) => {
      // Invalidazione della cache.
      cachedAgentPromise = null;
      // Propagazione dell'errore.
      throw err;
    });
  } else {
    // Warm start: nessuna chiamata alla Extension.
    log('cert_cache_hit');
  }
  // Promise dell'agent (nuova o cache-ata).
  return cachedAgentPromise;
}

/** Invalida l'agent in cache (es. dopo un errore di handshake TLS, per rileggere cert/key ruotati). */
function invalidateAgent() {
  // Azzeramento della cache.
  cachedAgentPromise = null;
}

// API pubblica del modulo.
module.exports = { getHttpsAgent, invalidateAgent, fetchSecret, extractPem };
