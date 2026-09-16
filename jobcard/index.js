'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js list        <dealerId> [options]
 *   node index.js listCurrent <dealerId> <currentDate>
 *   node index.js details     <jobCardId>
 *   node index.js saveJobcard <payloadJsonFile>
 *   node index.js dml         <jobCardId>
 *
 * Options for "list" (key=value):
 *   vin=<value>
 *   creationStartDate=<ISO8601>   creationEndDate=<ISO8601>
 *   deliveryStartDate=<ISO8601>   deliveryEndDate=<ISO8601>
 *   receptionStartDate=<ISO8601>  receptionEndDate=<ISO8601>
 *   licensePlate=<value>
 *   dmsRepairOrderId=<value>
 *   customerName=<value>
 *   page=<number>        (default: 1)
 *   pageSize=<number>    (default: 50)
 *   sortBy=<field>       (default: jobCardId)
 *   sortOrder=asc|desc   (default: asc)
 *
 * "listCurrent" (getJobCardListCurrent) richiede dealerId e currentDate
 * ("YYYY-MM-DD", es. "2026-05-20"): combina reception/delivery/creation di
 * oggi/ultimi 7 giorni in un unico jobCardList deduplicato (v.
 * jobCardService.getJobCardListCurrent).
 *
 * Examples:
 *   node index.js list 0062219
 *   node index.js list 0062219 page=2 pageSize=10 sortBy=creationDate sortOrder=desc
 *   node index.js list 0062219 vin=3C4NJCBH7KT831816 creationStartDate=2024-01-01T00:00:00Z
 *   node index.js listCurrent 0062219 2026-05-20
 *   node index.js details 79
 *   node index.js saveJobcard ./payload.json
 *   node index.js dml 79
 *
 * "dml" (getDataFromDMLFromTmp) legge /tmp/<jobCardId>.json, già salvato da
 * una precedente "details" (getJobCardDetails/saveJobCardDetailsToTmp), e
 * applica l'arricchimento prezzo/disponibilità DML (getDataFromDML) al
 * relativo jobCardDetail. Se il file manca (es. /tmp non condiviso tra
 * istanze Lambda diverse), richiama DGT (getJobCardDetails, con un
 * bearerToken PingFederate) per rigenerarlo e rilegge il file prodotto.
 *
 * Per costruire il Sender dinamico dell'inquiry DMS (v.
 * jobCardService.buildDmsSender), "dml" accetta anche un sessionContext,
 * derivato da:
 *  - username: SEMPRE da event.requestContext.authorizer.sub quando presente
 *    (Lambda Authorizer — mai un valore fornito dal chiamante, stessa
 *    convenzione di session/pkFavorite), con fallback a body.username SOLO
 *    quando l'evento non ha alcun requestContext.authorizer (invocazione
 *    diretta/CLI di test);
 *  - mainSincom/market/language/dealerCountryCode: il frontend NON li passa
 *    (e non deve passarli) — sono letti da body SOLO come override
 *    opzionale/di test; nel flusso reale sono assenti, e buildDmsSender li
 *    risolve automaticamente da session/src/sessionContextCache.js
 *    ::getCachedSessionContext(username) (stessa risoluzione myPeople della
 *    lambda session, con cache best-effort su /tmp/session-context-<username>.json,
 *    utile quando la stessa istanza Lambda "warm" gestisce più richieste
 *    "dml" dello stesso utente in rapida successione).
 * Questi campi sono opzionali e "best effort": se assenti E non risolvibili
 * da session (username mancante, myPeople irraggiungibile, ecc.),
 * buildDmsSender semplicemente non li valorizza e il Sender resta sui
 * default statici di dms/config.js — "dml" non richiede quindi
 * autenticazione obbligatoria.
 *
 * "saveJobcard" (POST /jobCard) è la stessa azione esposta anche dalla lambda
 * djc (stessa "declinazione" della jobcard, stesso client PingFederate/DGT):
 * API Gateway instrada le richieste POST verso la lambda djc, ma il metodo è
 * disponibile anche qui (chiamata diretta/CLI, coerenza tra le due lambda).
 */

const fs = require('fs');
const path = require('path');

const { getBearerToken } = require('./authService');
const { getJobCardList, getJobCardListCurrent, getJobCardDetails, saveJobCard, getDataFromDMLFromTmp } = require('./jobCardService');
const { getCachedSessionData } = require('../session/src/sessionContextCache');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = ['list', 'listCurrent', 'details', 'saveJobcard', 'dml'];

/**
 * Estrae lo username autenticato per il Sender dinamico dell'azione "dml"
 * (jobCardService.buildDmsSender -> serviceId): se l'evento ha un
 * requestContext.authorizer, SOLO authorizer.sub è attendibile (stessa
 * convenzione di session/pkFavorite — mai un valore fornito dal body).
 * Altrimenti (nessun authorizer nell'evento: invocazione diretta/CLI di
 * test) si accetta body.username. A differenza di session/pkFavorite, qui
 * l'assenza di username non blocca la richiesta (401): il Sender dinamico è
 * un arricchimento best-effort, "dml" resta utilizzabile anche senza
 * identità risolta (v. buildDmsSender).
 */
function resolveUsername(event, body) {
  const authz = (event && event.requestContext && event.requestContext.authorizer) || null;
  if (authz) {
    return authz.sub || null;
  }
  return body.username || null;
}

/**
 * Costruisce il sessionContext da passare a getDataFromDMLFromTmp per il
 * Sender dinamico dell'inquiry DMS (v. jobCardService.buildDmsSender): lo
 * username è SEMPRE da resolveUsername (authorizer.sub, mai dal body quando
 * presente un authorizer). mainSincom/market/language/dealerCountryCode da
 * body sono un override opzionale/di test: nel flusso reale il frontend non
 * li invia, e buildDmsSender li risolve da solo (automaticamente, dato solo
 * lo username) tramite session/src/sessionContextCache.js.
 */
function resolveSessionContext(event, body) {
  return {
    username: resolveUsername(event, body),
    mainSincom: body.mainSincom,
    market: body.market ?? body.codmarket,
    language: body.language,
    dealerCountryCode: body.dealerCountryCode ?? body.marketIso,
  };
}

// ── Sincronizzazione appuntamenti NAGA (post saveJobcard) ──────────────────────

/**
 * Legge un file JSON da /tmp in modo best-effort (usato per <jobCardSrpId>.json,
 * cache locale scritta da una precedente "details"/testCartDML.js): se il file
 * manca o non è leggibile/parsabile, ritorna {} invece di sollevare
 * un'eccezione, cosi' i soli campi da esso derivati restano assenti dal
 * payload updatenaga (stesso approccio "best effort" già usato altrove nel
 * progetto per gli arricchimenti opzionali).
 */
function readTmpJsonSafe(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join('/tmp', fileName), 'utf8'));
  } catch (_) {
    return {};
  }
}

/**
 * Converte un ISO 8601 date-time ("2026-09-10T08:15:00.000Z") nella sola parte
 * data "YYYY-MM-DD" ("2026-09-10"), richiesta da recepDateStr (createnaga).
 */
function toDateOnly(isoDateTime) {
  if (!isoDateTime) return null;
  return String(isoDateTime).slice(0, 10);
}

/**
 * Converte un ISO 8601 date-time ("2026-09-10T08:15:00.000Z") nella data
 * "a mezzanotte" richiesta da recepDate/recetDate ("2026-09-10T00:00:00.000Z").
 */
function toMidnightIso(isoDateTime) {
  const datePart = toDateOnly(isoDateTime);
  return datePart ? `${datePart}T00:00:00.000Z` : null;
}

/**
 * Converte un ISO 8601 date-time ("2026-09-24T00:00:00.000Z") nel formato
 * "YYYYMMDD" ("20260924"), richiesto da recepDate/recepDateStr (createnaga).
 */
function toYYYYMMDD(isoDateTime) {
  const datePart = toDateOnly(isoDateTime);
  return datePart ? datePart.replace(/-/g, '') : null;
}

/**
 * Estrae l'orario "HHmm" da un ISO 8601 date-time ("2026-09-10T08:15:00.000Z" -> "0815"),
 * richiesto da recepHours/recetHours.
 */
function toHoursMinutes(isoDateTime) {
  if (!isoDateTime) return null;
  const match = String(isoDateTime).match(/T(\d{2}):(\d{2})/);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * Raccoglie i jobDescription sia dal payload di saveJobcard (payload.jobs[])
 * sia, quando disponibile, da /tmp/<jobCardSrpId>.json (stessa cache letta
 * da getDataFromDMLFromTmp/testCartDML.js per una precedente jobCardDetails):
 * usati per popolare intervention[].nom del payload updatenaga.
 */
function collectJobDescriptions(payload) {
  const descriptions = [];

  for (const job of payload?.jobs ?? []) {
    if (job?.jobDescription) descriptions.push(job.jobDescription);
  }

  const jobCardSrpId = payload?.roInfo?.jobCardSrpId;
  if (jobCardSrpId) {
    const cached = readTmpJsonSafe(`${jobCardSrpId}.json`);
    const jobCardDetail = cached?.jobCardDetail ?? cached;
    for (const job of jobCardDetail?.jobs ?? []) {
      if (job?.jobDescription) descriptions.push(job.jobDescription);
    }
  }

  return descriptions;
}

/**
 * Cerca il primo valore non-null di `appointments[].<section>.<field>`
 * (es. section="reception", field="receptionDateTime") scorrendo l'intero
 * array payload.appointments[], usato come fallback quando lo stesso campo è
 * assente sull'appuntamento corrente (v. resolveReceptionDelivery).
 */
function firstNonNullAppointmentField(appointments, section, field) {
  for (const item of appointments) {
    const value = item?.[section]?.[field];
    if (value != null) return value;
  }
  return null;
}

/**
 * Risolve reception/delivery da usare per un appuntamento: i singoli campi
 * (receptionServiceAdvisorId/receptionDateTime, deliveryServiceAdvisorId/
 * deliveryDateTime) sono presi prioritariamente da appointment.reception/
 * appointment.delivery; se un campo è assente/null su quell'appuntamento, si
 * ripiega sul primo valore non-null trovato in payload.appointments[]
 * (l'intero array del payload saveJobcard, non solo l'appuntamento corrente)
 * per lo stesso campo — utile quando l'appuntamento in lavorazione (es. un
 * nuovo appuntamento senza appointmentInternalId, da creare con createnaga)
 * non porta di per sé i dati di reception/delivery, già presenti altrove nel
 * payload.
 *
 * @param {object} payload - payload di saveJobcard (jobCardPayload)
 * @param {object} appointment - elemento di payload.appointments[] in lavorazione
 * @returns {{ reception: object, delivery: object }}
 */
function resolveReceptionDelivery(payload, appointment) {
  const appointments = Array.isArray(payload?.appointments) ? payload.appointments : [];

  const reception = {
    receptionServiceAdvisorId:
      appointment?.reception?.receptionServiceAdvisorId
      ?? firstNonNullAppointmentField(appointments, 'reception', 'receptionServiceAdvisorId'),
    receptionDateTime:
      appointment?.reception?.receptionDateTime
      ?? firstNonNullAppointmentField(appointments, 'reception', 'receptionDateTime'),
  };
  const delivery = {
    deliveryServiceAdvisorId:
      appointment?.delivery?.deliveryServiceAdvisorId
      ?? firstNonNullAppointmentField(appointments, 'delivery', 'deliveryServiceAdvisorId'),
    deliveryDateTime:
      appointment?.delivery?.deliveryDateTime
      ?? firstNonNullAppointmentField(appointments, 'delivery', 'deliveryDateTime'),
  };

  return { reception, delivery };
}

/**
 * Risolve in un'unica chiamata i dati usati sia da buildCreateNagaPayload sia
 * da buildUpdateNagaPayload: i dati di sessione (myPeople, via
 * session/src/sessionContextCache.js::getCachedSessionData, cache condivisa
 * DynamoDB TmpCacheTable, chiave `session:context:<username>` — STESSO
 * meccanismo già usato da jobCardService.js::buildDmsSender per il Sender
 * dinamico dell'inquiry DMS) e il VIN (da
 * payload.vehicleInfo.identification.vin, stesso payload di saveJobcard).
 * Calcolato una sola volta per saveJobcard (non per singolo appuntamento),
 * cosi' una eventuale sequenza createnaga+updatenaga sullo stesso
 * appuntamento non richiama due volte myPeople.
 *
 * NON viene più letto un file /tmp/session.json o /tmp/VIN.json: quei file
 * non sono mai stati scritti da nessun modulo del progetto e, anche se lo
 * fossero stati, /tmp è locale all'istanza del singolo container Lambda e
 * non è mai condiviso tra funzioni diverse (v. commento in
 * session/src/dynamoCache.js).
 *
 * Interamente best-effort: se `username` è assente o myPeople non è
 * raggiungibile, getCachedSessionData ritorna null e session vale {} — i soli
 * campi da essa derivati restano null nei payload create/updatenaga.
 *
 * @param {object} payload - payload di saveJobcard (jobCardPayload)
 * @param {string|null} [username] - username autenticato (authorizer.sub)
 * @returns {Promise<{ session: object, vin: string|null }>}
 */
async function resolveNagaContext(payload, username) {
  const session = (await getCachedSessionData(username)) ?? {};
  const vin = payload?.vehicleInfo?.identification?.vin ?? null;
  return { session, vin };
}

/**
 * Costruisce il payload createnaga (azione agendaSoaNaga) per un elemento di
 * payload.appointments[] privo di appointmentInternalId: crea un nuovo
 * appuntamento NAGA, che verrà poi aggiornato con updatenaga (v.
 * syncAppointmentsToNaga) usando l'appointmentInternalId restituito.
 * I campi sono valorizzati con le stesse fonti dati di buildUpdateNagaPayload
 * (v. resolveNagaContext): startRecep/recepHours dalla reception
 * dell'appuntamento (con fallback su payload.appointments[] se assente, v.
 * resolveReceptionDelivery); recepDate/recepDateStr sono nel formato
 * "YYYYMMDD" (es. "20260924", v. toYYYYMMDD); user è un valore fisso
 * ("M0019234"), non derivato dalla sessione; pdvid/locale/brand dalla
 * sessione utente, vehiculeId dal VIN del payload saveJobcard.
 *
 * @param {object} payload - payload di saveJobcard (jobCardPayload)
 * @param {object} appointment - elemento di payload.appointments[]
 * @param {{ session: object, vin: string|null }} context - v. resolveNagaContext
 */
function buildCreateNagaPayload(payload, appointment, { session, vin }) {
  const { reception } = resolveReceptionDelivery(payload, appointment);

  return {
    startRecep: reception.receptionServiceAdvisorId ?? null,
    recepDate: toYYYYMMDD(reception.receptionDateTime),
    recepDateStr: toYYYYMMDD(reception.receptionDateTime),
    recepHours: toHoursMinutes(reception.receptionDateTime),
    pdvid: session.pdvId ?? null,
    user: 'M0019234',
    locale: session.locale ?? null,
    brand: session.brandvehic_reftech ?? null,
    vehiculeId: vin,
    source: 'WiAdvisor',
  };
}

/**
 * Costruisce il payload updatenaga (azione agendaSoaNaga) a partire da un
 * elemento di payload.appointments[] e dal payload saveJobcard stesso.
 *
 * `username` è SEMPRE quello autenticato (event.requestContext.authorizer.sub,
 * risolto dal chiamante via resolveUsername — mai un valore fornito dal
 * body/payload, stessa convenzione di session/pkFavorite).
 *
 * reception/delivery sono risolti con fallback su payload.appointments[] se
 * assenti sul singolo appuntamento (v. resolveReceptionDelivery).
 *
 * @param {object} payload - payload di saveJobcard (jobCardPayload)
 * @param {object} appointment - elemento di payload.appointments[] (con
 *                                appointmentInternalId valorizzato: quello
 *                                originale, o quello appena restituito da
 *                                createnaga — v. syncAppointmentsToNaga)
 * @param {{ session: object, vin: string|null }} context - v. resolveNagaContext
 */
function buildUpdateNagaPayload(payload, appointment, { session, vin }) {
  const { reception, delivery } = resolveReceptionDelivery(payload, appointment);

  return {
    rdvBrand: session.brandvehic_reftech ?? null,
    apptId: appointment.appointmentInternalId,
    startRecep: reception.receptionServiceAdvisorId ?? null,
    endRecep: delivery.deliveryServiceAdvisorId ?? null,
    recepDate: toMidnightIso(reception.receptionDateTime),
    recetDate: toMidnightIso(delivery.deliveryDateTime),
    recepHours: toHoursMinutes(reception.receptionDateTime),
    recetHours: toHoursMinutes(delivery.deliveryDateTime),
    recepTimeSlot: 1,
    recetTimeSlot: 1,
    reason: null,
    apptStatus: null,
    comments: '',
    rea: false,
    exceedworkshop: false,
    pdvid: session.pdvId ?? null,
    locale: session.locale ?? null,
    sfPdvBrand: session.brandvehic_fca ?? null,
    user: session.username ?? null,
    clientLanguage: session.locale ?? null,
    idCustomerSF: '',
    idVehicleSF: '',
    intervention: collectJobDescriptions(payload).map((nom) => ({
      nom,
      duration: '',
      team: null,
      numLdt: '',
      dureeref: null,
      category: null,
      code: 0,
      memberPresent: 'false',
    })),
    pdvLanguageList: session.locale ? [session.locale] : [],
    sendSMS: null,
    idVINSF: vin,
    mobilityList: [],
    otherMobilityList: [],
    mapCarac: {},
    isMobilityPresent: false,
    isDossierDeleted: false,
    isModification: 'true',
    apptDossierId: null,
    idDossierSF: null,
    source: 'WiAdvisor',
    clientNom: null,
  };
}

/**
 * Estrae l'appointmentInternalId dalla risposta Lambda (già in formato HTTP
 * response, v. agendaSoaNaga/src/handlers/createnaga.js::response) dell'azione
 * "createnaga": il body è una stringa JSON `{ success, data }`, dove `data` è
 * la risposta grezza del servizio NAGA — es.
 * `{ isValid, rdvId, smsConsent, panierURL, errorMessage, dossierId, ... }` —
 * e il campo da usare come appointmentInternalId è `rdvId`. Cerca il campo sia
 * annidato in `data` sia (fallback) alla radice, per tollerare piccole
 * differenze di forma della risposta upstream. Ritorna null (invece di
 * sollevare un'eccezione) se il body manca/non è parsabile o il campo non è
 * presente — coerente con l'approccio best-effort del resto di questa
 * sincronizzazione.
 */
function extractAppointmentInternalId(lambdaResult) {
  try {
    const parsedBody = JSON.parse(lambdaResult?.body ?? '{}');
    return parsedBody?.data?.rdvId ?? parsedBody?.rdvId ?? null;
  } catch (_) {
    return null;
  }
}

/**
 * Per ciascun elemento di payload.appointments[], richiama in-process le
 * azioni "createnaga"/"updatenaga" della lambda agendaSoaNaga (stesso pattern
 * di require cross-cartella già usato da pkManager/PkManager.js) per
 * sincronizzare l'appuntamento NAGA dopo un saveJobcard riuscito:
 *  - se appointmentInternalId è assente/vuoto (null o ""), crea prima un nuovo
 *    appuntamento NAGA (azione "createnaga", v. buildCreateNagaPayload): solo
 *    se la risposta contiene un appointmentInternalId (v.
 *    extractAppointmentInternalId) si procede con "updatenaga" per quello
 *    stesso appuntamento; altrimenti "updatenaga" viene saltato (loggando un
 *    warning) per quell'elemento;
 *  - se appointmentInternalId è già valorizzato, si richiama "updatenaga"
 *    direttamente, come in precedenza.
 * Quando createnaga restituisce un nuovo appointmentInternalId, questo viene
 * anche scritto (mutazione diretta) sull'elemento di payload.appointments[]
 * corrispondente, cosi' resta disponibile al chiamante che, dopo questa
 * funzione, invia lo stesso payload a saveJobCard (v. runSaveJobcard).
 * Best-effort: eventuali errori vengono loggati ma non fanno fallire la
 * risposta di saveJobcard (già persistita con successo sulla DGT).
 *
 * @param {object} payload - payload di saveJobcard (jobCardPayload)
 * @param {string|null} [username] - username autenticato (authorizer.sub), v. resolveNagaContext
 */
async function syncAppointmentsToNaga(payload, username) {
  const appointments = Array.isArray(payload?.appointments) ? payload.appointments : [];
  if (!appointments.length) return;

  const context = await resolveNagaContext(payload, username);

  for (const appointment of appointments) {
    try {
      const agendaSoaNaga = require('../agendaSoaNaga/index');
      let apptId = appointment?.appointmentInternalId || null;

      if (!apptId) {
        const createPayload = buildCreateNagaPayload(payload, appointment, context);
        const createResult = await agendaSoaNaga.handler({
          action: 'createnaga',
          body: JSON.stringify(createPayload),
        });
        console.log('[jobCard] agendaSoaNaga createnaga result:', createResult?.statusCode);

        apptId = extractAppointmentInternalId(createResult);
        if (!apptId) {
          console.warn('[jobCard] agendaSoaNaga createnaga non ha restituito un appointmentInternalId: updatenaga saltato per questo appuntamento');
          continue;
        }

        // Valorizza appointmentInternalId sull'appuntamento del payload originale
        // (mutazione diretta, non una copia), cosi' il valore restituito da
        // createnaga è disponibile anche a chi chiama saveJobCard con questo
        // stesso payload (v. runSaveJobcard, che invoca prima syncAppointmentsToNaga).
        appointment.appointmentInternalId = apptId;
      }

      const nagaPayload = buildUpdateNagaPayload(payload, { ...appointment, appointmentInternalId: apptId }, context);
      const result = await agendaSoaNaga.handler({
        action: 'updatenaga',
        pathParameters: { apptId: String(apptId) },
        body: JSON.stringify(nagaPayload),
      });
      console.log('[jobCard] agendaSoaNaga updatenaga result:', result?.statusCode);
    } catch (err) {
      console.error('[jobCard] agendaSoaNaga sync error:', err.message ?? err);
    }
  }
}

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "list", "body": { "dealerId": "..." } }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../repairorder/list -> "list")
 *     and the body is built by merging query string parameters with a JSON body, if any.
 *     Example: GET /api/repairorder/list?dealerId=0062219
 */
function resolveActionAndBody(event) {
  if (event && event.action) {
    const body = typeof event.body === 'string'
      ? JSON.parse(event.body)
      : (event.body || {});
    return { action: event.action, body };
  }

  const rawPath  = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const action   = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  let parsedBody = {};
  if (event.body) {
    try {
      parsedBody = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch (_) {
      parsedBody = {};
    }
  }

  const body = { ...(event.queryStringParameters || {}), ...parsedBody };
  return { action, body };
}

exports.handler = async (event) => {
  const { action, body } = resolveActionAndBody(event);

  if (!action || !VALID_ACTIONS.includes(action)) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        success: false,
        message: `Unknown action: "${action}". Valid actions: ${VALID_ACTIONS.join(', ')}`,
      }),
    };
  }

  try {
    let result;
    if (action === 'dml') {
      // Legge /tmp/<jobCardId>.json salvato da una precedente "details" e
      // chiama il gateway DML (jobCardService.getDataFromDMLFromTmp gestisce
      // internamente il proprio token verso dms/authService). Se il file
      // manca, getDataFromDMLFromTmp richiama DGT (getJobCardDetails) per
      // rigenerarlo, recuperando un bearerToken PingFederate solo in quel caso.
      result = await getDataFromDMLFromTmp(body.jobCardId ?? body.id, undefined, resolveSessionContext(event, body));
    } else {
      const token = await getBearerToken();
      if (action === 'list') {
        result = await getJobCardList(token, body);
      } else if (action === 'listCurrent') {
        result = await getJobCardListCurrent(token, body.dealerId, body.currentDate);
      } else if (action === 'details') {
        result = await getJobCardDetails(token, body.jobCardId ?? body.id);
      } else {
        const jobCardPayload = body.payload ?? body;
        result = await saveJobCard(token, jobCardPayload);
        await syncAppointmentsToNaga(jobCardPayload, resolveUsername(event, body));
      }
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return {
      statusCode,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

/**
 * Parses extra CLI args in the form key=value into an object.
 * Numeric-looking values are cast to numbers.
 */
function parseKvArgs(args) {
  const result = {};
  for (const arg of args) {
    const idx = arg.indexOf('=');
    if (idx === -1) continue;
    const key = arg.slice(0, idx).trim();
    const raw = arg.slice(idx + 1).trim();
    result[key] = /^\d+$/.test(raw) ? Number(raw) : raw;
  }
  return result;
}

async function runList(dealerId, extraArgs) {
  console.log('\n=== JobCard List ===');
  const params = { dealerId, ...parseKvArgs(extraArgs) };
  const token = await getBearerToken();
  const result = await getJobCardList(token, params);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runListCurrent(dealerId, currentDate) {
  console.log('\n=== JobCard List Current ===');
  const token = await getBearerToken();
  const result = await getJobCardListCurrent(token, dealerId, currentDate);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDetails(jobCardId) {
  console.log('\n=== JobCard Details ===');
  const token = await getBearerToken();
  const result = await getJobCardDetails(token, jobCardId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runSaveJobcard(payloadJsonFile) {
  console.log('\n=== Save JobCard ===');
  const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
  const token = await getBearerToken();
  // syncAppointmentsToNaga viene eseguita prima di saveJobCard: se crea un
  // nuovo appuntamento NAGA (createnaga), valorizza direttamente
  // payload.appointments[].appointmentInternalId con l'apptId restituito,
  // cosi' saveJobCard riceve il payload già aggiornato.
  await syncAppointmentsToNaga(payload);
  const result = await saveJobCard(token, payload);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDml(jobCardId) {
  console.log('\n=== JobCard DML (da /tmp) ===');
  const result = await getDataFromDMLFromTmp(jobCardId);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, param, ...rest] = process.argv;

  try {
    if (command === 'list') {
      const dealerId = param || '0062219';
      await runList(dealerId, rest);
    } else if (command === 'listCurrent') {
      const dealerId    = param || '0062219';
      const currentDate = rest[0];
      if (!currentDate) {
        console.error('[ERROR] È richiesto currentDate ("YYYY-MM-DD").');
        process.exit(1);
      }
      await runListCurrent(dealerId, currentDate);
    } else if (command === 'details') {
      const jobCardId = param || '79';
      await runDetails(jobCardId);
    } else if (command === 'saveJobcard') {
      if (!param) {
        console.error('[ERROR] È richiesto il path del file JSON con il payload.');
        process.exit(1);
      }
      await runSaveJobcard(param);
    } else if (command === 'dml') {
      const jobCardId = param || '79';
      await runDml(jobCardId);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js list        <dealerId> [key=value ...]');
      console.error('  node index.js listCurrent <dealerId> <currentDate>');
      console.error('  node index.js details     <jobCardId>');
      console.error('  node index.js saveJobcard <payloadJsonFile>');
      console.error('  node index.js dml         <jobCardId>');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}