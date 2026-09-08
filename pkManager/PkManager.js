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

// ─── Concorrenza chiamate di dettaglio ─────────────────────────────────────────
// Alcuni WS legacy (in particolare MenuPricing, che mantiene stato lato server
// per dealer/sessione) possono restituire risposte "incrociate" o duplicate tra
// richieste realmente concorrenti, producendo un pkDetailList non deterministico
// e con codici duplicati/mancanti tra una chiamata e l'altra a parità di
// argomenti. Di default le chiamate di dettaglio vengono quindi serializzate;
// il valore è comunque configurabile via env per i WS che si dimostrano stabili
// sotto concorrenza.
const DETAIL_FETCH_CONCURRENCY = Number(process.env.PK_DETAIL_FETCH_CONCURRENCY) || 1;

// ─── Helper: esegue una lista di task (funzioni che ritornano Promise) con
// concorrenza limitata. Le task NON devono essere Promise già avviate: devono
// essere funzioni, altrimenti sarebbero già tutte "in volo" prima ancora che
// pLimit possa applicare il limite.
async function pLimit(taskFns, concurrency) {
  const results = new Array(taskFns.length);
  let next = 0;

  async function worker() {
    while (next < taskFns.length) {
      const i = next++;
      results[i] = await taskFns[i]();
    }
  }

  await Promise.all(Array.from({ length: Math.max(1, concurrency) }, worker));
  return results;
}

// ─── Configurazione pacchetti per ws ──────────────────────────────────────────
// Mappa statica: pkwstouse → categoria → lista codici
const CONFIG_PACKAGES = {
  eper: {
    BODY: [
      '7210E221',
      '7015A041'
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
      '44020A'

    ],
  },

  menupricing: {
    BODY: [
      '221000135012',
      '054065105278',
      '054065305427',
      '054065505280',
      '054065705406',
      '054065905276',
      '054066105400'
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
    // Array dei dettagli pacchetto valorizzato da getValidPackagesDetail()
    this.pkDetailList = [];

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
  // @param {string} market      - Codice mercato (es. '1000'). Riservato per a
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
          matched[code] = { ...liveMap[code], category };
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
    console.log('[PkManager.getValidPackagesDetail] parametri chiamata:', { market, pkwstouse, VIN });
    const validPkgs = await this.getValidPackages(market, pkwstouse, VIN);

    // Raccoglie tutti i codici attraverso le categorie
    const entries = [];
    for (const categoryMap of Object.values(validPkgs)) {
      for (const [code, rowData] of Object.entries(categoryMap)) {
        entries.push({ code, rowData });
      }
    }

    if (entries.length === 0) return {};

    // Chiamate al dettaglio con concorrenza limitata (vedi DETAIL_FETCH_CONCURRENCY
    // sopra): i WS legacy (in particolare MenuPricing, stateful sul dealer/sessione)
    // possono "confondere" le risposte quando ricevono più richieste realmente in
    // parallelo, restituendo il dettaglio sbagliato/duplicato per alcuni codici in
    // modo non deterministico. Le task sono funzioni (non Promise già avviate),
    // così pLimit ne controlla davvero l'avvio; un errore su un singolo codice
    // non interrompe le altre.
    const taskFns = entries.map(({ code, rowData }) => () =>
      this._fetchDetail(pkwstouse, VIN, code, rowData)
        .then(detail  => ({ code, detail, category: rowData?.category }))
        .catch(err    => ({ code, detail: { error: err.message ?? String(err) }, category: rowData?.category }))
    );

    const results = await pLimit(taskFns, DETAIL_FETCH_CONCURRENCY);

    // Riporta category (valorizzato in getValidPackages/liveMap) anche nel dettaglio,
    // così pkDetailList mantiene la categoria di appartenenza del pacchetto
    const detailMap = {};
    for (const { code, detail, category } of results) {
      detailMap[code] = { ...detail, category };
    }

    this.pkDetailList = Object.values(detailMap);

    return detailMap;
  } 

  // ── _buildDmsSender ───────────────────────────────────────────────────────────
  // Deriva ApplicationArea.Sender per la inquiry DML dal dealer/brand/mercato
  // REALE della richiesta corrente (this.wsConfig, valorizzato dal chiamante in
  // costruzione — vedi getPriceAndAvailability/pkManager/index.js), invece di
  // lasciare che dms/dmsService.js usi sempre gli stessi valori statici di
  // config.sender (env vars) per qualunque dealer. Solo i campi per cui esiste
  // un dato reale in wsConfig vengono sovrascritti: gli altri (componentId,
  // serviceId, currencyId) restano sui default env-based di dms, non essendoci
  // qui un equivalente affidabile.
  //
  // @returns {object} sender override da passare a postDmsInquiry(token, { sender, ... })
  _buildDmsSender() {
    const { eper, docsoa, menupricing } = this.wsConfig;
    const dealerNumberId = menupricing?.dealerIdentificationCode ?? eper?.coddealer ?? docsoa?.codePdv;
    return {
      dealerNumberId,
      dealerNumberIdSource: dealerNumberId,
      dealerCountryCode: menupricing?.countryCode ?? docsoa?.pays,
      languageCode: menupricing?.languageCode ?? docsoa?.langue,
      physicalSiteId: docsoa?.codePdv,
      brand: docsoa?.codbrand,
    };
  }

  // ── getPriceAndAvailability ──────────────────────────────────────────────────
  // Porting di WadManager.class.php::getPartsAvailabilityXP(), che interroga il
  // gateway DML per prezzo/disponibilità di ricambi e manodopera.
  //
  // A differenza della versione PHP (che chiama DMLManager::PartsAvailability()
  // con un unico blocco { items: { PartsItem, LaborItem } } e un solo $pkDetail),
  // qui si usa dms/dmsService.js::postDmsInquiry() con MessageType=WL: costruiamo
  // una WorkLine "di dominio" per ciascun pacchetto presente in this.pkDetailList
  // (valorizzato da getValidPackagesDetail()), con i codici parte presi da
  // listaRicambi e i codici manodopera da listaOperazioni — stessa logica del
  // ciclo `foreach ($pkDetail['listaOperazioni']...)` /
  // `foreach ($pkDetail['listaRicambi']...)` della versione PHP.
  //
  // NB: qui costruiamo solo il payload "di business" (PartsInquiryHeader +
  // workLines/customerAccountDmsId semplificati) più un `sender` dinamico
  // (_buildDmsSender(), derivato dal dealer/brand/mercato reale di
  // this.wsConfig). La struttura DML nidificata di WorkLines
  // (PartsItem/LaborItem con PartType/PartStatus/LaborType) e l'envelope
  // ApplicationArea non sono più responsabilità del chiamante: vengono
  // costruiti internamente dalla lambda dms (dmsService.js::postDmsInquiry ->
  // buildApplicationArea(sender) / buildWorkLines()), che quindi possiede
  // l'intero payload della richiesta invece di riceverlo già pronto — ma usa
  // il `sender` passato qui per non inviare sempre lo stesso dealer/brand/
  // paese fisso (config.sender via env) indipendentemente da chi ha
  // effettivamente originato la richiesta.
  //
  // @param {string} documentId - Repair Order number (PartsInquiryHeader.DocumentID)
  // @param {string} customerId - Customer ID DMS (PartsInquiryHeader.CustomerIdDms)
  // @param {string} vehicleId  - VIN (PartsInquiryHeader.VehicleID)
  // @returns {Promise<object>} - Risposta di postDmsInquiry (InquiryResponse)
  async getPriceAndAvailability(documentId, customerId, vehicleId) {
    const { getBearerToken } = require(path.resolve(__dirname, '../dms/authService'));
    const { postDmsInquiry } = require(path.resolve(__dirname, '../dms/dmsService'));

    // Costruisco le workLines semplificate a partire da pkDetailList (equivalente
    // ai due foreach di getPartsAvailabilityXP che popolano $LaborItem/$PartsItem):
    // la lambda dms si occupa di trasformarle in WorkLines nel formato DML.
    const workLines = this.pkDetailList.map((pkDetail, idx) => ({
      workLineReference: pkDetail?.codice ?? String(idx + 1).padStart(3, '0'),
      partNumbers: (pkDetail?.listaRicambi ?? []).filter(Boolean).map((row) => row.COD),
      laborOperationIds: (pkDetail?.listaOperazioni ?? []).filter(Boolean).map((row) => row.COD),
    }));

    const body = {
      PartsInquiryHeader: {
        DocumentID: documentId,
        CustomerIdDms: customerId,
        MessageType: 'WL',
        VehicleID: vehicleId,
      },
      customerAccountDmsId: null,
      workLines,
      // Sender dinamico (dealer/brand/mercato reali di questa richiesta, da
      // wsConfig) invece dei default statici env-based della lambda dms — vedi
      // _buildDmsSender().
      sender: this._buildDmsSender(),
    };

    // Chiamo il gateway DML (token da cache/PingFederate + POST /inquiry): la
    // lambda dms si occupa di completare il payload con ApplicationArea e WorkLines.
    const token = await getBearerToken();
    return postDmsInquiry(token, body);
  }

  // ── getPkList ─────────────────────────────────────────────────────────────────
  // Orchestratore end-to-end: valorizza il dettaglio pacchetti per il VIN,
  // interroga il DML per prezzo/disponibilità e arricchisce (in place) le righe
  // di this.pkDetailList con i valori trovati, esattamente come il blocco
  // `if (isset($resPartsAv['WorkLines']))` di
  // WadManager.class.php::getPartsAvailabilityXP() (riga 816 e seguenti):
  //   AV_LOCAL => QuantityAvailable
  //   PRICE    => OriginalPriceExclVAT
  //   SCONTO   => DiscountPercentage
  // Il match avviene per COD:
  //   - righe TYPE='SP' (listaRicambi)    ↔ WorkLines[].PartsItem[].PartNumber
  //   - righe TYPE='OP' (listaOperazioni) ↔ WorkLines[].LaborItems[].LaborOperationID
  //
  // @param {string} codbrand                 - Codice brand (CODBRAND in HQ_PKCONFIG), usato
  //                                              insieme a market/codmarket per risolvere via
  //                                              dbManager.getPkwstouse() quale web service
  //                                              pacchetti (eper/docsoa/menupricing) usare
  // @param {string} documentId               - Repair Order number (PartsInquiryHeader.DocumentID)
  // @param {string} customerId                - Customer ID DMS (PartsInquiryHeader.CustomerIdDms)
  // @param {string} vehicleId                 - VIN del veicolo
  // @param {string} [market]                  - Codice mercato (default '1000'), usato anche
  //                                              come CODMARKET nella query dbManager.getPkwstouse
  // @param {string} [dealerIdentificationCode] - Override di wsConfig.menupricing.dealerIdentificationCode,
  //                                              usato dai metodi menupricing (_fetchLiveMap/_fetchDetail)
  //                                              quando pkwstouse === 'menupricing'
  // @returns {Promise<Array>}  - this.pkDetailList arricchito con AV_LOCAL/PRICE/SCONTO
  //                              e normalizzato (via _normalizePkDetail) in un
  //                              contratto identico per ogni pacchetto, qualunque
  //                              sia il pkwstouse: { result, codice, descrizione,
  //                              pkPrice, isFixedPrice, packageType, niveau,
  //                              listaOperazioni, listaRicambi, category }. Le
  //                              voci per cui il dettaglio del singolo pacchetto
  //                              non è stato recuperabile restano invece
  //                              { error, category } (non normalizzate).
  async getPkList(codbrand, documentId, customerId, vehicleId, market = '1000', dealerIdentificationCode) {
    console.log('[PkManager.getPkList] parametri chiamata:', { codbrand, documentId, customerId, vehicleId, market, dealerIdentificationCode });

    // 0) risolvo pkwstouse (eper/docsoa/menupricing) leggendo HQ_PKCONFIG tramite
    //    dbManager, per la coppia (codmarket=market, codbrand) — vedi
    //    dbManager/PkConfigRepository.js per la logica di fallback su CODMARKET NULL.
    const { getPool } = require(path.resolve(__dirname, '../dbManager/db'));
    const { getPkwstouse } = require(path.resolve(__dirname, '../dbManager/PkConfigRepository'));
    const pool = await getPool();
    const pkwstouse = await getPkwstouse(pool, { codmarket: market, codbrand });

    // Se fornito, sovrascrive il dealerIdentificationCode di menupricing (letto di
    // default da MP_DEALER_IDENTIFICATION_CODE / wsConfig del costruttore), così
    // _fetchLiveMap/_fetchDetail lo usano automaticamente tramite this.wsConfig.menupricing
    if (dealerIdentificationCode) {
      this.wsConfig.menupricing.dealerIdentificationCode = dealerIdentificationCode;
    }

    // 1) valorizza this.pkDetailList
    await this.getValidPackagesDetail(market, pkwstouse, vehicleId);
    // 2) interroga il DML per prezzo/disponibilità, usando this.pkDetailList
    const priceAndAvailability = await this.getPriceAndAvailability(documentId, customerId, vehicleId);

    // 3) indicizzo le WorkLines per WorkLineReference (== pkDetail.codice, vedi
    //    getPriceAndAvailability). NON si può usare un'unica mappa globale
    //    PartNumber/LaborOperationID → dati per TUTTE le WorkLines insieme:
    //    se due pacchetti diversi condividono lo stesso ricambio/operazione
    //    (stesso COD), l'ultima WorkLine processata sovrascriverebbe il
    //    valore nella mappa condivisa e TUTTI i pacchetti con quel COD
    //    riceverebbero lo stesso valore "vincente", indipendentemente dal
    //    pacchetto a cui appartiene realmente — con risultati non
    //    deterministici (dipendenti dall'ordine delle WorkLines nella
    //    risposta DML) e valori duplicati/errati tra pacchetti diversi.
    const workLinesByRef = {};
    for (const workLine of priceAndAvailability?.WorkLines ?? []) {
      if (workLine?.WorkLineReference) workLinesByRef[workLine.WorkLineReference] = workLine;
    }

    // 4) arricchisco this.pkDetailList in place: ciascun pacchetto legge
    //    esclusivamente la propria WorkLine (matchata per WorkLineReference),
    //    così non c'è più "bleed" di dati tra pacchetti diversi
    this.pkDetailList.forEach((pkDetail, idx) => {
      const ref       = pkDetail?.codice ?? String(idx + 1).padStart(3, '0');
      const workLine  = workLinesByRef[ref];
      if (!workLine) return;

      const partsAvailMap = {};
      for (const row of workLine?.PartsItem ?? []) {
        if (!row?.PartNumber) continue;
        partsAvailMap[row.PartNumber] = {
          AV_LOCAL: row.QuantityAvailable ?? row.BinLocation?.[0]?.QuantityAvailable,
          PRICE:    row.OriginalPriceExclVAT,
          SCONTO:   row.DiscountPercentage,
        };
      }

      const laborAvailMap = {};
      for (const row of workLine?.LaborItems ?? []) {
        if (!row?.LaborOperationID) continue;
        laborAvailMap[row.LaborOperationID] = {
          AV_LOCAL: row.QuantityAvailable,
          PRICE:    row.OriginalPriceExclVAT,
          SCONTO:   row.DiscountPercentage,
        };
      }

      for (const row of pkDetail?.listaRicambi ?? []) {
        if (row?.TYPE === 'SP' && partsAvailMap[row.COD]) {
          Object.assign(row, partsAvailMap[row.COD]);
        }
      }
      for (const row of pkDetail?.listaOperazioni ?? []) {
        if (row?.TYPE === 'OP' && laborAvailMap[row.COD]) {
          Object.assign(row, laborAvailMap[row.COD]);
        }
      }
    });

    // 5) Normalizzo ogni pacchetto in un contratto identico (stesse chiavi,
    //    stesso ordine) indipendentemente dal pkwstouse usato: eper/docsoa/
    //    menupricing restituiscono nativamente forme leggermente diverse dal
    //    rispettivo parse*Res (es. DocSOA non valorizza affatto codice/
    //    descrizione/listaOperazioni/listaRicambi quando forfait/tp non viene
    //    trovato — restano undefined e JSON.stringify le scarta dalla risposta).
    //    Le voci in errore (fetch del singolo pacchetto fallito, { error,
    //    category }) restano invariate: non sono un pacchetto valido da
    //    normalizzare.
    this.pkDetailList = this.pkDetailList.map((pkDetail) => (
      pkDetail?.error !== undefined ? pkDetail : this._normalizePkDetail(pkDetail)
    ));

    return this.pkDetailList;
  }

  // ── _normalizePkDetail ───────────────────────────────────────────────────────
  // Garantisce che ciascun elemento restituito da getPkList abbia sempre lo
  // stesso set di chiavi (stesso "payload"), qualunque sia il pkwstouse usato
  // per produrlo — solo i valori possono differire tra eper/docsoa/menupricing.
  // @param {object} pkDetail - Elemento di this.pkDetailList prodotto da
  //                            parseEperRes/parseDocSoaRes/parseMenupricingRes
  //                            (+ category), già arricchito con AV_LOCAL/PRICE/
  //                            SCONTO sulle righe di listaOperazioni/listaRicambi.
  // @returns {object}         - { result, codice, descrizione, pkPrice,
  //                              isFixedPrice, packageType, niveau,
  //                              listaOperazioni, listaRicambi, category }
  _normalizePkDetail(pkDetail) {
    return {
      result:          true,
      codice:          pkDetail?.codice ?? null,
      descrizione:     pkDetail?.descrizione ?? null,
      pkPrice:         pkDetail?.pkPrice ?? 0,
      isFixedPrice:    pkDetail?.isFixedPrice ?? '0',
      packageType:     pkDetail?.packageType ?? (pkDetail?.isFixedPrice === '1' ? 'FP' : 'QE'),
      niveau:          pkDetail?.niveau ?? null,
      listaOperazioni: pkDetail?.listaOperazioni ?? [],
      listaRicambi:    pkDetail?.listaRicambi ?? [],
      category:        pkDetail?.category ?? null,
    };
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
      const pkRes = await client.getPackageDetailsPR({
        ticket:              cfg.ticket,
        lingua:              cfg.lingua,
        VIN,
        codicePacchetto:     code,
        codicePosizione,
        codicePosizioneGuida,
      });
      return this.parseEperRes(pkRes);
    }

    if (key === 'menupricing') {
      const { MenuPricingSoapClient } = require(path.resolve(__dirname, '../pkMenupricing/MenuPricingSoapClient'));
      const cfg    = this.wsConfig.menupricing;
      const client = new MenuPricingSoapClient();
      const pkRes  = await client.getJobDetails({ ...cfg, vin: VIN, id: code });
      return this.parseMenupricingRes(pkRes);
    }

    if (key === 'docsoa') {
      const { DocSOARestClient } = require(path.resolve(__dirname, '../pkDocsoa/DocSOARestClient'));
      const cfg    = this.wsConfig.docsoa;
      const client = new DocSOARestClient();
      const commonParams = {
        wmi:      VIN.substring(0, 3),
        vds:      VIN.substring(3, 9),
        vis:      VIN.substring(9, 17),
        langue:   cfg.langue,
        pays:     cfg.pays,
        marque:   cfg.codbrand,
        paysUser: cfg.pays,
        mode:     'MODE_XML',
        codePdv:  cfg.codePdv,
      };

      // 1) prova come forfait (pacchetto a prezzo fisso): se trovato, isFixedPrice = '1'
      const forfaitRes = await client.ibxDetailForfaitService({ ...commonParams, codeFF: code });
      if (forfaitRes?.data?.forfait) {
        return this.parseDocSoaRes(forfaitRes, true);
      }

      // 2) non trovato come forfait: il codice è una singola TP (tempo/prezzo),
      //    non un pacchetto a prezzo fisso => isFixedPrice = '0'.
      //    ibxParametrageService restituisce i nodi doc con sia `refAff` (usato come
      //    chiave di mappatura in buildDocsoaMap) sia `ref` (il riferimento tecnico
      //    richiesto da ibxDetailtpService): va usato quest'ultimo quando presente,
      //    altrimenti si ricade sul code (compatibilità con altri CODE_FIELDS).
      const refTp = rowData?.ref ?? code;
      const tpRes = await client.ibxDetailtpService({ ...commonParams, refTp });
      return this.parseDocSoaRes(tpRes, false);
    }

    throw new Error(`pkwstouse non riconosciuto: "${pkwstouse}"`);
  }

  // ── parseMenupricingRes ──────────────────────────────────────────────────────
  // Porting di MenuPricingSoapClient.class.php::parseJobDetailResult()
  // (COMMON\classes\WAD\modules\MenuPricingSoapClient.php), che normalizza il
  // dettaglio di un job MenuPricing (operazioni + ricambi + eventuale prezzo
  // fisso da promozione "Lex") in { codice, descrizione, pkPrice, isFixedPrice,
  // listaOperazioni, listaRicambi }.
  //
  // Nota: in Node il parsing SOAP grezzo (filtro jobSource=='MAN', estrazione
  // labours/partsList/promotion) è già svolto internamente da
  // MenuPricingSoapClient#getJobDetails() (equivalente della parseJobDetailResult
  // PHP), che restituisce { success, data, message } con "data" già nella forma
  // finale. Questo metodo applica quindi, lato pkManager, lo stesso contratto/
  // default della versione PHP (throw su errore, array vuoti se assenti
  // operazioni/ricambi), in modo analogo a parseDocSoaRes/parseEperRes.
  //
  // @param {object} pkRes - Risultato di MenuPricingSoapClient#getJobDetails():
  //                         { success, data: { codice, descrizione, pkPrice,
  //                         isFixedPrice, listaOperazioni, listaRicambi }, message }
  // @returns {object}     - { result, codice, descrizione, pkPrice, isFixedPrice,
  //                           packageType ('FP' se isFixedPrice è '1', altrimenti
  //                           'QE'), listaOperazioni, listaRicambi } — le singole
  //                           righe mantengono AV_LOCAL e SCONTO (allo stesso
  //                           livello di TYPE/POSIZIONE/COD/DESCR), ma non i campi
  //                           interni AV_DISTRIGO/AV_CENTRAL.
  parseMenupricingRes(pkRes) {
    if (!pkRes?.success) {
      throw new Error(pkRes?.message || 'menupricing: errore sconosciuto');
    }

    const data = pkRes.data ?? {};
    // AV_LOCAL e SCONTO vengono mantenuti (richiesti a livello di riga insieme
    // a TYPE/POSIZIONE/COD/DESCR); AV_DISTRIGO/AV_CENTRAL restano interni.
    const stripAvailability = (rows) => (rows ?? []).map(
      ({ AV_DISTRIGO, AV_CENTRAL, ...rest }) => rest
    );

    const isFixedPrice = data.isFixedPrice ?? '0';

    return {
      result:          true,
      codice:          data.codice,
      descrizione:     data.descrizione,
      pkPrice:         data.pkPrice ?? 0,
      isFixedPrice,
      packageType:     isFixedPrice === '1' ? 'FP' : 'QE',
      listaOperazioni: stripAvailability(data.listaOperazioni),
      listaRicambi:    stripAvailability(data.listaRicambi),
    };
  }

  // ── parseEperRes ─────────────────────────────────────────────────────────────
  // Porting di WsEperPr.class.php::elaborateXml() (COMMON\classes\WsEperPr.class.php),
  // che normalizza il dettaglio di un pacchetto ePer in { codice, descrizione,
  // isFixedPrice, listaOperazioni, listaRicambi } (ricambi + materiali confluiscono
  // in listaRicambi). ePer non ha un concetto di prezzo fisso da promozione (a
  // differenza di DocSOA/MenuPricing): isFixedPrice è quindi sempre '0'.
  //
  // Nota: qui pkRes è già il nodo "pacchetto" (status/data già scartati a monte da
  // WsIQPckEper.elaborateXml/getPackageDetailsPR), quindi corrisponde al ramo
  // $level == 1 della versione PHP (niente comma→dot su TIME, che si applica solo
  // al level 0 non usato da pkManager).
  //
  // @param {object} pkRes - Risultato di WsIQPckEper#getPackageDetailsPR():
  //                         il nodo "pacchetto" { codice, descrizione,
  //                         listaOperazioni, listaRicambi, listaMateriali, ... }
  //                         oppure { error: { exitCode, errorMessage } } in caso di errore ws.
  // @returns {object}      - { codice, descrizione, isFixedPrice: '0', packageType: 'QE',
  //                            listaOperazioni: [...OP], listaRicambi: [...SP (ricambi + materiali)] }
  parseEperRes(pkRes) {
    if (pkRes?.error) {
      throw new Error(pkRes.error.errorMessage ?? 'eper: errore sconosciuto');
    }

    const listaOperazioni = [];
    const listaRicambi    = [];

    // 1) OP — operazioni
    const operazione = toArray(pkRes?.listaOperazioni?.operazione);
    for (const row of operazione) {
      listaOperazioni.push({
        TYPE:      'OP',
        POSIZIONE: '',
        COD:       row.codice,
        DESCR:     row.descrizione,
        AV_LOCAL:  0,
        SCONTO:    0,
        TIME:      row.tempo,
        QTY:       '',
        PRICE:     '',
        CODSIGI:   '',
      });
    }

    // 2) SP — ricambi
    const ricambio = toArray(pkRes?.listaRicambi?.ricambio);
    for (const row of ricambio) {
      listaRicambi.push({
        TYPE:      'SP',
        POSIZIONE: row.posizione,
        COD:       row.codice,
        DESCR:     row.descrizione,
        AV_LOCAL:  0,
        SCONTO:    0,
        TIME:      '',
        QTY:       row.quantita,
        PRICE:     row.prezzo,
        CODSIGI:   '',
      });
    }

    // 3) SP — materiali (ricambi non a catalogo)
    // NOTA: la versione PHP applica qui WsIQPckEper::ricNoCatalogDecode() per
    // rimappare i materiali con i codici SIGI/DMS (lookup su DB per codmarket/
    // coddealer/codbrand/codlanguage). Il porting Node non ha ancora un
    // equivalente di tale lookup: i materiali vengono quindi aggiunti così come
    // ricevuti da ePer, senza remapping.
    // TODO: integrare ricNoCatalogDecode quando sarà disponibile il modulo DMS/SIGI.
    const materiale = toArray(pkRes?.listaMateriali?.materiale);
    for (const row of materiale) {
      listaRicambi.push({
        TYPE:      'SP',
        POSIZIONE: '',
        COD:       row.codice,
        DESCR:     row.descrizione,
        AV_LOCAL:  0,
        SCONTO:    0,
        TIME:      '',
        QTY:       row.quantita,
        PRICE:     '0',
        CODSIGI:   row.codSigi,
      });
    }

    return {
      codice:       pkRes?.codice,
      descrizione:  pkRes?.descrizione,
      isFixedPrice: '0', // ePer non ha il concetto di prezzo fisso da promozione
      packageType:  'QE', // ePer è sempre a preventivo (Quick Estimate), mai forfait
      listaOperazioni,
      listaRicambi,
    };
  }

  // ── parseDocSoaRes ───────────────────────────────────────────────────────────
  // Porting 1:1 di WadServices.class.php::parseDocSoaRes()
  // (COMMON\classes\WAD\modules\WadServices.class.php), che normalizza la
  // risposta DocSOA (forfait o singolo tp) in { listaOperazioni, listaRicambi, ... }.
  //
  // @param {object}  pkRes     - Risposta grezza { success, data, message } di
  //                              ibxDetailForfaitService (isForfait=true) o
  //                              ibxDetailtpService (isForfait=false)
  // @param {boolean} isForfait - true → legge pkRes.data.forfait, false → pkRes.data.tp
  // @returns {object}          - { listaOperazioni?, listaRicambi?, result, codice,
  //                                descrizione, pkPrice, '2DigitCode', niveau,
  //                                isFixedPrice, packageType ('FP' se isFixedPrice
  //                                è '1', altrimenti 'QE') }
  parseDocSoaRes(pkRes, isForfait) {
    let refFo, descr, price, pk, niveau, isFixedPrice;

    if (isForfait) {
      refFo        = pkRes?.data?.forfait?.ref_fo;
      descr        = pkRes?.data?.forfait?.lib;
      price        = pkRes?.data?.forfait?.prix;
      pk           = pkRes?.data?.forfait?.tp?.details;
      niveau       = pkRes?.data?.forfait?.niveau;
      isFixedPrice = '1';
    } else {
      refFo        = pkRes?.data?.tp?.ref;
      descr        = pkRes?.data?.tp?.titre_trad;
      price        = 0;
      pk           = pkRes?.data?.tp?.details;
      niveau       = null;
      isFixedPrice = '0';
    }

    const returnArray = {};
    const resultA = [];
    const resultB = [];
    const resultC = [];

    // operazioni
    if (pk?.mos?.mo) {
      if (pk.mos.mo.ref) {
        // un solo record
        resultA.push({
          TYPE:        'OP',
          POSIZIONE:   `!${randomPosInt()}`,
          COD:         pk.mos.mo.ref,
          DESCR:       pk.mos.mo.lib_trad,
          TIME:        pk.mos.mo.moappl?.temps,
          QTY:         '',
          AV_LOCAL:    0,
          AV_DISTRIGO: 0,
          AV_CENTRAL:  0,
          SCONTO:      0,
          PRICE:       '',
          SELECTED:    true,
        });
      } else {
        for (const mo of toArray(pk.mos.mo)) {
          resultA.push({
            TYPE:        'OP',
            POSIZIONE:   `!${randomPosInt()}`,
            COD:         mo.ref,
            DESCR:       mo.lib_trad,
            TIME:        mo.moappl?.temps,
            QTY:         '',
            AV_LOCAL:    0,
            AV_DISTRIGO: 0,
            AV_CENTRAL:  0,
            SCONTO:      0,
            PRICE:       '',
            SELECTED:    true,
          });
        }
      }
      returnArray.listaOperazioni = resultA;
    }

    // ricambi
    if (pk?.prs?.enspr) {
      if (pk.prs.enspr.ref) {
        // enspr è un singolo record
        if (pk.prs.enspr.pr?.ref) {
          resultB.push({
            TYPE:        'SP',
            POSIZIONE:   `${randomPosInt()}`,
            COD:         pk.prs.enspr.pr.ref,
            DESCR:       pk.prs.enspr.pr.lib_trad,
            TIME:        '',
            QTY:         pk.prs.enspr.pr.prappl?.quantite,
            AV_LOCAL:    0,
            AV_DISTRIGO: 0,
            AV_CENTRAL:  0,
            SCONTO:      0,
            PRICE:       0,
            SELECTED:    pk.prs.enspr.pr.selected === 'true',
            PIECE_REMPL: pk.prs.enspr.pr.prappl?.piece_rempl,
          });
        } else {
          for (const prs of toArray(pk.prs.enspr.pr)) {
            resultB.push({
              TYPE:        'SP',
              POSIZIONE:   `${randomPosInt()}`,
              COD:         prs.ref,
              DESCR:       prs.lib_trad,
              TIME:        '',
              QTY:         prs.prappl?.quantite,
              AV_LOCAL:    0,
              AV_DISTRIGO: 0,
              AV_CENTRAL:  0,
              SCONTO:      0,
              PRICE:       0,
              SELECTED:    prs.selected === 'true',
              PIECE_REMPL: prs.prappl?.piece_rempl,
            });
          }
        }
        returnArray.listaRicambi = resultB;
      } else {
        // enspr è un array di gruppi
        for (const prs of toArray(pk.prs.enspr)) {
          if (!prs?.pr) continue;

          if (prs.pr.ref) {
            resultB.push({
              TYPE:        'SP',
              POSIZIONE:   `${randomPosInt()}`,
              COD:         prs.pr.ref,
              DESCR:       prs.pr.lib_trad,
              TIME:        '',
              QTY:         prs.pr.prappl?.quantite,
              AV_LOCAL:    0,
              AV_DISTRIGO: 0,
              AV_CENTRAL:  0,
              SCONTO:      0,
              PRICE:       0,
              SELECTED:    prs.pr.selected === 'true',
              PIECE_REMPL: prs.pr.prappl?.piece_rempl,
            });
          } else {
            // sono alternativi (stessa posizione) => metto selected solo al primo
            const pos = `${randomPosInt()}`;
            for (const prsAlt of toArray(prs.pr)) {
              resultB.push({
                TYPE:        'SP',
                POSIZIONE:   pos,
                COD:         prsAlt.ref,
                DESCR:       prsAlt.lib_trad,
                TIME:        '',
                QTY:         prsAlt.prappl?.quantite,
                AV_LOCAL:    0,
                AV_DISTRIGO: 0,
                AV_CENTRAL:  0,
                SCONTO:      0,
                PRICE:       0,
                SELECTED:    prsAlt.selected === 'true',
                PIECE_REMPL: prsAlt.prappl?.piece_rempl,
              });
            }
          }
          returnArray.listaRicambi = resultB;
        }
      }
    }

    // ricambi generici
    if (pk?.pgs) {
      if (pk.pgs.enspg?.ref) {
        resultC.push({
          TYPE:        'SP',
          POSIZIONE:   `${randomPosInt()}`,
          COD:         pk.pgs.enspg.pg?.ref,
          DESCR:       pk.pgs.enspg.pg?.lib_trad,
          TIME:        '',
          QTY:         pk.pgs.enspg.pg?.pgappl?.quantite,
          AV_LOCAL:    0,
          AV_DISTRIGO: 0,
          AV_CENTRAL:  0,
          SCONTO:      0,
          PRICE:       0,
          SELECTED:    true,
        });
      } else if (pk.pgs.enspg) {
        for (const pgs of toArray(pk.pgs.enspg)) {
          resultC.push({
            TYPE:        'SP',
            POSIZIONE:   `${randomPosInt()}`,
            COD:         pgs.pg?.ref,
            DESCR:       pgs.pg?.lib_trad,
            TIME:        '',
            QTY:         pgs.pg?.pgappl?.quantite,
            AV_LOCAL:    0,
            AV_DISTRIGO: 0,
            AV_CENTRAL:  0,
            SCONTO:      0,
            PRICE:       0,
            SELECTED:    pgs.pg?.selected === '1',
          });
        }
      }

      // NOTA: la versione PHP rimappa qui i ricambi generici con i codici BRR
      // (decodeGenericByBRR, basato su $_SESSION['brrMaterialsMatch'] /
      // brrPnrActivationDiWarranty). Il porting Node non ha ancora un equivalente
      // della sessione BRR: i ricambi generici vengono quindi aggiunti così come
      // ricevuti da DocSOA, senza remapping.
      // TODO: integrare decodeGenericByBRR quando sarà disponibile il modulo BRR.
      if (returnArray.listaRicambi) {
        returnArray.listaRicambi = [...returnArray.listaRicambi, ...resultC];
      } else {
        returnArray.listaRicambi = resultC;
      }
    }

    returnArray.result        = true;
    returnArray.codice        = refFo;
    returnArray.descrizione   = descr;
    returnArray.pkPrice       = price;
    returnArray['2DigitCode'] = niveau; // non posso usare var che inizia con numero
    returnArray.niveau        = niveau;
    returnArray.isFixedPrice  = isFixedPrice;
    returnArray.packageType   = isFixedPrice === '1' ? 'FP' : 'QE';

    return returnArray;
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
      const liveMap = buildDocsoaMap(result.data ?? []);
      console.log(`[_fetchLiveMap:docsoa] raw items: ${toArray(result.data).length}, mapped keys: ${Object.keys(liveMap).length}`);
      return liveMap;
    }

    throw new Error(`pkwstouse non riconosciuto: "${pkwstouse}"`);
  }
}

// ─── Helper: converte l'array docsoa in { [codice]: obj } ─────────────────────
// I campi candidati per il codice sono i più comuni nelle risposte PSA DocSOA.
// Se nessun campo è trovato, effettua una ricerca per contenuto (JSON stringify).
function buildDocsoaMap(dataArr) {
  const CODE_FIELDS = ['refAff', 'id', 'code', 'codice', 'codeFF', 'refForfait', 'fonctionId', 'idFunction'];
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

// ─── Helper: intero pseudo-casuale non negativo, usato in parseDocSoaRes per
// generare POSIZIONE (equivalente a random_int(0, mt_getrandmax()) in PHP) ─────
function randomPosInt() {
  return Math.floor(Math.random() * 2147483647);
}

module.exports = { PkManager };
