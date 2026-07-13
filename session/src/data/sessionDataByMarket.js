'use strict';

/**
 * Valori predefiniti (mock) dei dati di sessione, parametrizzati per mercato (codmarket).
 * Verranno sostituiti a runtime dal DbSessionProvider quando SESSION_DATA_SOURCE=db
 * (la query verso il DB andra' filtrata per codmarket, vedi providers/dbSessionProvider.js).
 *
 * Nota sul campo "usertype/profilo": rappresentato con la chiave "usertype"
 * (in italiano "profilo utente"), per avere una chiave JSON valida e univoca.
 */

const DEFAULT_MARKET = '1000';

const SESSION_DATA_BY_MARKET = {
  '1000': {
    codmarket: '1000',
    oic: '000123456',
    sincom: '0073741',
    physicalsite: '00007531',
    pdvId: 'PDV000456',
    sessionbrand: '00',
    inmandate: true,
    language: 'it_IT',
    isdml: true,
    dmlcustomerupdate: false,
    dmldiscount: true,
    brandvehic_genome: '0I',
    brandvehic_reftech: 'FT',
    brandvehic_fca: '00',
    pkwstouse: '',
    vat: 0.22,
    usertype: 'DEALER',
    interiorcarwash: false,
    exteriorcarwash: false,
    partpref_old: false,
    partpref_original: true,
    partpref_returned: false,
    partpref_circularec: false,
    pcydealer1: 0,
    pcydealer2: 0,
    pcydealer3: 0,
    pcystellantis1: 0,
    pcystellantis2: 0,
    pcystellantis3: 0,
    maxdiscountperc: 20,
    maxdiscountval: 500,
  },

  '3109': {
    codmarket: '3109',
    oic: '000223456',
    sincom: 'SIN00223',
    physicalsite: '00007532',
    pdvId: 'PDV000556',
    sessionbrand: 'AP',
    inmandate: true,
    language: 'fr_FR',
    isdml: true,
    dmlcustomerupdate: false,
    dmldiscount: true,
    brandvehic_genome: '0I',
    brandvehic_reftech: 'FT',
    brandvehic_fca: '00',
    pkwstouse: 'PKW02',
    vat: 0.22,
    usertype: 'DEALER',
    interiorcarwash: true,
    exteriorcarwash: false,
    partpref_old: false,
    partpref_original: true,
    partpref_returned: false,
    partpref_circularec: true,
    pcydealer1: 0,
    pcydealer2: 0,
    pcydealer3: 0,
    pcystellantis1: 0,
    pcystellantis2: 0,
    pcystellantis3: 0,
    maxdiscountperc: 15,
    maxdiscountval: 400,
  },

  '3110': {
    codmarket: '3110',
    oic: '000323456',
    sincom: 'SIN00323',
    physicalsite: '00007533',
    pdvId: 'PDV000656',
    sessionbrand: 'FT',
    inmandate: false,
    language: 'de_DE',
    isdml: false,
    dmlcustomerupdate: false,
    dmldiscount: false,
    brandvehic_genome: '0I',
    brandvehic_reftech: 'FT',
    brandvehic_fca: '00',
    pkwstouse: 'PKW03',
    vat: 0.22,
    usertype: 'DEALER',
    interiorcarwash: false,
    exteriorcarwash: true,
    partpref_old: true,
    partpref_original: false,
    partpref_returned: false,
    partpref_circularec: false,
    pcydealer1: 0,
    pcydealer2: 0,
    pcydealer3: 0,
    pcystellantis1: 0,
    pcystellantis2: 0,
    pcystellantis3: 0,
    maxdiscountperc: 25,
    maxdiscountval: 600,
  },
};

/**
 * Restituisce i dati predefiniti per il mercato richiesto.
 * Se il mercato non e' tra quelli mappati, ricade sul mercato di default (IT)
 * ma sovrascrive comunque `codmarket` con il valore richiesto, cosi' da segnalare
 * chiaramente in output quale mercato e' stato interrogato.
 *
 * @param {string} [codmarket] - Codice mercato (es. "IT", "FR", "DE").
 * @returns {object}
 */
function getSessionDataForMarket(codmarket) {
  const market = (codmarket || DEFAULT_MARKET).toUpperCase();
  const data = SESSION_DATA_BY_MARKET[market] || SESSION_DATA_BY_MARKET[DEFAULT_MARKET];
  return { ...data, codmarket: market };
}

module.exports = {
  DEFAULT_MARKET,
  SESSION_DATA_BY_MARKET,
  getSessionDataForMarket,
};
