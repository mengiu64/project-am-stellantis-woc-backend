'use strict';

// Trasporto REST condiviso caricato on-demand; fetchDealerSignFn resta iniettabile.
let _fetchDealerSign;
function loadFetchDealerSign() {
  if (!_fetchDealerSign) {
    _fetchDealerSign = async (...args) => {
      const { callService } = require('../../serviceClient');
      return callService('dbmanager', 'getDealerSign', { args });
    };
  }
  return _fetchDealerSign;
}

/**
 * Risolve `receptionistFEA`: la firma dell'accettatore (l'utente dealer autenticato) come data URL
 * (es. "data:image/png;base64,iVBORw0KGgo..."),
 * letta da woc.dealer_sign con la stessa query di getFirmaAccettatore della lambda CWS (v.
 * dbManager/DealerSignRepository.js::getDealerSign), da inserire nella risposta di sessione
 * (v. src/index.js::insertAfterProfile).
 *
 *  - dealer (dealer=1): firma dello `username` (authorizer.sub, stessa chiave
 *    dealer_login_userid usata dalla CWS); `null` se l'utente non ha ancora salvato una firma.
 *  - HQ (dealer=0): sempre `null` (nessuna query eseguita).
 *
 * Fault-tolerant come le altre letture DB di sessione (getBrandLogos, getMarkets, ...): un
 * errore nella query NON blocca mai la sessione, viene loggato e si ritorna `null`.
 *
 * @param {{ username: string, dealer: 0|1 }} params
 * @param {(params: { username: string }) => Promise<string|null>} [fetchDealerSignFn]
 *        iniettabile nei test (default: chiamata REST a dbmanager/getDealerSign)
 * @returns {Promise<string|null>}
 */
async function resolveReceptionistFEA({ username, dealer } = {}, fetchDealerSignFn) {
  if (!dealer || !username) return null;

  const fetchDealerSign = fetchDealerSignFn || loadFetchDealerSign();

  try {
    return (await fetchDealerSign({ username })) ?? null;
  } catch (err) {
    console.error(`[session] lettura receptionistFEA (woc.dealer_sign) fallita: ${err.message}`);
    return null;
  }
}

module.exports = { resolveReceptionistFEA };
