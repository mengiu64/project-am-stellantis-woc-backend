'use strict';

const repository = require('./repository');

const SNOWFLAKE_DEFAULT_BUCKET = 's3-woc-bsn0027990-stage-m2m-snowflake-extracts';
const SNOWFLAKE_FILE_PREFIX = 'DM_MCO_DPR_RA_SITE';
const SNOWFLAKE_LEGALENTITY_FILE_PREFIX = 'DM_MCO_DEALER';
const SNOWFLAKE_ADDR_FILE_PREFIX = 'DM_MCO_EXTERNAL_LOCATION';
const SNOWFLAKE_ANAG_FILE_PREFIX = 'DM_MCO_M2M';
// Dimensione dei blocchi inviati a dbManager (limite payload API Gateway/Lambda)
const SNOWFLAKE_BATCH_SIZE = 1000;

/**
 * Parser CSV (RFC 4180): campi tra doppi apici, "" come apice escapato,
 * newline dentro i campi quotati, CRLF/LF, BOM iniziale.
 * @returns {string[][]}
 */
function parseCsv(text, delimiter = ',') {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Converte il CSV (prima riga = intestazione) in oggetti con chiavi in minuscolo. */
function csvToObjects(text, delimiter) {
  const [header, ...lines] = parseCsv(text, delimiter);
  if (!header) return [];
  const keys = header.map((h) => h.trim().toLowerCase());
  return lines.map((line) => Object.fromEntries(keys.map((k, i) => [k, line[i] === undefined ? null : line[i]])));
}

function resolveIdentity(event, body) {
  const authz = event.requestContext && event.requestContext.authorizer;
  return authz ? (authz.sub || null) : (body.username || null);
}

async function getSessionData(username) {
  try {
    const { callService } = require('../serviceClient');
    return (await callService('session', 'getData', { args: [username] })) || {};
  } catch (err) {
    console.error(`[hqManager] lettura sessione REST fallita: ${err.message}`);
    return {};
  }
}

/**
 * Risolve lo `username` "leggibile" da registrare nell'audit HQ
 * (woc.hq_audit, v. HqRepository.js::insertAudit): l'identificativo tecnico
 * autenticato (event.requestContext.authorizer.sub — MAI un valore fornito
 * nel body, salvo invocazione diretta/CLI senza requestContext.authorizer,
 * stesso pattern di session/pkFavorite) viene usato per recuperare
 * firstname/lastname dalla sessione utente tramite session/getData REST,
 * concatenati come "firstname lastname".
 *
 * Se firstname/lastname non sono risolvibili (sessione non trovata,
 * myPeople irraggiungibile, utente HQ senza profilo, ecc. — resa
 * best-effort, con log esplicito degli errori REST) si ricade sul solo
 * identificativo tecnico, cosi' l'audit
 * registra comunque un `username` non nullo quando l'identita' e' nota.
 *
 * @param {object} [event]
 * @param {object} [body]
 * @returns {Promise<string|null>}
 */
async function resolveUsername(event = {}, body = {}) {
  const usernameKey = resolveIdentity(event, body);
  if (!usernameKey) return null;

  const session = await getSessionData(usernameKey);
  const firstname = session.firstname || '';
  const lastname = session.lastname || '';
  const fullName = `${firstname} ${lastname}`.trim();

  return fullName || usernameKey;
}

/**
 * Risolve il `codmarket` (mercato) dell'utente autenticato da registrare
 * come `market` nell'audit HQ (woc.hq_audit, v.
 * HqRepository.js::insertAudit), con lo stesso meccanismo/identificativo
 * tecnico e la stessa sessione REST usati da resolveUsername (v. sopra) per
 * firstname/lastname.
 *
 * Best-effort come resolveUsername: se l'identita' non e' risolvibile o la
 * sessione non espone un codmarket (utente HQ centrale, sessione non
 * trovata, myPeople irraggiungibile, ecc.) si ricade su una stringa vuota
 * ("") anziche' su null, cosi' da non violare l'obbligatorieta' di `market`
 * lato chiamata SQL (colonna nullable, ma il valore atteso e' comunque una
 * stringa).
 *
 * @param {object} [event]
 * @param {object} [body]
 * @returns {Promise<string>}
 */
async function resolveCodmarket(event = {}, body = {}) {
  const usernameKey = resolveIdentity(event, body);
  if (!usernameKey) return '';

  const session = await getSessionData(usernameKey);

  return session.codmarket || '';
}

/**
 * HqManager.js — orchestrazione applicativa sulle operazioni REST dbmanager.
 * Il receiver possiede pool, SQL e accesso S3; questo modulo conserva ordine
 * delle scritture e dell'audit, senza importare altre Lambda.
 *
 * getEnablingConfiguration(codmarket) espone la configurazione di
 * abilitazione WOC/firma digitale per ciascun sito del mercato richiesto
 * (join ang_snowflakes + addr_snowflakes + hq_application_enabling).
 *
 * setEnablingConfiguration(configurations, event) crea/aggiorna (upsert), in
 * un loop, la riga di configurazione per ciascun elemento dell'array
 * configurations ({ codmarket, oic, enableWOC, enableSignature }),
 * registrando anche una riga di audit (woc.hq_audit) per ciascun elemento,
 * con username risolto da resolveUsername (v. sopra: firstname+lastname
 * della sessione dell'utente autenticato, event.requestContext.authorizer.sub).
 *
 * importAppConfiguration(market, fileContentBase64) importa in blocco, da
 * un file Excel ricevuto in Base64 nel body (XLSX.read, decodificato qui:
 * la Lambda non ha accesso al filesystem del chiamante), le righe di
 * configurazione di abilitazione WOC/firma digitale per il mercato
 * indicato: l'array di righe estratto dal file viene inviato in un'unica
 * chiamata REST a dbManager (HqRepository.js::importAppConfiguration), che
 * esegue l'intera importazione in una sola transazione (rollback totale se
 * anche una sola riga fallisce).
 *
 * exportAppConfiguration(market) e' l'operazione simmetrica: legge (in
 * un'unica chiamata REST, HqRepository.js::getAppConfigurationList) le
 * righe di configurazione di abilitazione WOC/firma digitale del mercato
 * indicato, le serializza qui in un foglio XLSX (XLSX.utils.json_to_sheet)
 * e restituisce il file come contenuto Base64 (nessuna scrittura su
 * filesystem: la Lambda non ha accesso al filesystem del chiamante).
 *
 * getVehicleInspection(market, type),
 * setVehicleInspectionVisible(payload, event) (payload contiene un array
 * { id, value } sotto una di queste chiavi: conditions, equipment,
 * damagearea, receptions, vehicleconfiguration — una sola per chiamata;
 * loop su ciascun elemento), deletetVehicleInspection(id, value, event) e
 * insertVehicleInspection(market, type, descr, event) espongono la
 * gestione delle voci di controllo veicolo (woc.hq_vehicle_inspection);
 * ciascuna registra anche una riga di audit (woc.hq_audit, v.
 * HqRepository.js) con username risolto da resolveUsername e, come `market`
 * dell'audit, il codmarket risolto da resolveCodmarket (v. sotto: stessa
 * sessione dell'utente autenticato, "" se non risolvibile).
 *
 * setMarketEnable(market)/setMarketDisable(market)/
 * checkIsPkMarketEnabled(market) (legge il flag "deleted" di
 * woc.hq_pk_market: 0 = abilitato, 1 = disabilitato, undefined se il
 * mercato non ha una riga configurata),
 * insertDomain(market, descr) (domini condivisi da tutti gli OIC del
 * mercato, woc.hq_pk_domain non ha una colonna "oic")/
 * setDomain(market, iddomain, descr)/
 * deleteDomain(market, iddomain) (cancellazione logica, deleted = 1)/
 * setDomainVisible(payload) (payload.domain, array di { iddomain, value },
 * loop) e insertPackage(market, oic, iddomain, descr, timeop, pricewithvat)/
 * setPackage(idpackage, iddomain, descr, timeop, pricewithvat)/
 * deletePackage(idpackage)/setPackageVisible(payload) (payload.package,
 * array di { idpackage, value }, loop) espongono la
 * gerarchia di configurazione mercato -> dominio -> pacchetto
 * (woc.hq_pk_market/hq_pk_domain/hq_pk_packages; la tabella woc.hq_pk_oic
 * non e' piu' usata).
 *
 * getPackageListHQ(market) legge la gerarchia mercato -> dominio ->
 * pacchetto "a livello mercato" (nessun OIC, pk.oic IS NULL) configurata
 * per il mercato richiesto (i domini cancellati logicamente sono esclusi,
 * include anche domVisible/pkVisible).
 *
 * getPackageListSM(market, oic) legge la stessa gerarchia ma per i soli
 * pacchetti del singolo OIC richiesto (pk.oic = oic); i domini sono
 * condivisi da tutti gli OIC del mercato, quindi non serve alcuna
 * inizializzazione/copia per il singolo OIC.
 *
 * insertAudit(event, section, market, actiontype, descr) e
 * searchAudit(market, section, datefrom, dateto, actiontype, username)
 * (filtri tutti opzionali; se nessuno e' valorizzato, il risultato e'
 * limitato alle ultime 100 righe per creationdate) espongono il log di
 * audit HQ (woc.hq_audit); insertAudit risolve anch'esso lo username da
 * registrare tramite resolveUsername.
 *
 * exportAudit(market, section, datefrom, dateto, actiontype, username) e'
 * l'operazione simmetrica a exportAppConfiguration ma per il log di audit:
 * legge (stessi filtri opzionali di searchAudit, stesso limite alle ultime
 * 100 righe se nessun filtro e' valorizzato) le righe di woc.hq_audit, le
 * serializza in un foglio XLSX e restituisce il file come contenuto Base64
 * (nessuna scrittura su filesystem).
 *
 * getAnagSection()/getAnagAllocation() espongono le anagrafiche statiche
 * (sezioni HQ / tipi di azione di audit) lette da S3
 * (dbManager/S3ConfigRepository.js, bucket TranslationsBucket).
 */
class HqManager {
  /**
   * Chiavi array note del payload di setVehicleInspectionVisible: solo una
   * e' presente per chiamata, in base alla categoria di controllo veicolo.
   */
  static VEHICLE_INSPECTION_ARRAY_KEYS = ['conditions', 'equipment', 'damagearea', 'receptions', 'vehicleconfiguration'];

  /**
   * @param {string} codmarket
   * @returns {Promise<Array<{ siteName: string|null, oic: string|null, address: string|null, legalEntity: string|null, enableWOC: number, enableSignature: number }>>}
   */
  async getEnablingConfiguration(codmarket) {
    return repository.getEnablingConfiguration(codmarket);
  }

  /**
   * Crea/aggiorna (upsert), in un loop, la riga di configurazione per
   * ciascun elemento dell'array configurations, tramite chiamate REST sequenziali.
   * Per ciascun elemento registra anche una riga di audit (woc.hq_audit,
   * sezione "enablingConfiguration", actiontype "update"), con lo username
   * risolto da resolveUsername (v. sopra: firstname+lastname della sessione
   * dell'utente autenticato, event.requestContext.authorizer.sub; null se
   * l'identita' non e' risolvibile, es. invocazione diretta/CLI).
   *
   * @param {Array<{ codmarket: string, oic: string, enableWOC: number, enableSignature: number }>} configurations
   * @param {object} [event]
   * @returns {Promise<void>}
   */
  async setEnablingConfiguration(configurations, event = {}) {
    if (!Array.isArray(configurations) || configurations.length === 0) {
      throw new Error('"configurations" is required');
    }

    const username = await resolveUsername(event);

    for (const { codmarket, oic, enableWOC, enableSignature } of configurations) {
      await repository.setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature);
      await repository.insertAudit(username, 'enablingConfiguration', codmarket, 'update', `oic: ${oic} enabled: ${enableWOC} enableSignature:${enableSignature}`);
    }
  }

  /**
   * Importa in blocco, da un file Excel, le righe di configurazione di
   * abilitazione WOC/firma digitale (woc.hq_application_enabling) per il
   * mercato indicato. Il file Excel arriva codificato in Base64 nel body
   * della richiesta (stesso pattern di moparDoc::createJobCardAndUploadDocument,
   * necessario perche' la Lambda non ha accesso al filesystem del chiamante):
   * viene decodificato/parsato qui (XLSX.read) estraendo la prima sheet in
   * un array di oggetti plain { oic, enablewoc, enablesignature, ... }
   * (riga 1 = intestazione); il risultato, serializzabile, viene poi
   * inviato in un'unica chiamata REST a dbManager
   * (HqRepository.js::importAppConfiguration), che esegue l'intera
   * importazione in una sola transazione (BEGIN/COMMIT, ROLLBACK se anche
   * una sola riga fallisce la validazione/l'upsert).
   *
   * @param {string} market
   * @param {string} fileContentBase64 - contenuto del file Excel (XLSX) codificato in Base64
   * @returns {Promise<{ success: boolean, rowsRead: number, rowsInserted: number, errors: Array<{ row: number, oic: *, error: string }>, message?: string }>}
   */
  async importAppConfiguration(market, fileContentBase64) {
    if (!market) throw new Error('"market" is required');
    if (!fileContentBase64) throw new Error('"fileContentBase64" is required');

    const XLSX = require('xlsx');
    const workbook = XLSX.read(fileContentBase64, { type: 'base64' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });

    return repository.importAppConfiguration(market, rows);
  }

  /**
   * Esporta, in un file Excel, le righe di configurazione di abilitazione
   * WOC/firma digitale (woc.hq_application_enabling) del mercato indicato:
   * i dati vengono letti da dbManager con un'unica chiamata REST
   * (HqRepository.js::getAppConfigurationList, ordinati per oic), poi
   * serializzati qui in un foglio XLSX (XLSX.utils.json_to_sheet) e
   * restituiti come contenuto Base64 (stesso pattern, simmetrico, di
   * importAppConfiguration: la Lambda non ha accesso al filesystem del
   * chiamante, quindi il file non viene scritto su disco ma restituito nel
   * body della risposta).
   *
   * @param {string} market
   * @returns {Promise<{ market: string, rowsExported: number, fileContentBase64: string }>}
   */
  async exportAppConfiguration(market) {
    if (!market) throw new Error('"market" is required');

    const rows = await repository.getAppConfigurationList(market);

    const XLSX = require('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const fileContentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

    return { market, rowsExported: rows.length, fileContentBase64 };
  }

  /**
   * @param {string} market
   * @param {string} type
   * @returns {Promise<Array<{ id: number, market: string|null, type: string, descr: string, visible: number, deleted: number }>>}
   */
  async getVehicleInspection(market, type) {
    return repository.getVehicleInspection(market, type);
  }

  /**
   * Aggiorna il flag "visible" per ciascun elemento { id, value } contenuto
   * in una delle chiavi array note del payload (conditions, equipment,
   * damagearea, receptions, vehicleconfiguration — solo una e' presente per
   * chiamata), tramite chiamate REST sequenziali.
   *
   * @param {{ conditions?: Array<{id:number, value:number}>, equipment?: Array<{id:number, value:number}>, damagearea?: Array<{id:number, value:number}>, receptions?: Array<{id:number, value:number}>, vehicleconfiguration?: Array<{id:number, value:number}> }} payload
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   lo username (firstname+lastname) e il market ("" se non risolvibile)
   *   dell'audit, entrambi dalla sessione dell'utente autenticato.
   * @returns {Promise<void>}
   */
  async setVehicleInspectionVisible(payload, event = {}) {
    const key = HqManager.VEHICLE_INSPECTION_ARRAY_KEYS.find((k) => Array.isArray(payload && payload[k]));
    if (!key) {
      throw new Error(`"payload" must contain an array in one of: ${HqManager.VEHICLE_INSPECTION_ARRAY_KEYS.join(', ')}`);
    }

    const username = await resolveUsername(event, payload);
    const codmarket = await resolveCodmarket(event, payload);

    for (const { id, value } of payload[key]) {
      await repository.setVehicleInspectionVisible(id, value, username, codmarket);
    }
  }

  /**
   * @param {number} id
   * @param {number} value
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   lo username (firstname+lastname) e il market ("" se non risolvibile)
   *   dell'audit, entrambi dalla sessione dell'utente autenticato.
   * @returns {Promise<void>}
   */
  async deletetVehicleInspection(id, value, event = {}) {
    const username = await resolveUsername(event);
    const codmarket = await resolveCodmarket(event);

    return repository.deletetVehicleInspection(id, value, username, codmarket);
  }

  /**
   * @param {string} market
   * @param {string} type
   * @param {string} descr
   * @param {object} [event] - usato da resolveUsername per
   *   lo username dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async insertVehicleInspection(market, type, descr, event = {}) {
    const username = await resolveUsername(event);
    return repository.insertVehicleInspection(market, type, descr, username);
  }

  /**
   * @param {string} market
   * @param {object} [event] - usato da resolveUsername per
   *   lo username dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async setMarketEnable(market, event = {}) {
    const username = await resolveUsername(event);

    return repository.setPkMarketEnable(market, username);
  }

  /**
   * @param {string} market
   * @param {object} [event] - usato da resolveUsername per
   *   lo username dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async setMarketDisable(market, event = {}) {
    const username = await resolveUsername(event);

    return repository.setPkMarketDisable(market, username);
  }

  /**
   * Verifica se il mercato indicato e' abilitato (woc.hq_pk_market.deleted:
   * 0 = abilitato, 1 = disabilitato).
   *
   * @param {string} market
   * @returns {Promise<number|undefined>} il valore di "deleted" della riga trovata
   */
  async checkIsPkMarketEnabled(market) {
    return repository.checkIsPkMarketEnabled(market);
  }

  /**
   * I domini sono condivisi da tutti gli OIC del mercato (woc.hq_pk_domain
   * non ha la colonna "oic", v. dbManager/HqRepository.js::insertDomain).
   *
   * @param {string} market
   * @param {string} descr
   * @param {object} [event] - usato da resolveUsername per lo username
   *   dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<number>} l'iddomain generato
   */
  async insertDomain(market, descr, event = {}) {
    const username = await resolveUsername(event);

    return repository.insertDomain(market, descr, username);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @param {string} descr
   * @param {object} [event] - usato da resolveUsername per
   *   lo username dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async setDomain(market, iddomain, descr, event = {}) {
    const username = await resolveUsername(event);

    return repository.setDomain(market, iddomain, descr, username);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @param {object} [event] - usato da resolveUsername per
   *   lo username dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async deleteDomain(market, iddomain, event = {}) {
    const username = await resolveUsername(event);

    return repository.deleteDomain(market, iddomain, username);
  }

  /**
   * Aggiorna il flag "visible", in un loop, per ciascun elemento
   * { iddomain, value } dell'array presente in payload.domain, in sequenza.
   *
   * @param {{ domain: Array<{ iddomain: number, value: number }> }} payload
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   username e market dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async setDomainVisible(payload, event = {}) {
    const domain = payload && payload.domain;
    if (!Array.isArray(domain) || domain.length === 0) {
      throw new Error('"domain" is required');
    }

    const username = await resolveUsername(event, payload);
    const codmarket = await resolveCodmarket(event, payload);

    for (const { iddomain, value } of domain) {
      await repository.setDomainVisible(iddomain, value, username, codmarket);
    }
  }

  /**
   * @param {string} market
   * @param {string} oic
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @param {object} [event] - usato da resolveUsername per lo username
   *   dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<number>} l'idpackage generato
   */
  async insertPackage(market, oic, iddomain, descr, timeop, pricewithvat, event = {}) {
    const username = await resolveUsername(event);

    return repository.insertPackage(market, oic, iddomain, descr, timeop, pricewithvat, username);
  }

  /**
   * @param {number} idpackage
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @param {object} [event] - usato da resolveUsername per lo username
   *   dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async setPackage(idpackage, iddomain, descr, timeop, pricewithvat, event = {}) {
    const username = await resolveUsername(event);

    return repository.setPackage(idpackage, iddomain, descr, timeop, pricewithvat, username);
  }

  /**
   * @param {number} idpackage
   * @param {object} [event] - usato da resolveUsername per lo username
   *   dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async deletePackage(idpackage, event = {}) {
    const username = await resolveUsername(event);

    return repository.deletePackage(idpackage, username);
  }

  /**
   * Aggiorna il flag "visible", in un loop, per ciascun elemento
   * { idpackage, value } dell'array presente in payload.package, in sequenza.
   *
   * @param {{ package: Array<{ idpackage: number, value: number }> }} payload
   * @returns {Promise<void>}
   */
  async setPackageVisible(payload) {
    const pkg = payload && payload.package;
    if (!Array.isArray(pkg) || pkg.length === 0) {
      throw new Error('"package" is required');
    }

    for (const { idpackage, value } of pkg) {
      await repository.setPackageVisible(idpackage, value);
    }
  }

  /**
   * Ritorna la lista pacchetti "a livello mercato" (nessun OIC) del
   * mercato indicato.
   *
   * @param {string} market
   * @returns {Promise<Array<{ market: string, oic: null, domainDescr: string|null, domVisible: number|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null, pkVisible: number|null }>>}
   */
  async getPackageListHQ(market) {
    return repository.getPackageListHQ(market);
  }

  /**
   * Ritorna la lista pacchetti del singolo OIC (del mercato indicato).
   * I domini sono condivisi da tutti gli OIC del mercato (v. insertDomain):
   * non serve piu' alcuna inizializzazione/copia per il singolo OIC.
   *
   * @param {string} market
   * @param {string} oic
   * @returns {Promise<Array<{ market: string, oic: string, domainDescr: string|null, domVisible: number|null, idpackage: number|null, packageDescr: string|null, timeop: number|null, pricewithvat: number|null, pkVisible: number|null }>>}
   */
  async getPackageListSM(market, oic) {
    return repository.getPackageListSM(market, oic);
  }

  /**
   * Clona, per il mercato indicato (marketOrig), le gerarchie
   * hq_pk_domain/hq_pk_packages in un nuovo mercato (marketTarget). Vedi
   * dbManager/HqRepository.clonePk per i dettagli.
   *
   * @param {string} marketTarget
   * @param {string} marketOrig
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   username e market dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async clonePk(marketTarget, marketOrig, event = {}) {
    const username = await resolveUsername(event);
    const codmarket = await resolveCodmarket(event);

    await repository.clonePk(marketTarget, marketOrig, username, codmarket);
  }

  /**
   * Clona, per il type indicato, le righe di woc.hq_vehicle_inspection dal
   * mercato marketOrig (eventualmente null, righe comuni senza mercato) al
   * mercato marketTarget, cancellando prima logicamente quelle gia'
   * presenti in marketTarget per quel type. Vedi
   * dbManager/HqRepository.cloneVeicInspection per i dettagli.
   *
   * @param {string} marketTarget
   * @param {string|null} [marketOrig]
   * @param {string} type
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   username e market dell'audit (sessione dell'utente autenticato).
   * @returns {Promise<void>}
   */
  async cloneVeicInspection(marketTarget, marketOrig, type, event = {}) {
    const username = await resolveUsername(event);
    const codmarket = await resolveCodmarket(event);

    await repository.cloneVeicInspection(marketTarget, marketOrig, type, username, codmarket);
  }

  /**
   * Registra una riga di audit (woc.hq_audit) generica, usata dall'azione
   * "insertAudit" dell'API. Lo username registrato NON e' quello passato
   * dal chiamante (v. index.js, che non lo estrae piu' dal body): e'
   * risolto da resolveUsername (v. sopra) a partire da
   * event.requestContext.authorizer.sub, come firstname+lastname della
   * sessione dell'utente autenticato.
   *
   * @param {object} event
   * @param {string} section
   * @param {string} market
   * @param {string} actiontype
   * @param {string} descr
   * @returns {Promise<string|null>} lo username effettivamente registrato
   */
  async insertAudit(event, section, market, actiontype, descr) {
    const username = await resolveUsername(event);

    await repository.insertAudit(username, section, market, actiontype, descr);
    return username;
  }

  /**
   * @param {string} [market]
   * @param {string} [section]
   * @param {string} [datefrom]
   * @param {string} [dateto]
   * @param {string} [actiontype]
   * @param {string} [username]
   * @returns {Promise<Array<{ id: number, username: string|null, creationdate: string|null, section: string|null, market: string|null, actiontype: string|null, descr: string|null }>>}
   *   Se nessun filtro e' valorizzato, il risultato e' limitato alle ultime
   *   100 righe (per creationdate).
   */
  async searchAudit(market, section, datefrom, dateto, actiontype, username) {
    return repository.searchAudit(market, section, datefrom, dateto, actiontype, username);
  }

  /**
   * Esporta, in un file Excel, le righe di audit HQ (woc.hq_audit) filtrate
   * secondo gli stessi criteri (tutti facoltativi) di searchAudit: i dati
   * vengono letti da dbManager con un'unica chiamata REST
   * (HqRepository.js::searchAudit — se nessun filtro e' valorizzato, il
   * risultato e' limitato alle ultime 100 righe per creationdate), poi
   * serializzati qui in un foglio XLSX (XLSX.utils.json_to_sheet) e
   * restituiti come contenuto Base64 (stesso pattern, simmetrico, di
   * exportAppConfiguration: la Lambda non ha accesso al filesystem del
   * chiamante, quindi il file non viene scritto su disco ma restituito nel
   * body della risposta).
   *
   * @param {string} [market]
   * @param {string} [section]
   * @param {string} [datefrom]
   * @param {string} [dateto]
   * @param {string} [actiontype]
   * @param {string} [username]
   * @returns {Promise<{ rowsExported: number, fileContentBase64: string }>}
   */
  async exportAudit(market, section, datefrom, dateto, actiontype, username) {
    const rows = await repository.searchAudit(market, section, datefrom, dateto, actiontype, username);

    const XLSX = require('xlsx');
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
    const fileContentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

    return { rowsExported: rows.length, fileContentBase64 };
  }

  /**
   * @returns {Promise<Array<{ section: string }>>}
   */
  async getAnagSection() {
    return repository.getAnagSection();
  }

  /**
   * @returns {Promise<Array<{ type: string }>>}
   */
  async getAnagAllocation() {
    return repository.getAnagAllocation();
  }

  /**
   * Importa da S3 i file Snowflake DM_MCO_DPR_RA_SITE* in
   * woc.ang_snowflakes: per ogni file legge il CSV, lo converte in oggetti e
   * lo passa (a blocchi) ad AnagSnowflakesRepository.insertdmsSnowflakes via
   * dbManager (upsert su gn_row_hash). Un errore su un file non blocca gli
   * altri: viene loggato e riportato in `errors` (e `failedFiles`).
   * Bucket/prefisso/separatore configurabili con SNOWFLAKE_BUCKET_NAME,
   * SNOWFLAKE_KEY_PREFIX (default DM_MCO_DPR_RA_SITE) e
   * SNOWFLAKE_CSV_DELIMITER (default ",").
   *
   * @returns {Promise<{ files: number, failedFiles: number, recordsRead: number, recordsSaved: number, inserted: number, updated: number, errors: Array<{ key: string, error: string }> }>}
   */
  async insertdmsSnowflakes() {
    return this._importSnowflakeCsv(
      'insertdmsSnowflakes',
      process.env.SNOWFLAKE_KEY_PREFIX || SNOWFLAKE_FILE_PREFIX,
      'insertdmsSnowflakes',
    );
  }

  /**
   * Come insertdmsSnowflakes ma per i file DM_MCO_DEALER* (prefisso
   * sovrascrivibile con SNOWFLAKE_LEGALENTITY_KEY_PREFIX), salvati in
   * woc.legalentity_snowflakes tramite
   * AnagSnowflakesRepository.insertLegalentitySnowflakes.
   *
   * @returns {Promise<{ files: number, failedFiles: number, recordsRead: number, recordsSaved: number, inserted: number, updated: number, errors: Array<{ key: string, error: string }> }>}
   */
  async insertLegalentitySnowflakes() {
    return this._importSnowflakeCsv(
      'insertLegalentitySnowflakes',
      process.env.SNOWFLAKE_LEGALENTITY_KEY_PREFIX || SNOWFLAKE_LEGALENTITY_FILE_PREFIX,
      'insertLegalentitySnowflakes',
    );
  }

  /**
   * Come insertdmsSnowflakes ma per i file DM_MCO_EXTERNAL_LOCATION* (prefisso
   * sovrascrivibile con SNOWFLAKE_ADDR_KEY_PREFIX), salvati in
   * woc.addr_snowflakes tramite AnagSnowflakesRepository.insertAddrSnowflakes.
   *
   * @returns {Promise<{ files: number, failedFiles: number, recordsRead: number, recordsSaved: number, inserted: number, updated: number, errors: Array<{ key: string, error: string }> }>}
   */
  async insertAddrSnowflakes() {
    return this._importSnowflakeCsv(
      'insertAddrSnowflakes',
      process.env.SNOWFLAKE_ADDR_KEY_PREFIX || SNOWFLAKE_ADDR_FILE_PREFIX,
      'insertAddrSnowflakes',
    );
  }

  /**
   * Come insertdmsSnowflakes ma per i file DM_MCO_M2M* (prefisso
   * sovrascrivibile con SNOWFLAKE_ANAG_KEY_PREFIX), salvati in
   * woc.ang_snowflakes tramite AnagSnowflakesRepository.insertAnagSnowflakes.
   *
   * @returns {Promise<{ files: number, failedFiles: number, recordsRead: number, recordsSaved: number, inserted: number, updated: number, errors: Array<{ key: string, error: string }> }>}
   */
  async insertAnagSnowflakes() {
    return this._importSnowflakeCsv(
      'insertAnagSnowflakes',
      process.env.SNOWFLAKE_ANAG_KEY_PREFIX || SNOWFLAKE_ANAG_FILE_PREFIX,
      'insertAnagSnowflakes',
    );
  }

  /** Lettura CSV da S3 (tutti i file con il prefisso) e upsert a blocchi tramite repository[operation]. */
  async _importSnowflakeCsv(label, defaultPrefix, operation) {
    const { S3Client, ListObjectsV2Command, GetObjectCommand } = require('@aws-sdk/client-s3');
    const bucket = process.env.SNOWFLAKE_BUCKET_NAME || SNOWFLAKE_DEFAULT_BUCKET;
    const prefix = defaultPrefix;
    const delimiter = process.env.SNOWFLAKE_CSV_DELIMITER || ',';
    const s3 = new S3Client({});

    const keys = [];
    let ContinuationToken;
    do {
      const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken }));
      for (const obj of page.Contents || []) keys.push(obj.Key);
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
    keys.sort();

    console.log(`[hqManager] ${label}: ${keys.length} file trovati in s3://${bucket}/${prefix}*`);

    const summary = {
      files: keys.length, failedFiles: 0, recordsRead: 0, recordsSaved: 0, inserted: 0, updated: 0, errors: [],
    };

    for (const key of keys) {
      let read = 0;
      let saved = 0;
      try {
        const object = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const records = csvToObjects(await object.Body.transformToString('utf-8'), delimiter);
        read = records.length;
        summary.recordsRead += read;

        for (let i = 0; i < records.length; i += SNOWFLAKE_BATCH_SIZE) {
          const result = await repository[operation](records.slice(i, i + SNOWFLAKE_BATCH_SIZE));
          saved += result.saved;
          summary.recordsSaved += result.saved;
          summary.inserted += result.inserted;
          summary.updated += result.updated;
        }
        console.log(`[hqManager] ${label}: ${key} letti=${read} salvati=${saved}`);
      } catch (err) {
        summary.failedFiles += 1;
        summary.errors.push({ key, error: err.message });
        console.error(`[hqManager] ${label}: errore su ${key} (letti=${read} salvati=${saved}): ${err.message}`);
      }
    }

    console.log(`[hqManager] ${label}: file=${summary.files} falliti=${summary.failedFiles} letti=${summary.recordsRead} inseriti=${summary.inserted} aggiornati=${summary.updated}`);
    return summary;
  }
}

module.exports = { HqManager };
