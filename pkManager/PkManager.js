'use strict';

const path   = require('path');
const dotenv = require('dotenv');

// Carica il .env di pkManager, poi i .env dei moduli fratello (senza sovrascrivere
// variabili già definite). Questo garantisce che EPER_HOST, MENUPRICING_WSDL,
// DOCSOA_HOST, ecc. siano disponibili quando i client vengono richiesti.
dotenv.config();
for (const sibling of ['pkEper', 'pkDocsoa', 'pkMenupricing']) {
  dotenv.config({ path: path.resolve(__dirname, `../${sibling}/.env`) });
}

// ─── Configurazione pacchetti per ws ──────────────────────────────────────────
// Mappa statica: pkwstouse → categoria → lista codici
const CONFIG_PACKAGES = {
  eper: {
    BODY: [
      '7210E221'
    ],
    MECHANICH: [
    ],
    ACCESSORIES: [
    ],
  },

  docsoa: {
    ACCESSORIES: [
      '95R04A',
      '95R10A',
      '64E91A',
      '64EADA',
    ],
    MECHANICH: [
      '220800985012',
      '020320055471',
      '42001A',
      '42055A',
      '44001A',
      '95R02A01FR0101',
      '95R02A01FR0201',
      '95R02A01FR0XXX',
      '98B11A',
      '98B12A',
      '020120055467',
      '020120055468',
      '020120055469',
      '42025A',
      '42120A',
      '44020A',
    ],
  },

  menupricing: {
    BODY: [
      '221000135012'
    ],
    MECHANICH: [
    ],
    ACCESSORIES: [
    ],
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// Classe PkManager
// ═══════════════════════════════════════════════════════════════════════════════

class PkManager {
  /**
   * @param {object} [wsConfig]              Parametri WS-specifici (override di .env)
   * @param {object} [wsConfig.eper]         { coddealer, codmarket, lingua, ticket }
   * @param {object} [wsConfig.docsoa]       { codbrand, ldp, langue, pays, codePdv, typeInternet }
   * @param {object} [wsConfig.menupricing]  { languageCode, countryCode, dealerIdentificationCode, manufacturer }
   */
  constructor(wsConfig = {}) {
    this.wsConfig = {
      eper: {
        coddealer: process.env.EPER_CODDEALER,
        codmarket: process.env.EPER_CODMARKET,
        lingua:    process.env.EPER_LINGUA ?? 'IT',
        ticket:    process.env.EPER_TICKET  ?? null,
        ...wsConfig.eper,
      },
      docsoa: {
        codbrand:     process.env.DOCSOA_CODBRAND,
        ldp:          process.env.DOCSOA_LDP          ?? '',
        langue:       process.env.DOCSOA_LANGUE,
        pays:         process.env.DOCSOA_PAYS,
        codePdv:      process.env.DOCSOA_CODEPDV,
        typeInternet: process.env.DOCSOA_TYPE_INTERNET ?? null,
        ...wsConfig.docsoa,
      },
      menupricing: {
        languageCode:             process.env.MP_LANGUAGE_CODE,
        countryCode:              process.env.MP_COUNTRY_CODE,
        dealerIdentificationCode: process.env.MP_DEALER_IDENTIFICATION_CODE,
        manufacturer:             process.env.MP_MANUFACTURER,
        ...wsConfig.menupricing,
      },
    };
  }

  // ── getConfigPackages ────────────────────────────────────────────────────────
  // Restituisce la mappa categoria → [codici] per il ws specificato.
  //
  // @param {string} market      - Codice mercato (es. '1000'). Riservato per
  //                               future personalizzazioni per mercato.
  // @param {string} pkwstouse   - Identificativo del web service:
  //                               'eper' | 'docsoa' | 'menupricing'
  // @returns {object}           - { BODY?: [...], MECHANICH?: [...], ACCESSORIES?: [...] }
  //                               Lancia Error se pkwstouse non è riconosciuto.
  getConfigPackages(market, pkwstouse) {
    const key = (pkwstouse ?? '').toLowerCase();
    const config = CONFIG_PACKAGES[key];

    if (!config) {
      throw new Error(
        `pkwstouse non riconosciuto: "${pkwstouse}". ` +
        `Valori ammessi: ${Object.keys(CONFIG_PACKAGES).join(', ')}`
      );
    }

    return config;
  }

  // ── getValidPackages ─────────────────────────────────────────────────────────
  // Restituisce l'intersezione tra i pacchetti configurati (getConfigPackages)
  // e quelli effettivamente disponibili per il VIN sul WS corrispondente.
  //
  // @param {string} market     - Codice mercato
  // @param {string} pkwstouse  - 'eper' | 'docsoa' | 'menupricing'
  // @param {string} VIN        - VIN del veicolo
  // @returns {object}          - { BODY?: { [codice]: obj }, MECHANICH?: {...}, ACCESSORIES?: {...} }
  //                              Solo le categorie con almeno un codice valido sono incluse.
  async getValidPackages(market, pkwstouse, VIN) {
    // Step 1: configurazione locale
    const config = this.getConfigPackages(market, pkwstouse);

    // Step 2: pacchetti live dal WS
    const liveMap = await this._fetchLiveMap(pkwstouse, VIN);

    // Step 3: intersezione — mantieni solo i codici config presenti nel live
    const result = {};
    for (const [category, codes] of Object.entries(config)) {
      const matched = {};
      for (const code of codes) {
        if (Object.prototype.hasOwnProperty.call(liveMap, code)) {
          matched[code] = liveMap[code];
        }
      }
      if (Object.keys(matched).length > 0) {
        result[category] = matched;
      }
    }
    console.log('\n▶  getValidPackages result:', JSON.stringify(result, null, 2));

    return result;
  }

  // ── getValidPackagesDetail ───────────────────────────────────────────────────
  // Restituisce il dettaglio di ciascun pacchetto valido per il VIN.
  // Chiama getValidPackages poi, in parallelo, il metodo di dettaglio specifico
  // per il ws indicato.
  //
  // @param {string} market     - Codice mercato
  // @param {string} pkwstouse  - 'eper' | 'docsoa' | 'menupricing'
  // @param {string} VIN        - VIN del veicolo
  // @returns {object}          - { [codice]: detailData }
  async getValidPackagesDetail(market, pkwstouse, VIN) {
    const validPkgs = await this.getValidPackages(market, pkwstouse, VIN);

    // Raccoglie tutti i codici attraverso le categorie
    const entries = [];
    for (const categoryMap of Object.values(validPkgs)) {
      for (const [code, rowData] of Object.entries(categoryMap)) {
        entries.push({ code, rowData });
      }
    }

    if (entries.length === 0) return {};

    // Chiamate al dettaglio in parallelo — un errore su un singolo codice
    // non interrompe le altre
    const tasks = entries.map(({ code, rowData }) =>
      this._fetchDetail(pkwstouse, VIN, code, rowData)
        .then(detail  => ({ code, detail }))
        .catch(err    => ({ code, detail: { error: err.message ?? String(err) } }))
    );

    const results = await Promise.all(tasks);

    const detailMap = {};
    for (const { code, detail } of results) {
      detailMap[code] = detail;
    }

    return detailMap;
  } 

  // ── _fetchDetail ─────────────────────────────────────────────────────────────
  // Chiama il metodo di dettaglio specifico per ws e codice pacchetto.
  async _fetchDetail(pkwstouse, VIN, code, rowData) {
    const key = (pkwstouse ?? '').toLowerCase();

    if (key === 'eper') {
      const { WsIQPckEper } = require(path.resolve(__dirname, '../pkEper/WsIQPckEper'));
      const cfg    = this.wsConfig.eper;
      const client = new WsIQPckEper({ coddealer: cfg.coddealer, codmarket: cfg.codmarket });
      console.log(`\n[DEBUG eper _fetchDetail] rowData:`, JSON.stringify(rowData, null, 2));
      const codicePosizione      = rowData.$?.codicePosizione ?? rowData.codicePosizione ?? '';
      const codicePosizioneGuida = rowData.$?.posizioneGuida  ?? rowData.posizioneGuida  ?? '';
      console.log(`[DEBUG] posizione="${codicePosizione}"  posizioneGuida="${codicePosizioneGuida}"`);
      return client.getPackageDetailsPR({
        ticket:              cfg.ticket,
        lingua:              cfg.lingua,
        VIN,
        codicePacchetto:     code,
        codicePosizione,
        codicePosizioneGuida,
      });
    }

    if (key === 'menupricing') {
      const { MenuPricingSoapClient } = require(path.resolve(__dirname, '../pkMenupricing/MenuPricingSoapClient'));
      const cfg    = this.wsConfig.menupricing;
      const client = new MenuPricingSoapClient();
      return client.getJobDetails({ ...cfg, vin: VIN, id: code });
    }

    if (key === 'docsoa') {
      const { DocSOARestClient } = require(path.resolve(__dirname, '../pkDocsoa/DocSOARestClient'));
      const cfg    = this.wsConfig.docsoa;
      const client = new DocSOARestClient();
      return client.ibxDetailForfaitService({
        wmi:     VIN.substring(0, 3),
        vds:     VIN.substring(3, 9),
        vis:     VIN.substring(9, 17),
        langue:  cfg.langue,
        pays:    cfg.pays,
        marque:  cfg.codbrand,
        paysUser: cfg.pays,
        mode:    'MODE_XML',
        codeFF:  code,
        codePdv: cfg.codePdv,
      });
    }

    throw new Error(`pkwstouse non riconosciuto: "${pkwstouse}"`);
  }

  // ── _fetchLiveMap ────────────────────────────────────────────────────────────
  // Chiama il WS appropriato e normalizza il risultato in { [codice]: obj }
  async _fetchLiveMap(pkwstouse, VIN) {
    const key = (pkwstouse ?? '').toLowerCase();

    if (key === 'eper') {
      const { WsIQPckEper } = require(path.resolve(__dirname, '../pkEper/WsIQPckEper'));
      const cfg    = this.wsConfig.eper;
      const client = new WsIQPckEper({ coddealer: cfg.coddealer, codmarket: cfg.codmarket });
      const result = await client.getCompletePkEperList({ ticket: cfg.ticket, lingua: cfg.lingua, vin: VIN });
      if (result?.error) throw new Error(`eper: ${result.error.errorMessage}`);
      return result; // già { [codice]: obj }
    }

    if (key === 'menupricing') {
      const { MenuPricingSoapClient } = require(path.resolve(__dirname, '../pkMenupricing/MenuPricingSoapClient'));
      const cfg    = this.wsConfig.menupricing;
      const client = new MenuPricingSoapClient();
      const result = await client.getCompletePkMpList({ vin: VIN, ...cfg });
      if (!result.success) throw new Error(`menupricing: ${result.message}`);
      return result.data ?? {}; // già { [codice]: obj }
    }

    if (key === 'docsoa') {
      const { DocSOARestClient } = require(path.resolve(__dirname, '../pkDocsoa/DocSOARestClient'));
      const cfg    = this.wsConfig.docsoa;
      const client = new DocSOARestClient();
      const result = await client.getCompletePkSOAList({ vin: VIN, ...cfg });
      if (!result.success) throw new Error(`docsoa: ${result.message}`);
      // data è un array di oggetti XML decodificati → prova a indicizzare per campi codice comuni
      return buildDocsoaMap(result.data ?? []);
    }

    throw new Error(`pkwstouse non riconosciuto: "${pkwstouse}"`);
  }
}

// ─── Helper: converte l'array docsoa in { [codice]: obj } ─────────────────────
// I campi candidati per il codice sono i più comuni nelle risposte PSA DocSOA.
// Se nessun campo è trovato, effettua una ricerca per contenuto (JSON stringify).
function buildDocsoaMap(dataArr) {
  const CODE_FIELDS = ['id', 'code', 'codice', 'codeFF', 'refForfait', 'fonctionId', 'idFunction'];
  const map = {};

  for (const item of toArray(dataArr)) {
    let code = null;
    for (const field of CODE_FIELDS) {
      if (item?.[field] && typeof item[field] === 'string') {
        code = item[field];
        break;
      }
    }
    if (code) {
      map[code] = item;
    }
  }

  return map;
}

// ─── Helper: normalizza a array ────────────────────────────────────────────────
function toArray(val) {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

module.exports = { PkManager };
