'use strict';

// Carica le variabili d'ambiente dal file .env locale (host, credenziali, proxy, ecc.).
require('dotenv').config();
// Client HTTP dedicato al servizio AgendaSOA-Naga (contratto/firme pubbliche invariate).
const AgendaNagaClient = require('./agendaNagaClient');
// Recupero (con cache warm-start) dell'https.Agent mTLS costruito dai segreti Secrets Manager.
const { getHttpsAgent } = require('./certService');

/**
 * Costruisce un AgendaNagaClient configurato a partire dalle variabili d'ambiente.
 * Ogni campo può essere sovrascritto passando valori espliciti in `overrides`.
 * Carica (e mette in cache) l'https.Agent mTLS da Secrets Manager, a meno che
 * un `httpsAgent` non venga fornito esplicitamente via `overrides` (utile nei test).
 *
 * @param {object} [overrides] - override opzionali dei campi di configurazione.
 * @returns {Promise<AgendaNagaClient>} il client configurato.
 */
async function buildClient(overrides = {}) {
  // Separa l'eventuale override di httpsAgent dagli altri override di configurazione.
  const { httpsAgent: httpsAgentOverride, ...restOverrides } = overrides;
  // Usa l'httpsAgent fornito (test) se presente, altrimenti lo carica da Secrets Manager.
  const httpsAgent = httpsAgentOverride !== undefined
    ? httpsAgentOverride
    : await getHttpsAgent();

  // Istanzia il client con la configurazione da env, l'agent mTLS e gli override rimanenti.
  return new AgendaNagaClient({
    host:     process.env.AGENDA_SOA_HOST,
    username: process.env.AGENDA_SOA_USERNAME,
    password: process.env.AGENDA_SOA_PASSWORD,
    apiKey:   process.env.AGENDA_SOA_API_KEY,
    proxy:    process.env.AGENDA_SOA_PROXY,
    httpsAgent,
    ...restOverrides,
  });
}

// Firma pubblica invariata: esporta unicamente buildClient.
module.exports = { buildClient };
