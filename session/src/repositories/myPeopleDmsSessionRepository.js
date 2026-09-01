'use strict';

const path = require('path');
const { SessionRepository } = require('./sessionRepository');
const { SessionNotFoundError } = require('../errors');

// Cross-lambda-folder require, stesso pattern già usato da pkManager/PkManager.js
// per dms/pkEper/pkDocsoa/pkMenupricing (require(path.resolve(__dirname, '../dms/...'))):
// il build di SessionFunction (Metadata: BuildMethod: makefile, vedi Makefile) impacchetta
// myPeople/ e dms/ come cartelle sorelle di session/ dentro l'artifact di deploy, cosi'
// questi require relativi continuano a risolvere correttamente anche a runtime in Lambda.
// Caricati "on demand" (lazy) invece che in cima al file: myPeople/config.js e dms/config.js
// validano le proprie variabili d'ambiente non appena richiesti, e nei test unitari questa
// repository viene istanziata con le funzioni già iniettate (vedi costruttore), senza mai
// toccare i moduli reali.
let _readUserProfiles;
let _getBearerToken;
let _getDmsSettings;
let _getDmlConfiguration;

function loadReadUserProfiles() {
  if (!_readUserProfiles) {
    ({ readUserProfiles: _readUserProfiles } = require(path.resolve(__dirname, '../../../myPeople/myPeopleService')));
  }
  return _readUserProfiles;
}

function loadGetBearerToken() {
  if (!_getBearerToken) {
    ({ getBearerToken: _getBearerToken } = require(path.resolve(__dirname, '../../../dms/authService')));
  }
  return _getBearerToken;
}

function loadGetDmsSettings() {
  if (!_getDmsSettings) {
    ({ getDmsSettings: _getDmsSettings } = require(path.resolve(__dirname, '../../../dms/dmsService')));
  }
  return _getDmsSettings;
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

// Transcodifica del codice brand IURSMA/FCA "raw" (campo OICs[].BRANDS di myPeople,
// es. "00") verso il codice brand "RefTech" atteso da dms/settings (es. "FT").
// Tabella fornita dal business (fonte: myPeople -> dms brand mapping).
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
 *   2) con questi dati chiama dms/settings (getBearerToken + getDmsSettings) per le
 *      impostazioni DMS del dealer;
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
 */
class MyPeopleDmsSessionRepository extends SessionRepository {
  constructor({
    readUserProfilesFn,
    getBearerTokenFn,
    getDmsSettingsFn,
    getDmlConfigurationFn,
  } = {}) {
    super();
    this._readUserProfilesFn = readUserProfilesFn;
    this._getBearerTokenFn = getBearerTokenFn;
    this._getDmsSettingsFn = getDmsSettingsFn;
    this._getDmlConfigurationFn = getDmlConfigurationFn;
  }

  /**
   * @param {string} username - Username IURSMA (es. "0073741.d235").
   * @returns {Promise<object>} Dati di sessione (stessa forma di S3SessionRepository).
   */
  async getSessionData(username) {
    if (!username) {
      throw new Error('[session] username is required');
    }

    const readUserProfiles = this._readUserProfilesFn || loadReadUserProfiles();
    const peopleResponse = await readUserProfiles({ username });

    const result = peopleResponse && peopleResponse.Response;
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
    const dealer = attributes.MAINSINCOM || null;

    const wiAdvDlApp = applications.find((app) => app && app.APPLICATION === 'wiADV.DL');

    const getBearerToken = this._getBearerTokenFn || loadGetBearerToken();
    const getDmsSettings = this._getDmsSettingsFn || loadGetDmsSettings();
    const getDmlConfiguration = this._getDmlConfigurationFn || loadGetDmlConfiguration();

    let token;
    try {
      token = await getBearerToken();
    } catch (err) {
      throw new Error(`[session] dms/settings failed: ${err.message}`);
    }

    // dms/settings resta una chiamata live (stesso bearer token/credenziali IBM).
    // La lettura della cache company-types/customer-titles (woc.dml_configurations)
    // è invece indipendente dal bearer token DML e non deve mai far fallire la
    // sessione: un problema di connettività al DB (o l'assenza di una riga cache
    // per il mercato) si traduce semplicemente in `[]`, non in un'eccezione.
    const [dmsSettings, dmlConfiguration] = await Promise.all([
      getDmsSettings(token, { country, brand: brandReftech, dealer }).catch((err) => {
        throw new Error(`[session] dms/settings failed: ${err.message}`);
      }),
      country
        ? getDmlConfiguration({ country, language: country }).catch((err) => {
          console.error(`[session] lettura cache dml/configurations fallita per country="${country}": ${err.message}`);
          return { companyTypes: [], customerTitles: [] };
        })
        : Promise.resolve({ companyTypes: [], customerTitles: [] }),
    ]);

    const dmsMap = buildDmsSettingsMap(dmsSettings);

    return {
      codmarket: attributes.MARKETCODE || null,
      oic: mainOic.CODE || null,
      sincom: dealer,
      firstname: attributes.FIRSTNAME || null,
      lastname: attributes.LASTNAME || null,
      profile: (wiAdvDlApp && wiAdvDlApp.PROFILE) || null,
      physicalsite: null,
      pdvId: null,
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
      oics: oics.map(lowercaseKeys),
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

/** Restituisce una copia dell'oggetto con tutte le chiavi di primo livello in minuscolo. */
function lowercaseKeys(obj) {
  const result = {};
  for (const [key, value] of Object.entries(obj || {})) {
    result[key.toLowerCase()] = value;
  }
  return result;
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
