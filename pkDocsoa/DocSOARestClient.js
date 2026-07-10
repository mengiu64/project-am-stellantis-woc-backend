'use strict';

require('dotenv').config();
const axios  = require('axios');
const xml2js = require('xml2js');
const https  = require('https');

// ─── Configurazione (da .env) ──────────────────────────────────────────────────
const HOST      = (process.env.DOCSOA_HOST ?? '').replace(/\/$/, ''); // es: https://api.inetpsa.com
const USERNAME  = process.env.DOCSOA_USERNAME;
const PASSWORD  = process.env.DOCSOA_PASSWORD;
const CLIENT_ID = process.env.DOCSOA_CLIENT_ID;

// Proxy opzionale (richiesto sulla rete corporativa Stellantis/PSA)
const PROXY_HOST = process.env.PROXY_HOST;
const PROXY_PORT = process.env.PROXY_PORT ? Number(process.env.PROXY_PORT) : 8080;

const TIMEOUT_MS = Number(process.env.DOCSOA_TIMEOUT_MS ?? 60_000);
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

// Configurazione proxy per axios (usata solo se PROXY_HOST è definito)
const axiosProxy = PROXY_HOST
  ? { host: PROXY_HOST, port: PROXY_PORT, protocol: 'http' }
  : false;

// URL dei singoli servizi
const URLS = {
  functionsService:         () => `${HOST}/applications/newapvprdocre/ws/functionsService/v1?client_id=${CLIENT_ID}`,
  forfaitService:           () => `${HOST}/applications/newapvprdocre/ws/ForfaitService/v1?client_id=${CLIENT_ID}`,
  ibxDetailForfaitService:  () => `${HOST}/applications/newapvprdocre/ws/ibxdetailforfaitservice/v1?client_id=${CLIENT_ID}`,
  ibxParametrageService:    () => `${HOST}/applications/newapvprdocre/ws/ibxparametrageservice/v1?client_id=${CLIENT_ID}`,
  ibxDetailtpService:       () => `${HOST}/applications/newapvprdocre/ibxdetailtpservice/v1`,
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
  if (process.env.DEBUG_SOAP) {
    console.log('\n[DEBUG] POST', url);
    console.log('[DEBUG] Proxy:', PROXY_HOST ? `${PROXY_HOST}:${PROXY_PORT}` : 'none');
    console.log('[DEBUG] Request:\n', xml);
  }

  const response = await axios.post(url, xml, {
    httpsAgent,
    proxy:   axiosProxy,
    timeout: TIMEOUT_MS,
    headers: {
      'Content-Type':  'application/xml',
      'Accept':        'application/xml',
      'Authorization': basicAuth(),
      ...extraHeaders,
    },
  });

  if (process.env.DEBUG_SOAP) {
    console.log('\n[DEBUG] Response status:', response.status);
    console.log('[DEBUG] Response body:\n', response.data);
  }

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
    const rawXml = await doPost(URLS.ibxDetailtpService(), xml, {
      'X-IBM-Client-Id': CLIENT_ID,
    });
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

    const FParr = forfaitResult.success ? toArray(forfaitResult.data) : [];
    const QEarr = qeResult.success      ? toArray(qeResult.data)      : [];

    if (!forfaitResult.success) {
      console.warn('[getCompletePkSOAList] forfaitService fallito:', forfaitResult.message);
    } else {
      console.log(`[getCompletePkSOAList] forfaitService OK — ${FParr.length} risultati FP`);
    }
    if (!qeResult.success) {
      console.warn('[getCompletePkSOAList] ibxParametrageService fallito:', qeResult.message);
    } else {
      console.log(`[getCompletePkSOAList] ibxParametrageService OK — ${QEarr.length} risultati QE`);
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
