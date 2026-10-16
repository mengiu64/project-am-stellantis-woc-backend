'use strict';

/**
 * DealerSignRepository.js — Query SQL sulla tabella woc.dealer_sign (Aurora PostgreSQL, db
 * "wiadvisor", schema "woc").
 *
 * Schema:
 *   woc.dealer_sign(dealer_sign_id BIGINT PK, dealer_login_userid VARCHAR(50) NOT NULL UNIQUE,
 *                   sign_image BYTEA NOT NULL, created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
 *
 * Una riga per utente dealer con l'immagine (PNG/JPEG/SVG, binaria) della firma dell'accettatore,
 * scritta dalla lambda CWS (POST /accettatore/new) o da isStellantisBrand; il MIME type non è salvato.
 * getDealerSign esegue la stessa query di getFirmaAccettatore della lambda CWS e, come la CWS,
 * restituisce l'immagine come data URL (campo receptionistFEA di GET /session); a differenza della
 * CWS, che risponde 404, una firma assente vale null.
 */

const SELECT_DEALER_SIGN_SQL = 'SELECT sign_image FROM woc.dealer_sign WHERE dealer_login_userid = $1';

// MIME type riconosciuto dal contenuto come in getFirmaAccettatore della lambda CWS
// (src/dealerSignService.js): magic number PNG/JPEG o elemento radice <svg>
const RASTER_IMAGES = [
  { mimeType: 'image/png', magicNumber: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) },
  { mimeType: 'image/jpeg', magicNumber: Buffer.from([0xff, 0xd8, 0xff]) },
];
const SVG_MIME_TYPE = 'image/svg+xml';
// <svg> preceduto al più da BOM, dichiarazione XML, commenti e DOCTYPE senza internal subset;
// un commento non può contenere "-->", così anche molti commenti sono verificati in tempo lineare
const SVG_ROOT = /^\uFEFF?\s*(?:<\?xml[^>]*\?>\s*)?(?:(?:<!--(?:[^-]|-(?!->))*-->|<!DOCTYPE[^[>]*>)\s*)*<svg[\s/>]/i;
// Immagine non riconosciuta (salvata senza i controlli di storeFirmaAccettatore): PNG, come nella CWS
const DEFAULT_MIME_TYPE = 'image/png';

function detectMimeType(image) {
  const raster = RASTER_IMAGES.find(({ magicNumber }) => image.subarray(0, magicNumber.length).equals(magicNumber));
  if (raster) return raster.mimeType;
  return SVG_ROOT.test(image.toString('utf8')) ? SVG_MIME_TYPE : DEFAULT_MIME_TYPE;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ username: string }} params - utente autenticato dall'authorizer (es. "0073741.d235")
 * @returns {Promise<string|null>} immagine della firma come data URL pronto per il src di un <img>
 *          (es. "data:image/svg+xml;base64,PHN2Zy..."), o null se l'utente non ha una firma
 */
async function getDealerSign(pool, { username } = {}) {
  if (!username) throw new Error('"username" is required');

  const { rows } = await pool.query(SELECT_DEALER_SIGN_SQL, [username]);
  if (rows.length === 0) return null;

  const image = rows[0].sign_image;
  return `data:${detectMimeType(image)};base64,${image.toString('base64')}`;
}

module.exports = { getDealerSign };
