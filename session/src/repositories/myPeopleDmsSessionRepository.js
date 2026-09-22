'use strict';

const path = require('path');
const { SessionRepository } = require('./sessionRepository');
const { SessionNotFoundError } = require('../errors');

// Cross-lambda-folder require, stesso pattern già usato da pkManager/PkManager.js
// (require(path.resolve(__dirname, '../dms/...'))): il build di SessionFunction
// (Metadata: BuildMethod: makefile, vedi Makefile) impacchetta myPeople/, dmlConfigSync/
// e dbManager/ come cartelle sorelle di session/ dentro l'artifact di deploy, cosi'
// questi require relativi continuano a risolvere correttamente anche a runtime in
// Lambda. Caricati "on demand" (lazy) invece che in cima al file: myPeople/config.js
// valida le proprie variabili d'ambiente non appena richiesto, e nei test unitari
// questa repository viene istanziata con le funzioni già iniettate (vedi
// costruttore), senza mai toccare i moduli reali. NOTA: session non richiede più
// dms/ direttamente (dms/authService/dms/dmsService sono usati solo dalla lambda
// "dmlConfigSync", che chiama i servizi DML live una volta al giorno) — il Makefile
// continua comunque a impacchettare dms/ come cartella sorella perché è una
// dipendenza transitiva di dmlConfigSync/index.js (non invocato da session, ma
// comunque parte della stessa cartella sorella). dbManager/ (db.js +
// AnagSnowflakesRepository.js) è invece usato direttamente da session per risolvere
// `marketIso` (tabella woc.ang_snowflakes), stesso cluster Aurora "wiadvisor".
let _readUserProfiles;
let _getDmsSettingsCache;
let _registerDmsSettingsDealer;
let _getDmlConfiguration;
let _getBrandLogos;
let _getCountryIsoCode;
let _getPhysicalSiteAndPdvId;
let _getBrandsByOics;
let _getDisabledOics;
let _getAddressByOics;

function loadReadUserProfiles() {
  if (!_readUserProfiles) {
    ({ readUserProfiles: _readUserProfiles } = require(path.resolve(__dirname, '../../../myPeople/myPeopleService')));
  }
  return _readUserProfiles;
}

// dms/settings NON viene più chiamato live (dms/authService.getBearerToken +
// dms/dmsService.getDmsSettings): è invece letto dalla cache popolata una volta
// al giorno dalla lambda "dmlConfigSync" (tabella woc.dms_settings su Aurora
// PostgreSQL, vedi sql/create_table_dms_settings.sql), stesso principio già
// applicato a company-types/customer-titles (woc.dml_configurations). Session
// non richiede quindi più dms/authService/dms/dmsService: solo dmlConfigSync/
// (già cartella sorella impacchettata via Makefile per la cache DML) serve.
function loadGetDmsSettingsCache() {
  if (!_getDmsSettingsCache) {
    const { getPool } = require(path.resolve(__dirname, '../../../dmlConfigSync/db'));
    const { getDmsSettings } = require(path.resolve(__dirname, '../../../dmlConfigSync/DmsSettingsRepository'));
    _getDmsSettingsCache = async ({ country, brand, dealer }) => {
      const pool = await getPool();
      return getDmsSettings(pool, { country, brand, dealer });
    };
  }
  return _getDmsSettingsCache;
}

// Registra (best-effort) una combinazione country+brand+dealer mai vista prima
// (cache-miss su woc.dms_settings) nel registro woc.dms_settings_enabled_dealers,
// cosi' che la prossima esecuzione schedulata di dmlConfigSync la sincronizzi.
// Il chiamante (getSessionData) attende (await) questa chiamata prima di
// ritornare la risposta (per evitare che resti "in volo" dopo il return della
// Lambda), ma ne ignora sempre un eventuale errore (mai propagato/bloccante).
function loadRegisterDmsSettingsDealer() {
  if (!_registerDmsSettingsDealer) {
    const { getPool } = require(path.resolve(__dirname, '../../../dmlConfigSync/db'));
    const { registerDealer } = require(path.resolve(__dirname, '../../../dmlConfigSync/DmsSettingsRepository'));
    _registerDmsSettingsDealer = async ({ country, brand, dealer }) => {
      const pool = await getPool();
      return registerDealer(pool, { country, brand, dealer });
    };
  }
  return _registerDmsSettingsDealer;
}

// company-types/customer-titles NON vengono più chiamati live (dms/getCompanyTypes,
// dms/getCustomerTitles): sono invece letti dalla cache popolata una volta al giorno
// dalla lambda "dmlConfigSync" (tabella woc.dml_configurations su Aurora PostgreSQL,
// vedi sql/create_table_dml_configurations.sql), cosi' session non deve più chiamare
// i due servizi DML ad ogni richiesta. CodeUri/BuildMethod: makefile di SessionFunction
// impacchetta dmlConfigSync/ come cartella sorella di session/ (vedi Makefile), stesso
// pattern già usato per myPeople/ e dms/.
function loadGetDmlConfiguration() {
  if (!_getDmlConfiguration) {
    const { getPool } = require(path.resolve(__dirname, '../../../dmlConfigSync/db'));
    const { getDmlConfiguration } = require(path.resolve(__dirname, '../../../dmlConfigSync/DmlConfigRepository'));
    _getDmlConfiguration = async ({ country, language }) => {
      const pool = await getPool();
      return getDmlConfiguration(pool, { country, language });
    };
  }
  return _getDmlConfiguration;
}

// Loghi brand (campo OICs[].BRANDS di myPeople, CSV di codbrand numerici es. "30,31,33,43")
// letti dalla stessa tabella woc.anag_brand (colonne codbrand/logo_s3_key) già usata dalla
// lambda isStellantisBrand — stesso cluster Aurora "wiadvisor", stesso pool/utente
// applicativo least-privilege di dmlConfigSync/db (già impacchettato come cartella sorella
// di session/, vedi Makefile), quindi nessuna nuova variabile d'ambiente/permesso necessario.
function loadGetBrandLogos() {
  if (!_getBrandLogos) {
    const { getPool } = require(path.resolve(__dirname, '../../../dmlConfigSync/db'));
    _getBrandLogos = async ({ codes }) => {
      if (!Array.isArray(codes) || codes.length === 0) return {};
      const pool = await getPool();
      const { rows } = await pool.query({
        text: 'SELECT codbrand, logo_s3_key FROM woc.anag_brand WHERE codbrand = ANY($1::varchar[])',
        values: [codes],
        statement_timeout: 5000,
      });
      const logosByCode = {};
      for (const row of rows) {
        if (row.logo_s3_key && String(row.logo_s3_key).trim() !== '') {
          logosByCode[row.codbrand] = row.logo_s3_key;
        }
      }
      return logosByCode;
    };
  }
  return _getBrandLogos;
}

// Codice ISO paese del dealer (marketIso), letto dalla tabella woc.ang_snowflakes
// (snapshot dell'estrazione Snowflake "M2m-queries") a partire dal codmarket
// dell'utente (Attributes.MARKETCODE). Stesso cluster Aurora "wiadvisor", stesso
// pool/utente applicativo least-privilege del modulo dbManager (già impacchettato
// come cartella sorella di session/, vedi Makefile), quindi nessuna nuova
// variabile d'ambiente/permesso necessario.
function loadGetCountryIsoCode() {
  if (!_getCountryIsoCode) {
    const { getPool } = require(path.resolve(__dirname, '../../../dbManager/db'));
    const { getCountryIsoCode } = require(path.resolve(__dirname, '../../../dbManager/AnagSnowflakesRepository'));
    _getCountryIsoCode = async ({ market }) => {
      const pool = await getPool();
      return getCountryIsoCode(pool, { market });
    };
  }
  return _getCountryIsoCode;
}

// Sito fisico ARCAD (physicalsite <- gn_physical_site_arcad) e codice dealer
// ARCAD (pdvId <- cd_dealer_arcad_code), letti dalla tabella woc.ang_snowflakes
// a partire da mainSincom (Attributes.MAINSINCOM)/market (Attributes.MARKETCODE)/
// brand (il brandReftech gia' risolto sopra)/oic (mainOic.CODE) — stessi criteri
// di dbManager/AnagSnowflakesRepository.js::getPhysicalSiteAndPdvId. Stesso
// cluster Aurora "wiadvisor", stesso pool/utente applicativo least-privilege di
// dbManager (gia' impacchettato come cartella sorella di session/, vedi
// Makefile): nessuna nuova variabile d'ambiente/permesso necessario.
function loadGetPhysicalSiteAndPdvId() {
  if (!_getPhysicalSiteAndPdvId) {
    const { getPool } = require(path.resolve(__dirname, '../../../dbManager/db'));
    const { getPhysicalSiteAndPdvId } = require(path.resolve(__dirname, '../../../dbManager/AnagSnowflakesRepository'));
    _getPhysicalSiteAndPdvId = async ({ mainSincom, market, brand, oic }) => {
      const pool = await getPool();
      return getPhysicalSiteAndPdvId(pool, { mainSincom, market, brand, oic });
    };
  }
  return _getPhysicalSiteAndPdvId;
}

// Elenco brand WebDAC (CD_CONTRACT_BRAND_WEBDAC_CODE) per ciascun oic (CODE di
// User.OICs, matchato su cd_paired_oic_code), letto da woc.ang_snowflakes:
// sovrascrive il CSV `brands` fornito da myPeople per ogni oic di session con
// l'elenco effettivo/aggiornato in DB. Stesso cluster Aurora "wiadvisor",
// stesso pool/modulo dbManager gia' impacchettato come cartella sorella di
// session/ (vedi Makefile).
function loadGetBrandsByOics() {
  if (!_getBrandsByOics) {
    const { getPool } = require(path.resolve(__dirname, '../../../dbManager/db'));
    const { getBrandsByOics } = require(path.resolve(__dirname, '../../../dbManager/AnagSnowflakesRepository'));
    _getBrandsByOics = async ({ oics }) => {
      const pool = await getPool();
      return getBrandsByOics(pool, { oics });
    };
  }
  return _getBrandsByOics;
}

// Abilitazione WOC per oic (woc.hq_application_enabling, colonna enablewoc):
// gli oic esplicitamente disabilitati (enablewoc = 0) vengono tolti
// dall'elenco `oics` di session (v. HqRepository.js::getDisabledOics per il
// criterio di default "abilitato" quando manca la riga di configurazione).
// Stesso cluster Aurora "wiadvisor", stesso pool/modulo dbManager gia'
// impacchettato come cartella sorella di session/ (vedi Makefile).
function loadGetDisabledOics() {
  if (!_getDisabledOics) {
    const { getPool } = require(path.resolve(__dirname, '../../../dbManager/db'));
    const { getDisabledOics } = require(path.resolve(__dirname, '../../../dbManager/HqRepository'));
    _getDisabledOics = async (pairs) => {
      const pool = await getPool();
      return getDisabledOics(pool, pairs);
    };
  }
  return _getDisabledOics;
}

// Indirizzo del sito (address/zipcode/city) per oic (woc.addr_snowflakes,
// join con woc.ang_snowflakes su cd_paired_oic_code, v.
// dbManager/HqRepository.js::getAddressByOics): sovrascrive gli stessi campi
// di ciascun oic di session con l'indirizzo effettivo/aggiornato in DB.
// Stesso cluster Aurora "wiadvisor", stesso pool/modulo dbManager gia'
// impacchettato come cartella sorella di session/ (vedi Makefile).
function loadGetAddressByOics() {
  if (!_getAddressByOics) {
    const { getPool } = require(path.resolve(__dirname, '../../../dbManager/db'));
    const { getAddressByOics } = require(path.resolve(__dirname, '../../../dbManager/HqRepository'));
    _getAddressByOics = async ({ oics }) => {
      const pool = await getPool();
      return getAddressByOics(pool, { oics });
    };
  }
  return _getAddressByOics;
}

// Transcodifica del codice brand IURSMA/FCA "raw" (campo OICs[].BRANDS di myPeople,
// es. "00") verso il codice brand "RefTech" atteso da dms/settings (es. "FT").
// Tabella fornita dal business (fonte: myPeople -> dms brand mapping).
// Codice RC ritornato da myPeople readUserProfiles per gli utenti HQ (staff
// Stellantis, non rete dealer): `{"Response":{"RC":121,"STATUS":"HQ users are
// not allowed for this feature.","User":{}}}`. myPeople modella solo profili
// IURSMA della rete dealer, quindi per questi utenti non esiste un profilo da
// leggere (non e' un errore/utente non abilitato).
const HQ_USER_NOT_ALLOWED_RC = 121;

const BRAND_CODE_TO_REFTECH = {
  83: 'AR',
  '00': 'FT',
  70: 'LA',
  57: 'JE',
  55: 'CY',
  77: 'FO',
  66: 'AH',
  56: 'DG',
  58: 'RM',
  30: 'AC',
  31: 'AP',
  33: 'DS',
  43: 'OV',
  97: 'CT',
};

/**
 * MyPeopleDmsSessionRepository — evolutiva del flusso "session": invece di leggere
 * i dati precalcolati da S3 (vedi S3SessionRepository), a partire da uno **username**
 * IURSMA:
 *   1) chiama myPeople readUserProfiles({ username }) per risalire a mercato/dealer/brand
 *      dell'utente;
 *   2) legge le impostazioni DMS del dealer dalla cache woc.dms_settings (NON più una
 *      chiamata live a dms/settings, vedi sotto);
 *   3) restituisce un oggetto con la STESSA forma del JSON storico di S3SessionRepository
 *      (stesse chiavi), valorizzando solo i campi ricavabili da myPeople/dms — gli altri
 *      (es. physicalsite, pdvId, preferenze pezzi, sconti massimi, ...) provengono da
 *      un'altra fonte dati (tabella HQ_DEALERDEFAULTVALUES) non interrogata da questo
 *      flusso e vengono quindi impostati a `null`. In aggiunta alle chiavi storiche,
 *      espone anche `oics` e `applications`: gli interi blocchi User.OICs/User.Applications
 *      di myPeople, con le chiavi di ciascun elemento riportate in minuscolo (stessa
 *      convenzione usata per tutte le altre chiavi di questo oggetto). Espone inoltre
 *      `firstname`/`lastname` (da User.Attributes.FIRSTNAME/LASTNAME) e `profile`
 *      (da User.Applications, campo PROFILE dell'item con APPLICATION="wiADV.DL").
 *      Espone infine `companytypes`/`customertitles`: gli array cache letti dalla
 *      tabella woc.dml_configurations (popolata una volta al giorno dalla lambda
 *      "dmlConfigSync" chiamando dms/getCompanyTypes/dms/getCustomerTitles per i
 *      mercati abilitati), indicizzati per `country`/`language` (da
 *      `Attributes.NATIONiso2`). Mai `null`/eccezione: `[]` se non esiste ancora
 *      una riga cache per il mercato, o se la lettura dal DB fallisce per
 *      qualunque motivo (la disponibilità di questi due campi non deve mai
 *      condizionare il resto della risposta di sessione).
 *
 *      `oics` viene filtrato e arricchito rispetto al blocco grezzo User.OICs
 *      di myPeople:
 *       - un oic (market+code, quest'ultimo matchato su cd_paired_oic_code)
 *         esplicitamente disabilitato in woc.hq_application_enabling
 *         (enablewoc = 0) viene tolto dall'elenco; un oic SENZA riga di
 *         configurazione resta abilitato di default (opt-out, v.
 *         dbManager/HqRepository.js::getDisabledOics) — mai un errore di
 *         lettura blocca la sessione (in quel caso nessun oic viene tolto);
 *       - il campo `brands` di ciascun oic rimasto viene sovrascritto con
 *         l'elenco di codici brand WebDAC (cd_contract_brand_webdac_code)
 *         letto da woc.ang_snowflakes per quell'oic (v.
 *         dbManager/AnagSnowflakesRepository.js::getBrandsByOics), con
 *         fallback al CSV originale di myPeople se l'oic non ha righe
 *         corrispondenti in DB o se la query fallisce;
 *       - i campi `address`/`zipcode`/`city` di ciascun oic vengono
 *         sovrascritti con l'indirizzo del sito (rispettivamente
 *         gn_address_1/cd_zip_code/gn_town) letto da woc.addr_snowflakes per
 *         quell'oic (v. dbManager/HqRepository.js::getAddressByOics), con
 *         fallback ai campi originali di myPeople se l'oic non ha righe
 *         corrispondenti in DB o se la query fallisce.
 *      Ogni elemento di `oics` espone inoltre `brandLogos`: array di logo_s3_key
 *      (tabella woc.anag_brand, stessa usata dalla lambda isStellantisBrand)
 *      risolti a partire dai codici brand CSV del campo `brands` (gia' post-override
 *      DB, es. "30,31,33,43" → ["assets/images/logo/brand-stla/CITROEN.png", ...]).
 *      Stesso principio fault-tolerant delle altre letture DB di questa classe: `[]`
 *      se `brands` è assente/vuoto, se un codice non ha un logo associato, o se la
 *      query fallisce.
 *
 *      Espone inoltre `marketIso`: il codice ISO paese del dealer (colonna
 *      cd_dealer_country_iso_code), letto dalla tabella woc.ang_snowflakes
 *      (snapshot dell'estrazione Snowflake "M2m-queries") a partire dal
 *      `codmarket` dell'utente (`Attributes.MARKETCODE`, colonna cd_market_code).
 *      Stesso principio fault-tolerant delle altre letture DB di questa classe:
 *      `null` se `codmarket` è assente, se non esiste ancora una riga per il
 *      mercato, o se la query fallisce per qualunque motivo (la disponibilità
 *      di questo campo non deve mai condizionare il resto della risposta di
 *      sessione).
 *
 *      `isdml`/`dmlcustomerupdate`/`dmldiscount` (derivati da dms/settings) NON
 *      vengono più ricavati da una chiamata live (dms/authService.getBearerToken +
 *      dms/dmsService.getDmsSettings): sono letti dalla cache woc.dms_settings
 *      (popolata una volta al giorno dalla lambda "dmlConfigSync" chiamando
 *      dms/getDmsSettings per le combinazioni country+brand+dealer abilitate,
 *      tabella woc.dms_settings_enabled_dealers), indicizzata per
 *      `country`/`brand`/`dealer` (da `Attributes.NATIONiso2`, il brand RefTech
 *      del primo OIC principale, `Attributes.MAINSINCOM`). Stesso principio
 *      fault-tolerant di companytypes/customertitles: se la cache non ha ancora
 *      una riga per la combinazione (mai vista prima) o la lettura fallisce, si
 *      ritornano i valori di default (isdml:false, dmlcustomerupdate:null,
 *      dmldiscount:null) SENZA mai bloccare/fallire la sessione — e si registra
 *      (best-effort: awaited ma con errori sempre ignorati/loggati, mai
 *      propagati) la combinazione in woc.dms_settings_enabled_dealers cosi' che
 *      il prossimo giro schedulato di dmlConfigSync la sincronizzi (i dati
 *      diventano quindi disponibili al più tardi il giorno successivo per un
 *      dealer mai visto prima).
 *
 *      Espone infine `physicalsite` (gn_physical_site_arcad) e `pdvId`
 *      (cd_dealer_arcad_code), risolti dalla tabella woc.ang_snowflakes a
 *      partire da mainSincom/market/brand/oic (v. loadGetPhysicalSiteAndPdvId,
 *      stessi criteri di dbManager/AnagSnowflakesRepository.js
 *      ::getPhysicalSiteAndPdvId). Stesso principio fault-tolerant delle
 *      altre letture DB di questa classe: entrambi `null` se manca
 *      mainSincom/market/brand/oic, se non esiste una riga corrispondente, o se
 *      la query fallisce per qualunque motivo.
 *
 *      Utenti HQ (staff Stellantis, non rete dealer, es. "SF48816"): myPeople
 *      modella solo profili IURSMA della rete dealer e per un utente HQ
 *      risponde con `RC=121`/`STATUS="HQ users are not allowed for this
 *      feature."`/`User={}` (v. HQ_USER_NOT_ALLOWED_RC). Questo NON viene
 *      trattato come utente non trovato (404): `getSessionData` ritorna invece
 *      una sessione "vuota" (v. buildHqSessionData — stessa forma/chiavi del
 *      JSON storico, campi dealer-specific `null`/`[]`, `usertype: 'HQ'`),
 *      cosi' un utente HQ legittimo puo' comunque accedere all'app.
 */
class MyPeopleDmsSessionRepository extends SessionRepository {
  constructor({
    readUserProfilesFn,
    getDmsSettingsCacheFn,
    registerDmsSettingsDealerFn,
    getDmlConfigurationFn,
    getBrandLogosFn,
    getCountryIsoCodeFn,
    getPhysicalSiteAndPdvIdFn,
    getBrandsByOicsFn,
    getDisabledOicsFn,
    getAddressByOicsFn,
  } = {}) {
    super();
    this._readUserProfilesFn = readUserProfilesFn;
    this._getDmsSettingsCacheFn = getDmsSettingsCacheFn;
    this._registerDmsSettingsDealerFn = registerDmsSettingsDealerFn;
    this._getDmlConfigurationFn = getDmlConfigurationFn;
    this._getBrandLogosFn = getBrandLogosFn;
    this._getCountryIsoCodeFn = getCountryIsoCodeFn;
    this._getPhysicalSiteAndPdvIdFn = getPhysicalSiteAndPdvIdFn;
    this._getBrandsByOicsFn = getBrandsByOicsFn;
    this._getDisabledOicsFn = getDisabledOicsFn;
    this._getAddressByOicsFn = getAddressByOicsFn;
  }

  /**
   * @param {string} username - Username IURSMA (es. "0073741.d235").
   * @param {object|null} [authProfile] - Profilo utente dall'authorizer (v.
   *   getAuthContext in index.js: sub, given_name, family_name, ...), usato
   *   SOLO per l'utente HQ (myPeople RC=121, v. buildHqSessionData) per
   *   valorizzare `firstname`/`lastname` (given_name/family_name) che
   *   altrimenti resterebbero `null` (myPeople non ha alcun dato per un
   *   utente HQ). Per gli utenti dealer questi campi restano quelli letti
   *   da myPeople (User.Attributes.FIRSTNAME/LASTNAME), mai sovrascritti
   *   dal profilo dell'authorizer.
   * @returns {Promise<object>} Dati di sessione (stessa forma di S3SessionRepository).
   */
  async getSessionData(username, authProfile = null) {
    if (!username) {
      throw new Error('[session] username is required');
    }

    const readUserProfiles = this._readUserProfilesFn || loadReadUserProfiles();
    const peopleResponse = await readUserProfiles({ username });

    const result = peopleResponse && peopleResponse.Response;

    // myPeople modella SOLO i profili della rete dealer (username IURSMA): per
    // un utente HQ (staff Stellantis, es. "SF48816") risponde con RC=121,
    // STATUS="HQ users are not allowed for this feature.", User={} — NON e'
    // un utente inesistente/non abilitato, semplicemente myPeople non ha nulla
    // da restituire per lui. Propagare un 404 (SessionNotFoundError) in
    // questo caso e' quindi errato: si ritorna invece una sessione "vuota"
    // (stessa forma storica, campi dealer-specific a null/[]), cosi' l'utente
    // HQ può comunque accedere all'app.
    if (result && Number(result.RC) === HQ_USER_NOT_ALLOWED_RC) {
      return buildHqSessionData(username, authProfile);
    }

    if (!result || String(result.RC) !== '0' || result.STATUS !== 'SUCCESS' || !result.User) {
      throw new SessionNotFoundError(username, "l'utente");
    }

    const attributes = result.User.Attributes || {};
    const oics = Array.isArray(result.User.OICs) ? result.User.OICs : [];
    const applications = Array.isArray(result.User.Applications) ? result.User.Applications : [];
    const mainOic = oics.find((oic) => oic.MAIN === 'Y') || oics[0] || {};

    const rawBrandCode = mainOic.BRANDS
      ? String(mainOic.BRANDS).split(',')[0].trim()
      : null;
    const brandReftech = rawBrandCode != null && rawBrandCode !== ''
      ? (BRAND_CODE_TO_REFTECH[rawBrandCode] || null)
      : null;

    const iso2 = attributes.NATIONiso2 || null;
    const country = iso2 ? iso2.toLowerCase() : null;
    // woc.dms_settings_enabled_dealers/woc.dms_settings usano country in MAIUSCOLO
    // (stessa convenzione di brandReftech, gia' uppercase via BRAND_CODE_TO_REFTECH),
    // a differenza di woc.dml_configurations che resta in minuscolo (vedi "country"
    // sopra, riusato per companytypes/customertitles e per i campi language/locale
    // della risposta): NON va quindi sostituito "country", solo le chiamate relative
    // a dms/settings usano questa variante.
    const countryDms = iso2 ? iso2.toUpperCase() : null;
    const dealer = attributes.MAINSINCOM || null;

    const wiAdvDlApp = applications.find((app) => app && app.APPLICATION === 'wiADV.DL');

    const getDmsSettingsCache = this._getDmsSettingsCacheFn || loadGetDmsSettingsCache();
    const registerDmsSettingsDealer = this._registerDmsSettingsDealerFn || loadRegisterDmsSettingsDealer();
    const getDmlConfiguration = this._getDmlConfigurationFn || loadGetDmlConfiguration();
    const getBrandLogos = this._getBrandLogosFn || loadGetBrandLogos();
    const getCountryIsoCode = this._getCountryIsoCodeFn || loadGetCountryIsoCode();
    const getPhysicalSiteAndPdvId = this._getPhysicalSiteAndPdvIdFn || loadGetPhysicalSiteAndPdvId();
    const getBrandsByOics = this._getBrandsByOicsFn || loadGetBrandsByOics();
    const getDisabledOics = this._getDisabledOicsFn || loadGetDisabledOics();
    const getAddressByOics = this._getAddressByOicsFn || loadGetAddressByOics();
    const market = attributes.MARKETCODE || null;
    const oic = mainOic.CODE || null;

    // Elenco oic (CODE) e coppie (market, oic) univoche di User.OICs, per le
    // query batch di brand (woc.ang_snowflakes) e abilitazione WOC
    // (woc.hq_application_enabling) sotto: un solo round-trip per tutti gli
    // oic dell'utente invece di una query per oic.
    const oicCodes = Array.from(new Set(
      oics.map((o) => o && o.CODE).filter((code) => code != null && code !== ''),
    ));
    const oicPairsByKey = new Map();
    for (const o of oics) {
      if (o && o.CODE != null && o.CODE !== '' && o.MARKET != null && o.MARKET !== '') {
        oicPairsByKey.set(`${o.MARKET}|${o.CODE}`, { market: o.MARKET, oic: o.CODE });
      }
    }
    const oicPairs = Array.from(oicPairsByKey.values());

    // dms/settings NON è più una chiamata live: si legge la cache woc.dms_settings
    // (country+brand+dealer). Come companytypes/customertitles, un cache-miss o
    // un errore di lettura non deve mai far fallire la sessione: si ritornano i
    // valori di default ({success:false, data:[]} → isdml:false/null/null) e si
    // registra (best-effort) la combinazione per la prossima sync schedulata.
    const [dmsSettings, dmlConfiguration, marketIso, physicalSiteAndSincom, brandsByOic, disabledOicKeys, addressByOic] = await Promise.all([
      (countryDms && brandReftech && dealer)
        ? getDmsSettingsCache({ country: countryDms, brand: brandReftech, dealer })
          .then(async (cached) => {
            if (cached) return cached;
            // Registrazione best-effort (mai bloccante/fallimento propagato): AWAIT
            // esplicito per evitare che la Promise resti "in volo" dopo il return
            // della Lambda (rischio concreto in ambiente Lambda: l'execution
            // environment puo' essere "congelato" subito dopo la risposta, e una
            // Promise non attesa potrebbe non completarsi mai o eseguire su
            // un'invocazione futura con uno stato incoerente).
            await registerDmsSettingsDealer({ country: countryDms, brand: brandReftech, dealer }).catch((err) => {
              console.error(`[session] registrazione dealer dms/settings fallita per country="${countryDms}" brand="${brandReftech}" dealer="${dealer}": ${err.message}`);
            });
            return { success: false, data: [] };
          })
          .catch((err) => {
            console.error(`[session] lettura cache dms/settings fallita per country="${countryDms}" brand="${brandReftech}" dealer="${dealer}": ${err.message}`);
            return { success: false, data: [] };
          })
        : Promise.resolve({ success: false, data: [] }),
      country
        ? getDmlConfiguration({ country, language: country }).catch((err) => {
          console.error(`[session] lettura cache dml/configurations fallita per country="${country}": ${err.message}`);
          return { companyTypes: [], customerTitles: [] };
        })
        : Promise.resolve({ companyTypes: [], customerTitles: [] }),
      market
        ? getCountryIsoCode({ market }).catch((err) => {
          console.error(`[session] lettura marketIso (woc.ang_snowflakes) fallita per market="${market}": ${err.message}`);
          return null;
        })
        : Promise.resolve(null),
      (dealer && market && brandReftech && oic)
        ? getPhysicalSiteAndPdvId({ mainSincom: dealer, market, brand: brandReftech, oic }).catch((err) => {
          console.error(`[session] lettura physicalSite/pdvId (woc.ang_snowflakes) fallita per mainSincom="${dealer}" market="${market}" brand="${brandReftech}" oic="${oic}": ${err.message}`);
          return { physicalSiteId: null, dealerArcadCode: null };
        })
        : Promise.resolve({ physicalSiteId: null, dealerArcadCode: null }),
      oicCodes.length > 0
        ? getBrandsByOics({ oics: oicCodes }).catch((err) => {
          console.error(`[session] lettura brand per oic (woc.ang_snowflakes) fallita: ${err.message}`);
          return new Map();
        })
        : Promise.resolve(new Map()),
      oicPairs.length > 0
        ? getDisabledOics(oicPairs).catch((err) => {
          console.error(`[session] lettura abilitazione oic (woc.hq_application_enabling) fallita: ${err.message}`);
          return new Set();
        })
        : Promise.resolve(new Set()),
      oicCodes.length > 0
        ? getAddressByOics({ oics: oicCodes }).catch((err) => {
          console.error(`[session] lettura indirizzo per oic (woc.addr_snowflakes) fallita: ${err.message}`);
          return new Map();
        })
        : Promise.resolve(new Map()),
    ]);

    // Oic esplicitamente disabilitati (enablewoc = 0 in
    // woc.hq_application_enabling) vengono tolti dall'elenco `oics` di
    // sessione; un oic senza riga di configurazione resta abilitato di
    // default (v. HqRepository.js::getDisabledOics). Un oic con
    // CODE/MARKET mancante non e' verificabile e viene mantenuto per
    // compatibilita' (comportamento storico).
    const enabledOics = oics.filter((o) => {
      if (!o || o.CODE == null || o.MARKET == null) return true;
      return !disabledOicKeys.has(`${o.MARKET}|${o.CODE}`);
    });

    // CSV di codici brand WebDAC per ciascun oic abilitato: sovrascrive il
    // CSV originale di myPeople (oic.BRANDS) con l'elenco effettivo letto da
    // woc.ang_snowflakes (brandsByOic, aggregazione di
    // cd_contract_brand_webdac_code per cd_paired_oic_code = oic.CODE);
    // fallback al CSV originale se l'oic non ha righe corrispondenti in DB.
    const brandsCsvByOicCode = new Map(
      enabledOics
        .filter((o) => o && o.CODE != null)
        .map((o) => [o.CODE, resolveBrandsCsv(o, brandsByOic)]),
    );

    // Indirizzo del sito (address/zipcode/city) per ciascun oic abilitato:
    // sovrascrive gli stessi campi eventualmente forniti da myPeople con
    // l'indirizzo effettivo letto da woc.addr_snowflakes (addressByOic,
    // mappa oic.CODE -> {address, zipcode, city} risolta via join su
    // woc.ang_snowflakes.cd_paired_oic_code); fallback ai campi originali di
    // myPeople se l'oic non ha righe corrispondenti in DB.
    const addressByOicCode = new Map(
      enabledOics
        .filter((o) => o && o.CODE != null)
        .map((o) => [o.CODE, resolveAddressFields(o, addressByOic)]),
    );

    // Tutti i codici brand (deduplicati) effettivamente usati dagli oics
    // abilitati (post-override DB), per un'unica query batch dei loghi
    // (woc.anag_brand) invece di una query per ogni oic.
    const brandCodes = Array.from(new Set(
      Array.from(brandsCsvByOicCode.values())
        .flatMap((csv) => (csv ? csv.split(',') : []))
        .map((code) => code.trim())
        .filter((code) => code !== ''),
    ));

    const brandLogosByCode = brandCodes.length > 0
      ? await getBrandLogos({ codes: brandCodes }).catch((err) => {
        console.error(`[session] lettura loghi brand (woc.anag_brand) fallita: ${err.message}`);
        return {};
      })
      : {};

    const dmsMap = buildDmsSettingsMap(dmsSettings);

    return {
      username,
      codmarket: attributes.MARKETCODE || null,
      marketIso,
      oic,
      sincom: dealer,
      firstname: attributes.FIRSTNAME || null,
      lastname: attributes.LASTNAME || null,
      profile: (wiAdvDlApp && wiAdvDlApp.PROFILE) || null,
      physicalsite: physicalSiteAndSincom.physicalSiteId ?? null,
      pdvId: physicalSiteAndSincom.dealerArcadCode ?? null,
      sessionbrand: rawBrandCode,
      inmandate: null,
      language: iso2 ? iso2.toLowerCase() : null,
      locale: iso2 ? `${iso2.toLowerCase()}_${iso2}` : null,
      isdml: dmsSettings && dmsSettings.success === true,
      dmlcustomerupdate: dmsMap.get('knowncustomerupdate') ?? dmsMap.get('accountcustomerupdate') ?? null,
      dmldiscount: findDiscountValue(dmsMap),
      brandvehic_genome: null,
      brandvehic_reftech: brandReftech,
      brandvehic_fca: rawBrandCode,
      pkwstouse: null,
      vat: null,
      usertype: attributes.USERTYPE || null,
      interiorcarwash: null,
      exteriorcarwash: null,
      partpref_old: null,
      partpref_original: null,
      partpref_returned: null,
      partpref_circularec: null,
      pcydealer1: null,
      pcydealer2: null,
      pcydealer3: null,
      pcystellantis1: null,
      pcystellantis2: null,
      pcystellantis3: null,
      maxdiscountperc: null,
      maxdiscountval: null,
      oics: enabledOics.map((oic) => buildOicWithBrandLogos(oic, brandLogosByCode, brandsCsvByOicCode.get(oic.CODE), addressByOicCode.get(oic.CODE))),
      applications: applications.map(lowercaseKeys),
      companytypes: Array.isArray(dmlConfiguration && dmlConfiguration.companyTypes)
        ? dmlConfiguration.companyTypes
        : [],
      customertitles: Array.isArray(dmlConfiguration && dmlConfiguration.customerTitles)
        ? dmlConfiguration.customerTitles
        : [],
    };
  }
}

/**
 * Sessione "vuota" per un utente HQ (myPeople RC=121, v. HQ_USER_NOT_ALLOWED_RC):
 * stessa forma/chiavi del JSON storico restituito per un dealer, ma con tutti i
 * campi non derivabili (nessun dato myPeople/dms disponibile per un utente HQ)
 * a `null`/`[]`. `usertype: 'HQ'` permette al chiamante di distinguere questo
 * caso da un dealer con `usertype` non valorizzato.
 *
 * `firstname`/`lastname` sono l'unica eccezione: essendo assenti in myPeople
 * per un utente HQ, vengono valorizzati da `authProfile.given_name`/
 * `authProfile.family_name` (profilo canonico dell'authorizer, v.
 * getAuthContext in index.js), se disponibile; altrimenti restano `null`.
 *
 * @param {string} username - Username HQ (es. "SF48816").
 * @param {object|null} [authProfile] - Profilo utente dall'authorizer (given_name/family_name).
 * @returns {object} Dati di sessione con la stessa forma di un utente dealer.
 */
function buildHqSessionData(username, authProfile) {
  return {
    username,
    codmarket: null,
    marketIso: null,
    oic: null,
    sincom: null,
    firstname: (authProfile && authProfile.given_name) || null,
    lastname: (authProfile && authProfile.family_name) || null,
    profile: null,
    physicalsite: null,
    pdvId: null,
    sessionbrand: null,
    inmandate: null,
    language: null,
    locale: null,
    isdml: false,
    dmlcustomerupdate: null,
    dmldiscount: null,
    brandvehic_genome: null,
    brandvehic_reftech: null,
    brandvehic_fca: null,
    pkwstouse: null,
    vat: null,
    usertype: 'HQ',
    interiorcarwash: null,
    exteriorcarwash: null,
    partpref_old: null,
    partpref_original: null,
    partpref_returned: null,
    partpref_circularec: null,
    pcydealer1: null,
    pcydealer2: null,
    pcydealer3: null,
    pcystellantis1: null,
    pcystellantis2: null,
    pcystellantis3: null,
    maxdiscountperc: null,
    maxdiscountval: null,
    oics: [],
    applications: [],
    companytypes: [],
    customertitles: [],
  };
}

/** Restituisce una copia dell'oggetto con tutte le chiavi di primo livello in minuscolo. */
function lowercaseKeys(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    result[key.toLowerCase()] = value;
  }
  return result;
}

/**
 * Come lowercaseKeys, ma inserisce anche `djcListParameter` subito dopo la
 * chiave `code` (parametro richiesto dall'integrazione DJC, ottenuto
 * concatenando `market` e `code` del singolo OIC con "_", es.
 * "1000_00010925") e sovrascrive `brands` con `brandsCsvOverride` (il CSV di
 * codici brand WebDAC letto da woc.ang_snowflakes per questo oic, v.
 * resolveBrandsCsv/getBrandsByOics — fallback al CSV originale di myPeople
 * se l'override non e' disponibile), inserendo subito dopo `brandLogos`
 * (array di logo_s3_key risolti a partire dal CSV di codici brand,
 * `brandLogosByCode`: mappa codbrand -> logo_s3_key già letta da
 * woc.anag_brand). Sovrascrive inoltre `address`/`zipcode`/`city` con
 * `addressOverride` (v. resolveAddressFields/getAddressByOics — gia' con
 * fallback ai campi originali di myPeople se l'oic non ha righe in DB),
 * inserendoli anche se assenti nell'oic originale.
 */
function buildOicWithBrandLogos(oic, brandLogosByCode, brandsCsvOverride, addressOverride) {
  const lowered = lowercaseKeys(oic);
  const result = {};
  let brandsInserted = false;
  const addressKeys = new Set(['address', 'zipcode', 'city']);
  for (const [key, value] of Object.entries(lowered)) {
    if (key === 'brands') {
      const brandsCsv = brandsCsvOverride != null ? brandsCsvOverride : value;
      result.brands = brandsCsv;
      result.brandLogos = resolveBrandLogos(brandsCsv, brandLogosByCode);
      brandsInserted = true;
      continue;
    }
    if (addressKeys.has(key)) {
      result[key] = addressOverride ? addressOverride[key] : value;
      continue;
    }
    result[key] = value;
    if (key === 'code') {
      result.djcListParameter = builddjcListParameter(lowered.market, lowered.code);
    }
  }
  if (!brandsInserted) {
    const brandsCsv = brandsCsvOverride != null ? brandsCsvOverride : '';
    result.brands = brandsCsv;
    result.brandLogos = resolveBrandLogos(brandsCsv, brandLogosByCode);
  }
  if (addressOverride) {
    for (const key of addressKeys) {
      if (!(key in result)) result[key] = addressOverride[key];
    }
  }
  if (!('djcListParameter' in result)) {
    result.djcListParameter = builddjcListParameter(lowered.market, lowered.code);
  }
  return result;
}

/** Concatena market e code (in questo ordine, separati da "_") per il parametro djcListParameter; null se uno dei due manca. */
function builddjcListParameter(market, code) {
  if (market == null || code == null) return null;
  return `${market}_${code}`;
}

/** Risolve il CSV di codici brand (es. "30,31,33,43") in un array di logo_s3_key, scartando i codici senza logo noto. */
function resolveBrandLogos(brandsCsv, brandLogosByCode) {
  if (typeof brandsCsv !== 'string' || brandsCsv.trim() === '') return [];
  const map = brandLogosByCode || {};
  return brandsCsv
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '')
    .map((code) => map[code])
    .filter((logo) => typeof logo === 'string' && logo.trim() !== '');
}

/**
 * CSV di codici brand WebDAC per un oic: usa l'elenco letto da
 * woc.ang_snowflakes (brandsByOic, mappa oic.CODE -> string[], v.
 * dbManager/AnagSnowflakesRepository.js::getBrandsByOics) se presente e non
 * vuoto, altrimenti ricade sul CSV originale fornito da myPeople
 * (oic.BRANDS) — mai `null`, `''` se nessuna delle due fonti ha dati.
 */
function resolveBrandsCsv(oic, brandsByOic) {
  if (!oic || oic.CODE == null) return (oic && oic.BRANDS) || '';
  const dbBrands = brandsByOic.get(oic.CODE);
  if (Array.isArray(dbBrands) && dbBrands.length > 0) return dbBrands.join(',');
  return oic.BRANDS || '';
}

/**
 * Indirizzo del sito (address/zipcode/city) per un oic: usa l'indirizzo
 * letto da woc.addr_snowflakes (addressByOic, mappa oic.CODE -> {address,
 * zipcode, city}, v. dbManager/HqRepository.js::getAddressByOics) se
 * presente, altrimenti ricade sui campi originali forniti da myPeople
 * (oic.ADDRESS/oic.ZIPCODE/oic.CITY) — mai `undefined`, `null` se nessuna
 * delle due fonti ha il dato.
 */
function resolveAddressFields(oic, addressByOic) {
  const dbAddress = (oic && oic.CODE != null) ? addressByOic.get(oic.CODE) : undefined;
  return {
    address: (dbAddress && dbAddress.address) || (oic && oic.ADDRESS) || null,
    zipcode: (dbAddress && dbAddress.zipcode) || (oic && oic.ZIPCODE) || null,
    city: (dbAddress && dbAddress.city) || (oic && oic.CITY) || null,
  };
}

/** Costruisce una Map(key minuscolo -> valore coerentemente tipizzato) dall'array data di dms/settings. */
function buildDmsSettingsMap(dmsSettings) {
  const map = new Map();
  const data = Array.isArray(dmsSettings && dmsSettings.data) ? dmsSettings.data : [];
  for (const entry of data) {
    if (!entry || !entry.key) continue;
    map.set(String(entry.key).toLowerCase(), coerceDmsValue(entry));
  }
  return map;
}

/** Converte value in base a format ("boolean" -> bool, "number" -> number, altrimenti stringa as-is). */
function coerceDmsValue(entry) {
  const { value, format } = entry;
  if (format === 'boolean') return String(value).toUpperCase() === 'TRUE';
  if (format === 'number') return Number(value);
  return value;
}

/** Cerca nella mappa una key che contenga "discount" (case-insensitive); null se assente. */
function findDiscountValue(dmsMap) {
  for (const [key, value] of dmsMap.entries()) {
    if (key.includes('discount')) return value;
  }
  return null;
}

module.exports = { MyPeopleDmsSessionRepository };
