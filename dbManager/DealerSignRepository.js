'use strict';

/**
 * DealerSignRepository.js — Query SQL sulla tabella woc.dealer_sign (Aurora PostgreSQL, db
 * "wiadvisor", schema "woc").
 *
 * Schema:
 *   woc.dealer_sign(dealer_sign_id BIGINT PK, dealer_login_userid VARCHAR(50) NOT NULL UNIQUE,
 *                   sign_image BYTEA NOT NULL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
 *
 * Una riga per utente dealer con l'immagine (PNG/JPEG, binaria) della firma dell'accettatore,
 * scritta dalla lambda CWS (POST /accettatore/new) o da isStellantisBrand.
 * getDealerSign esegue la stessa query di getFirmaAccettatore della lambda CWS e restituisce
 * l'immagine in base64 (campo receptionistFEA di GET /session); a differenza della CWS, che
 * risponde 404, una firma assente vale null.
 */

const SELECT_DEALER_SIGN_SQL = 'SELECT sign_image FROM woc.dealer_sign WHERE dealer_login_userid = $1';

/**
 * @param {import('pg').Pool} pool
 * @param {{ username: string }} params - utente autenticato dall'authorizer (es. "0073741.d235")
 * @returns {Promise<string|null>} immagine della firma in base64, o null se l'utente non ha una firma
 */
async function getDealerSign(pool, { username } = {}) {
  if (!username) throw new Error('"username" is required');

  const { rows } = await pool.query(SELECT_DEALER_SIGN_SQL, [username]);

  return rows.length > 0 ? rows[0].sign_image.toString('base64') : null;
}

module.exports = { getDealerSign };
