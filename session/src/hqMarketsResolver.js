'use strict';

const path = require('path');

// Cross-lambda-folder require, stesso pattern lazy gia' usato da
// repositories/myPeopleDmsSessionRepository.js (dbManager/ e' una cartella
// sorella impacchettata dal Makefile per SessionFunction, v. Metadata:
// BuildMethod: makefile in template.yaml): caricato on-demand cosi' i test
// unitari (che iniettano `fetchMarketsFn`, v. sotto) non toccano mai
// dbManager/db.js (niente Pool/Secrets Manager reali).
let _fetchMarkets;
function loadFetchMarkets() {
  if (!_fetchMarkets) {
    const { getPool } = require(path.resolve(__dirname, '../../dbManager/db'));
    const { getMarkets } = require(path.resolve(__dirname, '../../dbManager/AnagSnowflakesRepository'));
    _fetchMarkets = async (params) => {
      const pool = await getPool();
      return getMarkets(pool, params);
    };
  }
  return _fetchMarkets;
}

// Estrae il codice mercato (4 cifre) dal ruolo HQ mercato, es.
// "ZWRT.WOC.NONPROD.HQNSC3109" -> "3109" (stesso pattern di
// src/index.js::HQ_MARKET_ROLE_PATTERN, qui con capture group sul codice).
const HQ_MARKET_CODE_PATTERN = /HQNSC(\d{4})/i;

/**
 * Risolve `hqMarketsList`: l'elenco dei mercati disponibili per un utente HQ,
 * `{ market, description }` (cd_market_code/gn_country_name di
 * woc.ang_snowflakes, v. dbManager/AnagSnowflakesRepository.js::getMarkets),
 * da inserire nella risposta di sessione (v. src/index.js::insertAfterProfile).
 *
 *  - dealer (hqCentral=0 e hqMarket=0): nessun dato disponibile, sempre `[]`
 *    (nessuna query eseguita).
 *  - HQ centrale (hqCentral=1): TUTTI i mercati distinti presenti in
 *    woc.ang_snowflakes (nessun filtro).
 *  - HQ mercato (hqMarket=1): il SOLO mercato ricavato dal ruolo
 *    HQNSC<codice> (es. "ZWRT.WOC.NONPROD.HQNSC3109" -> mercato "3109"), con
 *    la descrizione (gn_country_name) letta dalla stessa tabella, es.
 *    `[{ market: "3109", description: "France" }]`; `[]` se nessun ruolo
 *    valorizza il codice mercato.
 *
 * Fault-tolerant come le altre letture DB di sessione (getBrandLogos,
 * getDisabledOics, getAddressByOics, ...): un errore nella query NON blocca
 * mai la sessione, viene semplicemente loggato e si ritorna `[]`.
 *
 * @param {{ hqCentral: 0|1, hqMarket: 0|1, roles: string[] }} flags
 * @param {(params?: { markets?: string[] }) => Promise<Array<{ market: string, description: string|null }>>} [fetchMarketsFn]
 *        iniettabile nei test (default: query reale su woc.ang_snowflakes)
 * @returns {Promise<Array<{ market: string, description: string|null }>>}
 */
async function resolveHqMarketsList({ hqCentral, hqMarket, roles } = {}, fetchMarketsFn) {
  if (!hqCentral && !hqMarket) return [];

  const fetchMarkets = fetchMarketsFn || loadFetchMarkets();

  try {
    if (hqCentral) {
      return await fetchMarkets();
    }

    const roleWithMarket = (Array.isArray(roles) ? roles : [])
      .find((role) => typeof role === 'string' && HQ_MARKET_CODE_PATTERN.test(role));
    const match = roleWithMarket && roleWithMarket.match(HQ_MARKET_CODE_PATTERN);
    const market = match ? match[1] : null;
    if (!market) return [];

    return await fetchMarkets({ markets: [market] });
  } catch (err) {
    console.error(`[session] lettura hqMarketsList (woc.ang_snowflakes) fallita: ${err.message}`);
    return [];
  }
}

module.exports = { resolveHqMarketsList };
