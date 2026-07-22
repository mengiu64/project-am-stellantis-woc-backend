'use strict';

require('dotenv').config();
const axios  = require('axios');
const xml2js = require('xml2js');
const { getHttpsAgent } = require('./certService');

// ─── Configurazione (da .env) ──────────────────────────────────────────────────
// HOST: gateway IBM API Connect "cert-aai" (autenticazione mTLS), es:
// https://api-cert-preprod.groupe-psa.com/api/cert-aai
const HOST      = (process.env.DOCSOA_HOST ?? '').replace(/\/$/, '');
const USERNAME  = process.env.DOCSOA_USERNAME;
const PASSWORD  = process.env.DOCSOA_PASSWORD;
// Credenziali applicative del gateway IBM API Connect (stesso pattern di dms/dmsService
// per il gateway DML): richieste come header su OGNI chiamata, non più come query string.
const IBM_CLIENT_ID     = process.env.DOCSOA_IBM_CLIENT_ID;
const IBM_CLIENT_SECRET = process.env.DOCSOA_IBM_CLIENT_SECRET;

// Proxy opzionale (richiesto sulla rete corporativa Stellantis/PSA)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : 8080;

const TIMEOUT_MS = Number(process.env.DOCSOA_TIMEOUT_MS ?? 60_000);

// Configurazione proxy per axios (usata solo se PROXY_HOST è definito)
const axiosProxy = PROXY_HOST
  ? { host: PROXY_HOST, port: PROXY_PORT, protocol: 'http' }
  : false;

const MAX_LOG_BODY_LENGTH = 4000;
function truncate(str) {
  if (typeof str !== 'string') return str;
  return str.length > MAX_LOG_BODY_LENGTH
    ? `${str.slice(0, MAX_LOG_BODY_LENGTH)}...[truncated]`
    : str;
}

// Maschera credenziali WS-Security (<wsse:Password>...</wsse:Password>) e header Authorization
// prima di loggare request/response XML.
function redactXml(xml) {
  if (typeof xml !== 'string') return xml;
  const masked = xml.replace(
    /(<[\w:]*Password[^>]*>)([\s\S]*?)(<\/[\w:]*Password>)/gi,
    '$1***REDACTED***$3'
  );
  return truncate(masked);
}

// URL dei singoli servizi (gateway "cert-aai", mTLS — nessun client_id in query string:
// l'identificazione applicativa avviene via header X-IBM-Client-Id/X-IBM-Client-Secret,
// vedi doPost)
const URLS = {
  functionsService:         () => `${HOST}/applications/newapvprdocre/ws/functionsService/v1/getFunctions`,
  forfaitService:           () => `${HOST}/applications/newapvprdocre/ws/ForfaitService/v1/getForfait`,
  ibxDetailForfaitService:  () => `${HOST}/applications/newapvprdocre/ws/ibxdetailforfaitservice/v1/getIbxDetailForfait`,
  ibxParametrageService:    () => `${HOST}/applications/newapvprdocre/ws/ibxparametrageservice/v1/getIbxParametrage`,
  ibxDetailtpService:       () => `${HOST}/applications/newapvprdocre/ibxdetailtpservice/v1/getIbxDetailTp`,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Helper: costruisce le sezioni riutilizzabili del payload
// ═══════════════════════════════════════════════════════════════════════════════

function wsSecurityHeader() {
  return `
  <soapenv:Header>
    <wsse:Security soapenv:mustUnderstand="1"
      xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd"
      xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">
      <wsse:UsernameToken>
        <wsse:Username>${USERNAME}</wsse:Username>
        <wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">${PASSWORD}</wsse:Password>
        <wsse:Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">ZlnzJSe0ABUVnzSW8mmZ1A==</wsse:Nonce>
        <wsu:Created>2024-01-01T00:00:00.000Z</wsu:Created>
      </wsse:UsernameToken>
    </wsse:Security>
  </soapenv:Header>`;
}

function vinBlock(params) {
  return `
        <spec:vin>
          <iden:WMI>${params.wmi}</iden:WMI>
          <iden:VDS>${params.vds}</iden:VDS>
          <iden:VIS>${params.vis}</iden:VIS>
        </spec:vin>`;
}

function ioBlock(params) {
  return `
        <io:langue>${params.langue}</io:langue>
        <io:pays>${params.pays}</io:pays>
        <io:mode>${params.mode ?? 'MODE_XML'}</io:mode>
        <io:marque>${params.marque}</io:marque>
        <io:paysUser>${params.paysUser ?? params.pays}</io:paysUser>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Payload builders (uno per metodo)
// ═══════════════════════════════════════════════════════════════════════════════

function buildPayload_functionsService(params) {
  let typedocXml = '';
  if (params.typedoc) {
    const list = Array.isArray(params.typedoc) ? params.typedoc : [params.typedoc];
    typedocXml = list.map(t => `<spec:listeTypeDoc>${t}</spec:listeTypeDoc>`).join('\n');
  }

  return `<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:fun="http://xml.inetpsa.com/Services/PsFdzFunctionsObjects/FunctionsService"
    xmlns:spec="http://xml.inetpsa.com/fdzsoa/functions/Commerce/APVTechnique/Reseau/Specific"
    xmlns:io="http://xml.inetpsa.com/fdzsoa/Commerce/APVTechnique/Reseau/Specific/IO"
    xmlns:iden="http://xml.inetpsa.com/fdzsoa/ProduitProcess/Vehicule/Identification">
  ${wsSecurityHeader()}
  <soapenv:Body>
    <fun:getFunctions>
      <spec:functionsRequest>
        ${ioBlock(params)}
        ${vinBlock(params)}
        ${typedocXml}
      </spec:functionsRequest>
    </fun:getFunctions>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildPayload_forfaitService(params) {
  const fonctionXml = Array.isArray(params.fonctionIdListe)
    ? params.fonctionIdListe.map(f => `<spec:fonctionIdListe>${f}</spec:fonctionIdListe>`).join('\n')
    : '<spec:fonctionIdListe></spec:fonctionIdListe>';

  return `<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:for="http://xml.inetpsa.com/Services/PsFdzForfaitObjects/ForfaitService"
    xmlns:spec="http://xml.inetpsa.com/fdzsoa/forfait/Commerce/APVTechnique/Reseau/Specific"
    xmlns:io="http://xml.inetpsa.com/fdzsoa/Commerce/APVTechnique/Reseau/Specific/IO"
    xmlns:iden="http://xml.inetpsa.com/fdzsoa/ProduitProcess/Vehicule/Identification">
  ${wsSecurityHeader()}
  <soapenv:Body>
    <for:getForfait>
      <spec:ForfaitRequest>
        ${ioBlock(params)}
        ${vinBlock(params)}
        <spec:codePdv>${params.codePdv}</spec:codePdv>
        ${fonctionXml}
        <spec:typeInternet>${params.typeInternet ?? ''}</spec:typeInternet>
      </spec:ForfaitRequest>
    </for:getForfait>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildPayload_ibxDetailForfaitService(params) {
  const niveauXml = params.niveau ? `<spec:niveau>${params.niveau}</spec:niveau>` : '';

  return `<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:ibx="http://xml.inetpsa.com/Services/PsFdzIbxDetailForfaitObjects/IbxDetailForfaitService"
    xmlns:spec="http://xml.inetpsa.com/fdzsoa/ibxdetailforfait/Commerce/APVTechnique/Reseau/Specific"
    xmlns:io="http://xml.inetpsa.com/fdzsoa/Commerce/APVTechnique/Reseau/Specific/IO"
    xmlns:iden="http://xml.inetpsa.com/fdzsoa/ProduitProcess/Vehicule/Identification">
  ${wsSecurityHeader()}
  <soapenv:Body>
    <ibx:getIbxDetailForfait>
      <spec:ibxdetailforfaitRequest>
        ${ioBlock(params)}
        ${vinBlock(params)}
        <spec:codeFF>${params.codeFF}</spec:codeFF>
        <spec:codePdv>${params.codePdv}</spec:codePdv>
        ${niveauXml}
      </spec:ibxdetailforfaitRequest>
    </ibx:getIbxDetailForfait>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildPayload_ibxParametrageService(params) {
  const fonctionXml = Array.isArray(params.FonctionIdListe)
    ? params.FonctionIdListe.map(f => `<spec:FonctionIdListe>${f}</spec:FonctionIdListe>`).join('\n')
    : '<spec:FonctionIdListe></spec:FonctionIdListe>';

  return `<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:ibx="http://xml.inetpsa.com/Services/PsFdzIbxParametrageObjects/IbxParametrageService"
    xmlns:spec="http://xml.inetpsa.com/fdzsoa/ibxparametrage/Commerce/APVTechnique/Reseau/Specific"
    xmlns:io="http://xml.inetpsa.com/fdzsoa/Commerce/APVTechnique/Reseau/Specific/IO"
    xmlns:iden="http://xml.inetpsa.com/fdzsoa/ProduitProcess/Vehicule/Identification">
  ${wsSecurityHeader()}
  <soapenv:Body>
    <ibx:getIbxParametrage>
      <spec:ibxparametrageRequest>
        ${ioBlock(params)}
        ${vinBlock(params)}
        ${fonctionXml}
      </spec:ibxparametrageRequest>
    </ibx:getIbxParametrage>
  </soapenv:Body>
</soapenv:Envelope>`;
}

function buildPayload_ibxDetailtpService(params) {
  return `<soapenv:Envelope
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
    xmlns:ibx="http://xml.inetpsa.com/Services/PsFdzIbxDetailTpObjects/IbxDetailTpService"
    xmlns:spec="http://xml.inetpsa.com/fdzsoa/ibxdetailtp/Commerce/APVTechnique/Reseau/Specific"
    xmlns:io="http://xml.inetpsa.com/fdzsoa/Commerce/APVTechnique/Reseau/Specific/IO"
    xmlns:iden="http://xml.inetpsa.com/fdzsoa/ProduitProcess/Vehicule/Identification">
  ${wsSecurityHeader()}
  <soapenv:Body>
    <ibx:getIbxDetailTp>
      <spec:ibxdetailtpRequest>
        ${ioBlock(params)}
        ${vinBlock(params)}
        <spec:refTp>${params.refTp}</spec:refTp>
        <spec:codePdv>${params.codePdv}</spec:codePdv>
      </spec:ibxdetailtpRequest>
    </ibx:getIbxDetailTp>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP call
// ═══════════════════════════════════════════════════════════════════════════════

function basicAuth() {
  return 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
}

async function doPost(url, xml, extraHeaders = {}) {
  const startedAt = Date.now();

  const headers = {
    'Content-Type':        'application/xml',
    'Accept':              'application/xml',
    'Authorization':       basicAuth(),
    'X-IBM-Client-Id':     IBM_CLIENT_ID,
    'X-IBM-Client-Secret': IBM_CLIENT_SECRET,
    ...extraHeaders,
  };

  console.log(JSON.stringify({
    logType: 'http_request',
    service: 'pkDocsoa',
    method: 'POST',
    url,
    proxy: PROXY_HOST ? `${PROXY_HOST}:${PROXY_PORT}` : null,
    headers: { ...headers, Authorization: '***REDACTED***', 'X-IBM-Client-Secret': '***REDACTED***' },
    body: redactXml(xml),
  }));

  let response;
  try {
    const httpsAgent = await getHttpsAgent();
    response = await axios.post(url, xml, {
      httpsAgent,
      proxy:   axiosProxy,
      timeout: TIMEOUT_MS,
      headers,
    });
  } catch (err) {
    console.log(JSON.stringify({
      logType: 'http_error',
      service: 'pkDocsoa',
      method: 'POST',
      url,
      durationMs: Date.now() - startedAt,
      statusCode: err.response?.status,
      error: err.message,
      body: redactXml(err.response?.data),
    }));
    throw err;
  }

  console.log(JSON.stringify({
    logType: 'http_response',
    service: 'pkDocsoa',
    method: 'POST',
    url,
    statusCode: response.status,
    durationMs: Date.now() - startedAt,
    body: redactXml(response.data),
  }));

  if (response.status < 200 || response.status > 206) {
    throw new Error(`HTTP ${response.status}: ${response.data}`);
  }

  return response.data;
}

// ═══════════════════════════════════════════════════════════════════════════════
// XML parsing helpers
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Rimuove i namespace prefix dai tag XML (es. soap:Body → Body, ns1:foo → foo)
 * Replica: preg_replace('/(<\/?)(\w+):([^>]*>)/', '$1$3', $response)
 */
function stripNamespacePrefixes(xml) {
  return xml.replace(/(<\/?)([\w]+):([\s\S]*?>)/g, '$1$3');
}

/**
 * Parsa XML → oggetto JS.
 * mergeAttrs:true → attributi accessibili come proprietà dirette (come PHP SimpleXML)
 */
async function parseXml(xml) {
  return xml2js.parseStringPromise(xml, {
    explicitArray: false,
    explicitRoot:  false,
    mergeAttrs:    true,
  });
}

/**
 * Decodifica il campo `resultat` (base64 → XML → oggetto JS)
 */
async function decodeResultat(base64str) {
  if (!base64str) return null;
  const decoded = Buffer.from(base64str, 'base64').toString('utf-8');
  return parseXml(decoded);
}

/**
 * Normalizza un valore in array (gestisce singolo oggetto o array)
 */
function toArray(val) {
  if (val === null || val === undefined) return [];
  return Array.isArray(val) ? val : [val];
}

// ─── Estrazione dei record "pacchetto" dal risultato decodificato di forfaitService/
// ibxParametrageService ──────────────────────────────────────────────────────────
// Le risposte reali di DocSOA non sono un array piatto: es. ibxParametrageService
// restituisce { parametrage: { paramTP: { docByFonctionListe: { doc: [ {refAff, ref,
// idFonction, ...}, ... ] } }, paramPE: {...}, paramFF: {...} } }. Il codice pacchetto
// (refAff) è quindi annidato a più livelli. Questa lista deve restare allineata con
// CODE_FIELDS in pkManager/PkManager.js (buildDocsoaMap).
const CODE_FIELDS = ['refAff', 'id', 'code', 'codice', 'codeFF', 'refForfait', 'fonctionId', 'idFunction'];

function hasCodeField(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return CODE_FIELDS.some((field) => typeof obj[field] === 'string' && obj[field]);
}

// Scende ricorsivamente nell'oggetto/array finché non trova nodi con un campo
// codice riconosciuto (CODE_FIELDS): quei nodi sono trattati come "foglie" e non
// vengono ulteriormente esplorati.
function flattenPackageNodes(node, out = []) {
  if (node === null || node === undefined) return out;
  if (Array.isArray(node)) {
    for (const item of node) flattenPackageNodes(item, out);
    return out;
  }
  if (typeof node === 'object') {
    if (hasCodeField(node)) {
      out.push(node);
      return out;
    }
    for (const key of Object.keys(node)) {
      flattenPackageNodes(node[key], out);
    }
  }
  return out;
}

// Normalizza il `data` decodificato di forfaitService/ibxParametrageService in un
// array di record pacchetto. Se il payload è già un array piatto con un campo
// codice al primo livello lo usa direttamente (retro-compatibile); altrimenti
// esegue una ricerca in profondità; se non trova nulla, effettua un passthrough
// grezzo per non perdere dati con schema imprevisto.
function extractPackageItems(data) {
  const topArr = toArray(data);
  if (topArr.some(hasCodeField)) return topArr;

  const deep = flattenPackageNodes(data);
  if (deep.length) return deep;

  return topArr;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Classe DocSOARestClient
// ═══════════════════════════════════════════════════════════════════════════════

class DocSOARestClient {

  // ── functionsService ─────────────────────────────────────────────────────────
  // Lista gerarchica delle funzioni/categorie disponibili per un VIN
  async functionsService(params) {
    const xml      = buildPayload_functionsService(params);
    const rawXml   = await doPost(URLS.functionsService(), xml);
    const clean    = stripNamespacePrefixes(rawXml);
    const parsed   = await parseXml(clean);

    // controlla errore
    if (rawXml.includes('<codeRetour>-1</codeRetour>')) {
      return { success: false, data: rawXml, message: 'ERROR from DocSOA: codeRetour -1' };
    }

    const listFunctions = parsed?.Body?.getFunctionsResponse?.functionsResponse?.listFunctions;
    if (!listFunctions) {
      return { success: false, data: null, message: 'listFunctions not found in response' };
    }

    const data = recursiveParsing(toArray(listFunctions));
    return { success: true, data };
  }

  // ── forfaitService ───────────────────────────────────────────────────────────
  // Lista dei forfait (pacchetti manutenzione) per funzioni + VIN
  async forfaitService(params) {
    const xml    = buildPayload_forfaitService(params);
    const rawXml = await doPost(URLS.forfaitService(), xml);
    const clean  = stripNamespacePrefixes(rawXml);
    const parsed = await parseXml(clean);

    const forfaitResp = parsed?.Body?.getForfaitResponse?.ForfaitResponse;
    if (!forfaitResp) {
      return { success: false, data: null, message: 'ForfaitResponse not found' };
    }

    const codeRetour = Number(forfaitResp.codeRetour ?? 0);
    if (codeRetour < 0) {
      const errCode  = forfaitResp.error?.errorCode  ?? '';
      const errLabel = forfaitResp.error?.errorLabel ?? '';
      return { success: false, data: null, message: `DocSOA error ${errCode}: ${errLabel}` };
    }

    const data = await decodeResultat(forfaitResp.resultat);
    return { success: true, data };
  }

  // ── ibxDetailForfaitService ──────────────────────────────────────────────────
  // Dettaglio di un forfait specifico (codeFF)
  async ibxDetailForfaitService(params) {
    const xml    = buildPayload_ibxDetailForfaitService(params);
    const rawXml = await doPost(URLS.ibxDetailForfaitService(), xml);
    const clean  = stripNamespacePrefixes(rawXml);
    const parsed = await parseXml(clean);

    const ibxResp = parsed?.Body?.getIbxDetailForfaitResponse?.ibxdetailforfaitResponse;
    if (!ibxResp) {
      return { success: false, data: null, message: 'ibxdetailforfaitResponse not found' };
    }

    if (!ibxResp.resultat) {
      return { success: true, data: null, message: 'Empty resultat' };
    }

    const data = await decodeResultat(ibxResp.resultat);
    return { success: true, data };
  }

  // ── ibxParametrageService ────────────────────────────────────────────────────
  // Parametri QuickEstimate per le funzioni selezionate
  async ibxParametrageService(params) {
    const xml    = buildPayload_ibxParametrageService(params);
    const rawXml = await doPost(URLS.ibxParametrageService(), xml);
    const clean  = stripNamespacePrefixes(rawXml);
    const parsed = await parseXml(clean);

    const ibxResp = parsed?.Body?.getIbxParametrageResponse?.ibxparametrageResponse;
    if (!ibxResp) {
      return { success: false, data: null, message: 'ibxparametrageResponse not found' };
    }

    const data = await decodeResultat(ibxResp.resultat);
    return { success: true, data };
  }

  // ── ibxDetailtpService ───────────────────────────────────────────────────────
  // Dettaglio tempo/prezzo di una specifica TP (refTp)
  async ibxDetailtpService(params) {
    const xml    = buildPayload_ibxDetailtpService(params);
    const rawXml = await doPost(URLS.ibxDetailtpService(), xml);
    const clean  = stripNamespacePrefixes(rawXml);
    const parsed = await parseXml(clean);

    const ibxResp = parsed?.Body?.getIbxDetailTpResponse?.ibxdetailtpResponse;
    if (!ibxResp) {
      return { success: false, data: null, message: 'ibxdetailtpResponse not found' };
    }

    if (!ibxResp.resultat) {
      return { success: false, data: null, message: 'Empty resultat in ibxDetailtpResponse' };
    }

    const data = await decodeResultat(ibxResp.resultat);
    return { success: true, data };
  }

  // ── getCompletePkSOAList ─────────────────────────────────────────────────────
  // Orchestratore: recupera la struttura funzioni, poi lancia in parallelo
  // forfaitService (FP) e ibxParametrageService (QE), unisce i risultati.
  // Corrisponde a JOBCXPAjaxController::getCompletePkSOAList (PHP).
  // Restituisce { success, data: [...FP, ...QE], message }
  async getCompletePkSOAList({ vin, codbrand, ldp, langue, pays, codePdv, paysUser, mode, typeInternet }) {
    const vinParams = vinParts(vin);
    const ioParams  = {
      langue,
      pays,
      marque:   codbrand,
      paysUser: paysUser ?? pays,
      mode:     mode ?? 'MODE_XML',
    };

    // Step 1: struttura funzioni (chiamata sequenziale obbligatoria)
    console.log('[getCompletePkSOAList] Step 1: functionsService...');
    const lev1 = await this.functionsService({ ...vinParams, ...ioParams });

    if (!lev1.success) {
      console.warn('[getCompletePkSOAList] functionsService fallito:', lev1.message);
      return { success: false, data: null, message: lev1.message };
    }

    // Step 2: estrae idFunctionArr dalla gerarchia a 3 livelli
    const idFunctionArr = [];
    for (const row1 of toArray(lev1.data)) {
      if (row1.idFunction) idFunctionArr.push(row1.idFunction);
      for (const row11 of toArray(row1.listFunctions)) {
        if (row11.idFunction) idFunctionArr.push(row11.idFunction);
        for (const row111 of toArray(row11.listFunctions)) {
          if (row111.idFunction) idFunctionArr.push(row111.idFunction);
        }
      }
    }
    console.log(`[getCompletePkSOAList] Step 1 OK — ${idFunctionArr.length} funzioni trovate`);

    if (idFunctionArr.length === 0) {
      console.warn('[getCompletePkSOAList] Nessuna funzione trovata, salto Step 3.');
      return { success: true, data: null, message: 'No functions found for this VIN/brand' };
    }

    // Step 3: forfait (FP) e quickEstimate (QE) in parallelo.
    // Ogni chiamata è isolata: un timeout su una non interrompe l'altra.
    console.log('[getCompletePkSOAList] Step 3: forfaitService + ibxParametrageService in parallelo...');
    const toSafeResult = (err) => ({ success: false, data: null, message: err.message ?? String(err) });
    const [forfaitResult, qeResult] = await Promise.all([
      this.forfaitService({
        ...vinParams, ...ioParams,
        codePdv,
        ldp,
        fonctionIdListe: idFunctionArr,
        typeInternet:    typeInternet ?? null,
      }).catch(toSafeResult),
      this.ibxParametrageService({
        ...vinParams, ...ioParams,
        FonctionIdListe: idFunctionArr,
      }).catch(toSafeResult),
    ]);

    const FParr = forfaitResult.success ? extractPackageItems(forfaitResult.data) : [];
    const QEarr = qeResult.success      ? extractPackageItems(qeResult.data)      : [];

    if (!forfaitResult.success) {
      console.warn('[getCompletePkSOAList] forfaitService fallito:', forfaitResult.message);
    } else {
      console.log(`[getCompletePkSOAList] forfaitService OK — ${FParr.length} risultati FP`);
      // Debug: espone i nomi campo reali del primo risultato per diagnosi mapping codici.
      if (FParr.length) console.log('[getCompletePkSOAList] FP sample:', JSON.stringify(FParr[0]));
    }
    if (!qeResult.success) {
      console.warn('[getCompletePkSOAList] ibxParametrageService fallito:', qeResult.message);
    } else {
      console.log(`[getCompletePkSOAList] ibxParametrageService OK — ${QEarr.length} risultati QE`);
      // Debug: espone i nomi campo reali del primo risultato per diagnosi mapping codici.
      if (QEarr.length) console.log('[getCompletePkSOAList] QE sample:', JSON.stringify(QEarr[0]));
    }

    const pklistComplete = [...FParr, ...QEarr];

    return {
      success: true,
      data:    pklistComplete.length ? pklistComplete : null,
      message: '',
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// recursiveParsing — porta del metodo PHP omonimo per functionsService
// ═══════════════════════════════════════════════════════════════════════════════

function recursiveParsing(list) {
  if (!list || !list.length) return null;

  // Ordina per ordreAffichage (come array_multisort PHP)
  const sorted = [...list].sort((a, b) => {
    const oa = Number(a.ordreAffichage ?? 0);
    const ob = Number(b.ordreAffichage ?? 0);
    return oa - ob;
  });

  const res = [];
  for (const row of sorted) {
    if (row.isAvailable === undefined) continue;

    const img = row.imagePath ? require('path').basename(row.imagePath) : '';

    const item = {
      ordreAffichage: row.ordreAffichage,
      idFunction:     row.idFunction,
      IdFunctionPath: row.IdFunctionPath,
      Label:          row.Label,
      image:          img,
      listFunctions:  row.listFunctions
        ? recursiveParsing(toArray(row.listFunctions))
        : '',
    };

    res.push(item);
  }

  return res;
}

// ─── Helper: estrai wmi/vds/vis da VIN ────────────────────────────────────────
function vinParts(vin) {
  return {
    wmi: vin.substring(0, 3),
    vds: vin.substring(3, 9),
    vis: vin.substring(9, 17),
  };
}

module.exports = { DocSOARestClient, vinParts };
