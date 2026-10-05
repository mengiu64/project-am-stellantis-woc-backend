'use strict';

const repository = require('./repository');

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
 * setMarketEnable(market)/setMarketDisable(market),
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
   * @param {object} [event] - usato da resolveUsername/resolveCodmarket per
   *   lo username (firstname+lastname) e il market ("" se non risolvibile)
   *   dell'audit, entrambi dalla sessione dell'utente autenticato.
   * @returns {Promise<void>}
   */
  async insertVehicleInspection(market, type, descr, event = {}) {
    const username = await resolveUsername(event);
    const codmarket = await resolveCodmarket(event);

    return repository.insertVehicleInspection(market, type, descr, username, codmarket);
  }

  /**
   * @param {string} market
   * @returns {Promise<void>}
   */
  async setMarketEnable(market) {
    return repository.setPkMarketEnable(market);
  }

  /**
   * @param {string} market
   * @returns {Promise<void>}
   */
  async setMarketDisable(market) {
    return repository.setPkMarketDisable(market);
  }

  /**
   * I domini sono condivisi da tutti gli OIC del mercato (woc.hq_pk_domain
   * non ha la colonna "oic", v. dbManager/HqRepository.js::insertDomain).
   *
   * @param {string} market
   * @param {string} descr
   * @returns {Promise<number>} l'iddomain generato
   */
  async insertDomain(market, descr) {
    return repository.insertDomain(market, descr);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @param {string} descr
   * @returns {Promise<void>}
   */
  async setDomain(market, iddomain, descr) {
    return repository.setDomain(market, iddomain, descr);
  }

  /**
   * @param {string} market
   * @param {number} iddomain
   * @returns {Promise<void>}
   */
  async deleteDomain(market, iddomain) {
    return repository.deleteDomain(market, iddomain);
  }

  /**
   * Aggiorna il flag "visible", in un loop, per ciascun elemento
   * { iddomain, value } dell'array presente in payload.domain, in sequenza.
   *
   * @param {{ domain: Array<{ iddomain: number, value: number }> }} payload
   * @returns {Promise<void>}
   */
  async setDomainVisible(payload) {
    const domain = payload && payload.domain;
    if (!Array.isArray(domain) || domain.length === 0) {
      throw new Error('"domain" is required');
    }

    for (const { iddomain, value } of domain) {
      await repository.setDomainVisible(iddomain, value);
    }
  }

  /**
   * @param {string} market
   * @param {string} oic
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @returns {Promise<number>} l'idpackage generato
   */
  async insertPackage(market, oic, iddomain, descr, timeop, pricewithvat) {
    return repository.insertPackage(market, oic, iddomain, descr, timeop, pricewithvat);
  }

  /**
   * @param {number} idpackage
   * @param {number} iddomain
   * @param {string} descr
   * @param {number} timeop
   * @param {number} pricewithvat
   * @returns {Promise<void>}
   */
  async setPackage(idpackage, iddomain, descr, timeop, pricewithvat) {
    return repository.setPackage(idpackage, iddomain, descr, timeop, pricewithvat);
  }

  /**
   * @param {number} idpackage
   * @returns {Promise<void>}
   */
  async deletePackage(idpackage) {
    return repository.deletePackage(idpackage);
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
   * @returns {Promise<void>}
   */
  async clonePk(marketTarget, marketOrig) {
    await repository.clonePk(marketTarget, marketOrig);
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
   * @returns {Promise<void>}
   */
  async cloneVeicInspection(marketTarget, marketOrig, type) {
    await repository.cloneVeicInspection(marketTarget, marketOrig, type);
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
}

module.exports = { HqManager };
