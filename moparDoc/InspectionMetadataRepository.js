'use strict';

/**
 * InspectionMetadataRepository.js — tabella woc.mopardoc_inspection_media
 * (v. sql/create_table_mopardoc_inspection_media.sql).
 *
 * Il FE invia a createJobCardAndUploadDocument, insieme alla foto, alcuni
 * metadati di ispezione OPZIONALI e NULLABLE (Kind, TabId, DamageArea,
 * Description, PosX, PosY, CapturedAt) che l'API Mopar non gestisce. Questo
 * repository li salva su Aurora (UPSERT su document_id = id documento Mopar),
 * li rilegge per arricchire le risposte di getDocuments /
 * getJobCardAndDocumentList (campo InspectionMetadata su ogni documento) e li
 * cancella in deleteDocumentsByVin.
 *
 * Regola generale: i metadati non devono MAI far fallire l'upload. I valori
 * non validi vengono normalizzati a null (con console.warn), mai rifiutati.
 * Solo query parametrizzate.
 */

const COLUMNS = 'document_id, kind, tab_id, damage_area, description, pos_x, pos_y, captured_at';

const UPSERT_SQL = `
  INSERT INTO woc.mopardoc_inspection_media
    (document_id, jobcard_id, vin, kind, tab_id, damage_area, description, pos_x, pos_y, captured_at, created_by)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (document_id) DO UPDATE SET
    jobcard_id  = EXCLUDED.jobcard_id,
    vin         = EXCLUDED.vin,
    kind        = EXCLUDED.kind,
    tab_id      = EXCLUDED.tab_id,
    damage_area = EXCLUDED.damage_area,
    description = EXCLUDED.description,
    pos_x       = EXCLUDED.pos_x,
    pos_y       = EXCLUDED.pos_y,
    captured_at = EXCLUDED.captured_at,
    created_by  = COALESCE(EXCLUDED.created_by, woc.mopardoc_inspection_media.created_by)
  RETURNING document_id`;

const SELECT_BY_IDS_SQL = `
  SELECT ${COLUMNS}
  FROM woc.mopardoc_inspection_media
  WHERE document_id = ANY($1::varchar[])`;

const DELETE_BY_IDS_SQL = `
  DELETE FROM woc.mopardoc_inspection_media
  WHERE document_id = ANY($1::varchar[])`;

// Valori ammessi (whitelist) per i campi enumerativi
const KIND_VALUES = ['pin', 'general'];
const TAB_ID_VALUES = ['vehicle', 'tyres', 'dashboard'];
const DAMAGE_AREA_VALUES = ['front', 'left', 'right', 'top', 'rear', 'generic'];

const DESCRIPTION_MAX_LENGTH = 1000;
const CREATED_BY_MAX_LENGTH = 50;

// Chiavi con cui l'upstream Mopar puo' esporre l'id del documento in DocumentList
// (forma reale: `ID`; le altre sono tollerate per robustezza)
const DOCUMENT_ID_KEYS = ['ID', 'Id', 'id', 'DocumentId', 'DocumentID', 'documentId'];

const METADATA_FIELDS = ['Kind', 'TabId', 'DamageArea', 'Description', 'PosX', 'PosY', 'CapturedAt'];

/**
 * Stringa trimmata o null (undefined/null/non-stringa/vuota).
 * @param {*} value
 * @returns {string|null}
 */
function toTrimmedString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Valore enumerativo: trim + lowercase, null se fuori whitelist (con warn).
 */
function toEnum(field, value, allowed) {
  if (value === undefined || value === null) return null;
  const str = toTrimmedString(value);
  if (str === null) {
    if (typeof value !== 'string') {
      console.warn(`[InspectionMetadata] ${field} non stringa (${typeof value}): ignorato`);
    }
    return null;
  }
  const normalized = str.toLowerCase();
  if (!allowed.includes(normalized)) {
    console.warn(`[InspectionMetadata] ${field} non ammesso "${str}" (ammessi: ${allowed.join(', ')}): ignorato`);
    return null;
  }
  return normalized;
}

/**
 * Coordinata percentuale 0..100: accetta numero o stringa numerica.
 */
function toPercent(field, value) {
  if (value === undefined || value === null) return null;
  let num;
  if (typeof value === 'number') {
    num = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    num = Number(value.trim());
  } else {
    if (typeof value !== 'string') {
      console.warn(`[InspectionMetadata] ${field} di tipo non valido (${typeof value}): ignorato`);
    }
    return null;
  }
  if (!Number.isFinite(num) || num < 0 || num > 100) {
    console.warn(`[InspectionMetadata] ${field} non valido o fuori range 0..100 (${value}): ignorato`);
    return null;
  }
  return num;
}

/**
 * Data ISO 8601: accetta stringa o numero (epoch ms) parsabili.
 */
function toIsoDate(field, value) {
  if (value === undefined || value === null) return null;
  let date;
  if (typeof value === 'string') {
    const str = value.trim();
    if (str === '') return null;
    date = new Date(str);
  } else if (typeof value === 'number') {
    date = new Date(value);
  } else {
    console.warn(`[InspectionMetadata] ${field} di tipo non valido (${typeof value}): ignorato`);
    return null;
  }
  if (Number.isNaN(date.getTime())) {
    console.warn(`[InspectionMetadata] ${field} non e' una data valida (${value}): ignorato`);
    return null;
  }
  return date.toISOString();
}

/**
 * Descrizione libera: trim, max 1000 caratteri (troncata con warn).
 */
function toDescription(value) {
  if (value !== undefined && value !== null && typeof value !== 'string') {
    console.warn(`[InspectionMetadata] Description di tipo non valido (${typeof value}): ignorata`);
    return null;
  }
  const str = toTrimmedString(value);
  if (str !== null && str.length > DESCRIPTION_MAX_LENGTH) {
    console.warn(`[InspectionMetadata] Description di ${str.length} caratteri troncata a ${DESCRIPTION_MAX_LENGTH}`);
    return str.slice(0, DESCRIPTION_MAX_LENGTH);
  }
  return str;
}

/**
 * Estrae e normalizza i metadati di ispezione dal body della richiesta.
 * Non lancia mai: ogni valore non valido diventa null.
 * @param {object} params - body di createJobCardAndUploadDocument
 * @returns {{Kind: string|null, TabId: string|null, DamageArea: string|null, Description: string|null, PosX: number|null, PosY: number|null, CapturedAt: string|null}}
 */
function normalizeInspectionMetadata(params) {
  const p = params && typeof params === 'object' ? params : {};
  return {
    Kind: toEnum('Kind', p.Kind, KIND_VALUES),
    TabId: toEnum('TabId', p.TabId, TAB_ID_VALUES),
    DamageArea: toEnum('DamageArea', p.DamageArea, DAMAGE_AREA_VALUES),
    Description: toDescription(p.Description),
    PosX: toPercent('PosX', p.PosX),
    PosY: toPercent('PosY', p.PosY),
    CapturedAt: toIsoDate('CapturedAt', p.CapturedAt),
  };
}

/**
 * true se tutti i metadati normalizzati sono null.
 * @param {object} metadata
 * @returns {boolean}
 */
function isEmptyMetadata(metadata) {
  return METADATA_FIELDS.every((k) => metadata[k] === null || metadata[k] === undefined);
}

/**
 * Converte una riga DB nella forma InspectionMetadata esposta al FE
 * (pos_x/pos_y NUMERIC arrivano come stringa dal driver pg).
 * @param {object} row
 * @returns {object}
 */
function rowToMetadata(row) {
  const toNum = (v) => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toIso = (v) => {
    if (v === null || v === undefined) return null;
    const d = v instanceof Date ? v : new Date(v);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  };
  return {
    Kind: row.kind ?? null,
    TabId: row.tab_id ?? null,
    DamageArea: row.damage_area ?? null,
    Description: row.description ?? null,
    PosX: toNum(row.pos_x),
    PosY: toNum(row.pos_y),
    CapturedAt: toIso(row.captured_at),
  };
}

/**
 * Normalizza una lista di id documento: stringhe trimmate, non vuote, deduplicate.
 * @param {Array<string|number>} ids
 * @returns {string[]}
 */
function normalizeIds(ids) {
  if (!Array.isArray(ids)) return [];
  const out = new Set();
  for (const id of ids) {
    if (id === undefined || id === null) continue;
    const str = String(id).trim();
    if (str !== '') out.add(str);
  }
  return [...out];
}

/**
 * Risolve le dipendenze DB: getPool/isDbConfigured iniettabili nei test.
 * Se getPool è iniettato e isDbConfigured no, il DB è considerato configurato.
 */
function resolveDeps(deps = {}) {
  const db = (!deps.getPool || !deps.isDbConfigured) ? require('./db') : null;
  const getPool = deps.getPool ?? db.getPool;
  let isDbConfigured = deps.isDbConfigured;
  if (!isDbConfigured) {
    isDbConfigured = deps.getPool ? () => true : db.isDbConfigured;
  }
  return { getPool, isDbConfigured };
}

/**
 * UPSERT dei metadati di ispezione di un documento Mopar.
 * Non scrive nulla se il DB non è configurato o se tutti i metadati sono null.
 * Gli errori DB vengono propagati: è il chiamante a renderli non bloccanti.
 * @param {{documentId: string|number, jobCardId: string|number, vin: string, createdBy?: string|null, metadata: object}} input
 * @param {{getPool?: Function, isDbConfigured?: Function}} [deps]
 * @returns {Promise<{saved: boolean, reason: string}>}
 */
async function saveInspectionMetadata({ documentId, jobCardId, vin, createdBy, metadata } = {}, deps = {}) {
  const normalized = normalizeInspectionMetadata(metadata);
  if (isEmptyMetadata(normalized)) {
    console.log(`[InspectionMetadata] Nessun metadato valorizzato per DocumentId=${documentId}: nessuna riga salvata`);
    return { saved: false, reason: 'no-metadata' };
  }
  const { getPool, isDbConfigured } = resolveDeps(deps);
  if (!isDbConfigured()) {
    console.warn(`[InspectionMetadata] DB non configurato (MOPARDOC_DB_HOST assente): metadati di DocumentId=${documentId} non salvati`);
    return { saved: false, reason: 'db-not-configured' };
  }
  if (documentId === undefined || documentId === null || jobCardId === undefined || jobCardId === null || !vin) {
    console.warn('[InspectionMetadata] documentId/jobCardId/vin mancanti: metadati non salvati');
    return { saved: false, reason: 'missing-keys' };
  }
  const user = toTrimmedString(createdBy);
  const pool = await getPool();
  await pool.query(UPSERT_SQL, [
    String(documentId),
    String(jobCardId),
    String(vin).trim(),
    normalized.Kind,
    normalized.TabId,
    normalized.DamageArea,
    normalized.Description,
    normalized.PosX,
    normalized.PosY,
    normalized.CapturedAt,
    user === null ? null : user.slice(0, CREATED_BY_MAX_LENGTH),
  ]);
  console.log(`[InspectionMetadata] mopardoc_inspection_media upsert document_id=${documentId}`);
  return { saved: true, reason: 'saved' };
}

/**
 * Legge i metadati per una lista di id documento.
 * @param {Array<string|number>} ids
 * @param {{getPool?: Function, isDbConfigured?: Function}} [deps]
 * @returns {Promise<Map<string, object>>} document_id -> InspectionMetadata
 */
async function findByDocumentIds(ids, deps = {}) {
  const result = new Map();
  const normalizedIds = normalizeIds(ids);
  if (normalizedIds.length === 0) return result;
  const { getPool, isDbConfigured } = resolveDeps(deps);
  if (!isDbConfigured()) return result;
  const pool = await getPool();
  const { rows } = await pool.query(SELECT_BY_IDS_SQL, [normalizedIds]);
  for (const row of rows) {
    result.set(String(row.document_id), rowToMetadata(row));
  }
  return result;
}

/**
 * Cancella i metadati per una lista di id documento.
 * @param {Array<string|number>} ids
 * @param {{getPool?: Function, isDbConfigured?: Function}} [deps]
 * @returns {Promise<number>} righe cancellate
 */
async function deleteByDocumentIds(ids, deps = {}) {
  const normalizedIds = normalizeIds(ids);
  if (normalizedIds.length === 0) return 0;
  const { getPool, isDbConfigured } = resolveDeps(deps);
  if (!isDbConfigured()) return 0;
  const pool = await getPool();
  const { rowCount } = await pool.query(DELETE_BY_IDS_SQL, [normalizedIds]);
  console.log(`[InspectionMetadata] mopardoc_inspection_media delete: ${rowCount} riga(e) per ${normalizedIds.length} documento(i)`);
  return rowCount || 0;
}

/**
 * Ricava l'id del documento Mopar (chiave `ID`, fallback sulle altre chiavi note).
 * @param {object} document
 * @returns {string|null}
 */
function resolveDocumentId(document) {
  if (!document || typeof document !== 'object') return null;
  for (const key of DOCUMENT_ID_KEYS) {
    const value = document[key];
    if (value !== undefined && value !== null && String(value).trim() !== '') {
      return String(value).trim();
    }
  }
  return null;
}

/**
 * Arricchisce ogni documento di `jobCardList[].DocumentList[]` (e di un
 * eventuale `DocumentList[]` top-level) con `InspectionMetadata` (oggetto o
 * null). Non lancia mai: in caso di errore DB i documenti ricevono
 * InspectionMetadata: null e la risposta upstream resta altrimenti invariata.
 * @param {object} response - risposta upstream di getDocuments / getJobCardAndDocumentList
 * @param {{getPool?: Function, isDbConfigured?: Function}} [deps]
 * @returns {Promise<object>} nuova risposta arricchita (l'input non viene mutato)
 */
async function enrichDocumentLists(response, deps = {}) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return response;

  const hasTopLevelList = Array.isArray(response.DocumentList);
  const hasJobCardList = Array.isArray(response.jobCardList);
  if (!hasTopLevelList && !hasJobCardList) return response;

  // Raccoglie tutti i documenti delle liste presenti
  const documents = [];
  if (hasTopLevelList) documents.push(...response.DocumentList);
  if (hasJobCardList) {
    for (const jobCard of response.jobCardList) {
      if (jobCard && Array.isArray(jobCard.DocumentList)) documents.push(...jobCard.DocumentList);
    }
  }

  let metadataById = new Map();
  try {
    metadataById = await findByDocumentIds(documents.map(resolveDocumentId), deps);
  } catch (err) {
    console.error(`[InspectionMetadata] Lettura metadati fallita, InspectionMetadata=null su tutti i documenti: ${err && err.message}`);
    metadataById = new Map();
  }

  const enrichDocument = (document) => {
    if (!document || typeof document !== 'object') return document;
    const id = resolveDocumentId(document);
    return { ...document, InspectionMetadata: (id !== null && metadataById.get(id)) || null };
  };
  const enrichList = (list) => list.map(enrichDocument);

  const enriched = { ...response };
  if (hasTopLevelList) enriched.DocumentList = enrichList(response.DocumentList);
  if (hasJobCardList) {
    enriched.jobCardList = response.jobCardList.map((jobCard) => (
      jobCard && Array.isArray(jobCard.DocumentList)
        ? { ...jobCard, DocumentList: enrichList(jobCard.DocumentList) }
        : jobCard
    ));
  }
  return enriched;
}

module.exports = {
  normalizeInspectionMetadata,
  isEmptyMetadata,
  rowToMetadata,
  resolveDocumentId,
  saveInspectionMetadata,
  findByDocumentIds,
  deleteByDocumentIds,
  enrichDocumentLists,
  UPSERT_SQL,
  SELECT_BY_IDS_SQL,
  DELETE_BY_IDS_SQL,
  KIND_VALUES,
  TAB_ID_VALUES,
  DAMAGE_AREA_VALUES,
  DESCRIPTION_MAX_LENGTH,
};
