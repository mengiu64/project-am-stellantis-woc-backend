'use strict';

// Carica le variabili d'ambiente dal file .env locale (host, credenziali, proxy, id segreti).
require('dotenv').config();
// Client axios verso il servizio AgendaSOA (contratto e firme pubbliche invariati).
const AgendaSOAClient = require('./agendaSOAClient');
// Sorgente dell'https.Agent per l'mTLS: ora da Secrets Manager (via Extension), non più da S3.
const { getHttpsAgent } = require('./certService');

/**
 * Builds a configured AgendaSOAClient from environment variables.
 * Override any field by passing explicit config values.
 * Loads (and caches) the mTLS httpsAgent from Secrets Manager unless one is passed via `overrides`.
 */
async function buildClient(overrides = {}) {
  // Separa l'eventuale httpsAgent iniettato (usato dai test) dagli altri override di configurazione.
  const { httpsAgent: httpsAgentOverride, ...restOverrides } = overrides;
  // Se un agent è fornito esplicitamente lo si usa (override di test); altrimenti lo si
  // ottiene, cache-ato, da certService — ora da Secrets Manager anziché da S3. (Req 1.7)
  const httpsAgent = httpsAgentOverride !== undefined
    ? httpsAgentOverride
    : await getHttpsAgent();

  // Costruisce il client leggendo la configurazione dall'ambiente e iniettando l'https.Agent mTLS.
  return new AgendaSOAClient({
    // Host del servizio downstream AgendaSOA.
    host:     process.env.AGENDA_SOA_HOST,
    // Username per l'autenticazione applicativa verso il downstream.
    username: process.env.AGENDA_SOA_USERNAME,
    // Password per l'autenticazione applicativa verso il downstream.
    password: process.env.AGENDA_SOA_PASSWORD,
    // API key applicativa richiesta dal servizio downstream.
    apiKey:   process.env.AGENDA_SOA_API_KEY,
    // Proxy HTTP opzionale per l'ambiente in cui gira la Lambda.
    proxy:    process.env.AGENDA_SOA_PROXY,
    // Agent mTLS (cert+key) usato per la connessione TLS mutua verso il downstream.
    httpsAgent,
    // Eventuali ulteriori override di configurazione passati dal chiamante/test.
    ...restOverrides,
  });
}

// Firma pubblica invariata: espone unicamente buildClient.
module.exports = { buildClient };
