'use strict';

require('dotenv').config();
const axios = require('axios');
const xml2js = require('xml2js');
const https = require('https');

// ─── Configurazione ────────────────────────────────────────────────────────────
const EPER_HOST    = process.env.EPER_HOST;
const IQPCK_WS     = `https://${EPER_HOST}/wsdl/DMSConnectorService.wsdl`; // usato nell'envelope
const SERVICE_URL  = `https://${EPER_HOST}/DMSConnectorService`;            // endpoint reale (da WSDL soap:address)
const SERVICE_NS   = 'http://service.dms.keytech.it/';                      // targetNamespace dal WSDL
const TIMEOUT_MS   = 20_000;
const CONCURRENCY  = 3;   // max richieste SOAP simultanee verso ePer

// httpsAgent che ignora la verifica del certificato (come il PHP originale)
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// ─── Helper: esegue tasks con concorrenza limitata ─────────────────────────────
async function pLimit(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;

  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return results;
}

// ─── Helper: costruisce l'envelope XML esterno ─────────────────────────────────
function buildEnvelope({ sender, market, content }) {
  const id      = Date.now();
  const service = 'FIAT_LINK';
  const date    = new Date().toISOString().replace('Z', '').substring(0, 19);

  return (
    `<?xml version="1.0" encoding="utf-8"?>` +
    `<MESSAGE xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
    ` xmlns:dms="http://dmsmanagerservice"` +
    ` xsi:noNamespaceSchemaLocation="message.xsd"` +
    ` ID="${id}" TYPE="IQPCKEPER">` +
      `<DELIVERY>` +
        `<FROM>` +
          `<SENDER>${sender}</SENDER>` +
          `<SERVICE>${service}</SERVICE>` +
          `<DATE>${date}</DATE>` +
        `</FROM>` +
        `<TO>` +
          `<DEALER DEALERCODE="${sender}" MARKETCODE="${market}" />` +
        `</TO>` +
      `</DELIVERY>` +
      `<CONTENT>${content}</CONTENT>` +
    `</MESSAGE>`
  );
}

// ─── Helper: costruisce la SOAP request ────────────────────────────────────────
function buildSoapRequest(xmlMessage) {
  const escaped = xmlMessage
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"` +
    ` xmlns:tns="${SERVICE_NS}">` +
      `<soapenv:Header/>` +
      `<soapenv:Body>` +
        `<tns:put>` +
          `<sXMLMessage>${escaped}</sXMLMessage>` +
          `<sMessageType>IQPCKEPER</sMessageType>` +
        `</tns:put>` +
      `</soapenv:Body>` +
    `</soapenv:Envelope>`
  );
}

// ─── Helper: esegue la chiamata SOAP ──────────────────────────────────────────
async function callSoap(xmlMessage) {
  const soapBody = buildSoapRequest(xmlMessage);

  const response = await axios.post(SERVICE_URL, soapBody, {
    httpsAgent,
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type': 'text/xml;charset=UTF-8',
      'SOAPAction':   '""',   // SOAPAction vuoto come da WSDL
    },
  });

  // Estrae il contenuto di <return> dalla risposta SOAP
  const parsed = await xml2js.parseStringPromise(response.data, {
    explicitArray: false,
    tagNameProcessors: [xml2js.processors.stripPrefix],
  });

  if (process.env.DEBUG_SOAP) {
    console.log('\n[DEBUG] Raw SOAP response:\n', response.data);
    console.log('\n[DEBUG] Parsed:\n', JSON.stringify(parsed, null, 2));
  }

  const body    = parsed?.Envelope?.Body;
  const putResp = body?.putResponse ?? body?.['putResponse'];
  return putResp?.return ?? null;
}

// ─── Helper: elabora l'XML di risposta ePer ───────────────────────────────────
async function elaborateXml(xmlStr, method) {
  if (!xmlStr) {
    return { error: { exitCode: '-1', errorMessage: `Timeout (${TIMEOUT_MS / 1000} sec)` } };
  }

  // Rimuove il prefisso dms: per semplificare il parsing
  const cleaned = xmlStr.replace(/dms:/g, '');

  let xmlObj;
  try {
    xmlObj = await xml2js.parseStringPromise(cleaned, { explicitArray: false });
  } catch (e) {
    return { error: { exitCode: '-1', errorMessage: `XML parse error: ${e.message}` } };
  }

  const msg = xmlObj?.MESSAGE;

  // Errore a livello di MESSAGE
  if (msg?.$?.ErrorCode) {
    return { error: { exitCode: msg.$.ErrorCode, errorMessage: msg.$.ErrorDescription } };
  }

  // Seleziona il nodo di risposta specifico per il metodo
  const contentMap = {
    getGroupsPRRequest:    'getGroupsPRResponse',
    getSubgroupsPR:        'getSubgroupsPRResponse',
    getPackagesPR:         'getPackagesPRResponse',
    getPackageDetailsPR:   'getPackageDetailsPRResponse',
  };
  const responseName = contentMap[method];
  const contentObj   = msg?.CONTENT?.[responseName];

  if (!contentObj) {
    return { error: { exitCode: '-1', errorMessage: `No ${responseName} found in response` } };
  }

  const status = contentObj.status ?? {};
  if (String(status.success) === '0' || status.success === 0) {
    return { error: { exitCode: status.exitCode, errorMessage: status.errorMessage } };
  }

  // Normalizza a array singolo/multiplo
  const toArray = (val) => {
    if (!val) return [];
    return Array.isArray(val) ? val : [val];
  };

  switch (method) {
    case 'getGroupsPRRequest':
      return toArray(contentObj.gruppi?.gruppo);
    case 'getSubgroupsPR':
      return toArray(contentObj.sottogruppi?.sottogruppo);
    case 'getPackagesPR':
      return toArray(contentObj.pacchetti?.pacchetto);
    case 'getPackageDetailsPR':
      return contentObj.pacchetto ?? {};
    default:
      return contentObj;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Classe WsIQPckEper
// ═══════════════════════════════════════════════════════════════════════════════
class WsIQPckEper {
  constructor({ coddealer, codmarket }) {
    this.coddealer = coddealer;
    this.codmarket = codmarket;
  }

  // ── getGroupsPRRequest ──────────────────────────────────────────────────────
  // Restituisce la lista dei gruppi ePer per un veicolo (VIN o modello+telaio)
  async getGroupsPRRequest({ ticket, lingua, modello, telaio, VIN }) {
    let content =
      `<dms:getGroupsPRRequest xmlns:dms="http://dmsmanagerservice"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xsi:noNamespaceSchemaLocation="getGroupsPRRequest.xsd"` +
      ` UPRSToken="${ticket ?? ''}" lingua="${lingua}"`;

    content += VIN
      ? ` VIN="${VIN}"/>`
      : ` modello="${modello}" telaio="${telaio}"/>`;

    const xmlMsg = buildEnvelope({ sender: this.coddealer, market: this.codmarket, content });
    const xmlReturn = await callSoap(xmlMsg);
    return elaborateXml(xmlReturn, 'getGroupsPRRequest');
  }

  // ── getSubgroupsPR ──────────────────────────────────────────────────────────
  // Restituisce la lista dei sottogruppi per un gruppo ePer
  async getSubgroupsPR({ ticket, lingua, modello, telaio, VIN, codiceGruppo }) {
    let content =
      `<dms:getSubgroupsPRRequest xmlns:dms="http://dmsmanagerservice"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xsi:noNamespaceSchemaLocation="getSubgroupsPRRequest.xsd"` +
      ` UPRSToken="${ticket ?? ''}" lingua="${lingua}"`;

    content += VIN
      ? ` VIN="${VIN}" codiceGruppo="${codiceGruppo}" />`
      : ` modello="${modello}" telaio="${telaio}" codiceGruppo="${codiceGruppo}" />`;

    const xmlMsg = buildEnvelope({ sender: this.coddealer, market: this.codmarket, content });
    const xmlReturn = await callSoap(xmlMsg);
    return elaborateXml(xmlReturn, 'getSubgroupsPR');
  }

  // ── getPackagesPR ───────────────────────────────────────────────────────────
  // Restituisce la lista dei pacchetti per gruppo+sottogruppo
  async getPackagesPR({ ticket, lingua, modello, telaio, VIN, codiceGruppo, codiceSottogruppo }) {
    let content =
      `<dms:getPackagesPRRequest xmlns:dms="http://dmsmanagerservice"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xsi:noNamespaceSchemaLocation="getPackagesPRRequest.xsd"` +
      ` UPRSToken="${ticket ?? ''}" lingua="${lingua}"`;

    content += VIN
      ? ` VIN="${VIN}" codiceGruppo="${codiceGruppo}" codiceSottogruppo="${codiceSottogruppo}" />`
      : ` modello="${modello}" telaio="${telaio}" codiceGruppo="${codiceGruppo}" codiceSottogruppo="${codiceSottogruppo}" />`;

    const xmlMsg = buildEnvelope({ sender: this.coddealer, market: this.codmarket, content });
    const xmlReturn = await callSoap(xmlMsg);
    return elaborateXml(xmlReturn, 'getPackagesPR');
  }

  // ── getPackageDetailsPR ─────────────────────────────────────────────────────
  // Restituisce il dettaglio (composizione materiali) di un pacchetto PR
  async getPackageDetailsPR({
    ticket,
    lingua,
    modello,
    telaio,
    VIN,
    codicePacchetto,
    codicePosizione,
    codicePosizioneGuida,
  }) {
    let content =
      `<dms:getPackageDetailsPRRequest xmlns:dms="http://dmsmanagerservice"` +
      ` xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"` +
      ` xsi:noNamespaceSchemaLocation="getPackageDetailsPRRequest.xsd"` +
      ` UPRSToken="${ticket ?? ''}" lingua="${lingua}"`;

    content += VIN
      ? ` VIN="${VIN}" codicePacchetto="${codicePacchetto}" codicePosizione="${codicePosizione}" codicePosizioneGuida="${codicePosizioneGuida}" />`
      : ` modello="${modello}" telaio="${telaio}" codicePacchetto="${codicePacchetto}" codicePosizione="${codicePosizione}" codicePosizioneGuida="${codicePosizioneGuida}" />`;

    const xmlMsg = buildEnvelope({ sender: this.coddealer, market: this.codmarket, content });
    const xmlReturn = await callSoap(xmlMsg);
    return elaborateXml(xmlReturn, 'getPackageDetailsPR');
  }

  // ── getCompletePkEperList ───────────────────────────────────────────────────
  // Percorre gruppi → sottogruppi → pacchetti per un VIN e restituisce
  // la mappa completa dei pacchetti ePer indicizzata per codice.
  // Le chiamate ai livelli 2 e 3 vengono eseguite in parallelo (Promise.all).
  // (Corrisponde a JOBCXPAjaxController::getCompletePkEperList, senza updatePkInfoEper)
  async getCompletePkEperList({ ticket, lingua, vin }) {
    // Livello 1: gruppi (singola chiamata obbligatoria)
    const grp = await this.getGroupsPRRequest({ ticket, lingua, VIN: vin });
    if (grp?.error) return grp;

    // Livello 2: sottogruppi — con concorrenza limitata, solo per gruppi con pacchetti
    const groupsWithPk = grp.filter(row => {
      const n = row.$?.numeroPacchetti ?? row.numeroPacchetti;
      return n && Number(n) !== 0;
    });

    const subGrpResults = await pLimit(
      groupsWithPk.map(row => async () => {
        const codiceGruppo = row.$?.codice ?? row.codice;
        const subGrp = await this.getSubgroupsPR({ ticket, lingua, VIN: vin, codiceGruppo });
        return { codiceGruppo, subGrp };
      }),
      CONCURRENCY
    );

    // Livello 3: pacchetti — tutte le combinazioni gruppo/sottogruppo con concorrenza limitata
    const pkRequests = [];
    for (const { codiceGruppo, subGrp } of subGrpResults) {
      if (subGrp?.error) continue;
      for (const row1 of subGrp) {
        const codiceSottogruppo = row1.$?.codice ?? row1.codice;
        if (codiceSottogruppo) pkRequests.push({ codiceGruppo, codiceSottogruppo });
      }
    }

    const pkResults = await pLimit(
      pkRequests.map(({ codiceGruppo, codiceSottogruppo }) => () =>
        this.getPackagesPR({ ticket, lingua, VIN: vin, codiceGruppo, codiceSottogruppo })
      ),
      CONCURRENCY
    );

    // Raccolta risultati
    const pklistComplete = {};
    for (const pkList of pkResults) {
      if (pkList?.error) continue;
      for (const row2 of pkList) {
        const codice = row2.$?.codice ?? row2.codice;
        if (codice) pklistComplete[codice] = row2;
      }
    }

    return pklistComplete;
  }
}

module.exports = { WsIQPckEper };
