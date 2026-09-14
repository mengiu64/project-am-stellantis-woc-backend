'use strict';

/**
 * index.js — CLI entry point per djc
 *
 * Uso:
 *   node index.js [--jobCardId <id>] SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>
 *   node index.js saveJobcard <payloadJsonFile>
 *
 * --jobCardId <id> (opzionale): legge /tmp/<id>.json (scritto dalla lambda jobcard,
 * jobCardService.js::getJobCardDetails) come json_orig invece del fallback get.json.
 * Non si applica a "saveJobcard", che invia direttamente il payload alla DGT.
 *
 * "saveJobcard" (POST /jobCard) usa lo stesso client PingFederate/DGT di jobcard
 * (authService.js/httpClient.js/config.js, copie sincronizzate con quelle di
 * jobcard): API Gateway instrada le richieste POST verso questa lambda, mentre
 * jobcard resta responsabile delle GET (jobCardList/jobCardDetails) ed espone la
 * stessa azione "saveJobcard" per chiamata diretta/CLI.
 *
 * Esempio:
 *   node index.js SaveRoInfo "0/2" "1/2" false true true false false true TAG-001 N
 *   node index.js --jobCardId 84564621 SaveRoInfo "0/2" "1/2" false true true false false true TAG-001 N
 *   node index.js saveJobcard ./payload.json
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { DjcManager } = require('./DjcManager');
// authService/jobCardService (client PingFederate/DGT condiviso con jobcard)
// vengono richiesti solo dai rami "saveJobcard" (require lazy più sotto): le
// altre azioni (SaveRoInfo, ecc.) non chiamano la DGT e non devono richiedere
// le variabili d'ambiente JOBCARD_PING_CLIENT_ID/DGT_CLIENT_ID/... validate da
// config.js al require.

// ── Sincronizzazione appuntamenti NAGA (post saveJobcard) ──────────────────────
// Copia sincronizzata della stessa logica in jobcard/index.js (stesso pattern
// di jobCardService.js, mantenuto in sync tra le due lambda).

/**
 * Legge un file JSON da /tmp in modo best-effort (usato per session.json e
 * <jobCardSrpId>.json): se il file manca o non è leggibile/parsabile, ritorna
 * {} invece di sollevare un'eccezione, cosi' i soli campi da esso derivati
 * restano assenti dal payload updatenaga (stesso approccio "best effort" già
 * usato altrove nel progetto per gli arricchimenti opzionali di sessione).
 */
function readTmpJsonSafe(fileName) {
  try {
    return JSON.parse(fs.readFileSync(path.join('/tmp', fileName), 'utf8'));
  } catch (_) {
    return {};
  }
}

/**
 * Converte un ISO 8601 date-time ("2026-09-10T08:15:00.000Z") nella data
 * "a mezzanotte" richiesta da recepDate/recetDate ("2026-09-10T00:00:00.000Z").
 */
function toMidnightIso(isoDateTime) {
  if (!isoDateTime) return null;
  const datePart = String(isoDateTime).slice(0, 10);
  return `${datePart}T00:00:00.000Z`;
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
 * da jobcard/jobCardService.js::getDataFromDMLFromTmp per una precedente
 * jobCardDetails): usati per popolare intervention[].nom del payload updatenaga.
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
 * Costruisce il payload updatenaga (azione agendaSoaNaga) a partire da un
 * elemento di payload.appointments[] e dal payload saveJobcard stesso.
 * rdvBrand/pdvid/locale/sfPdvBrand/user/clientLanguage sono risolti da
 * /tmp/session.json (dati di sessione già salvati dal chiamante), idVINSF da
 * /tmp/VIN.json: entrambi letti in modo best-effort (v. readTmpJsonSafe).
 */
function buildUpdateNagaPayload(payload, appointment) {
  const session = readTmpJsonSafe('session.json');
  const vinData = readTmpJsonSafe('VIN.json');

  const reception = appointment?.reception ?? {};
  const delivery = appointment?.delivery ?? {};

  const nagaPayload = {
    rdvBrand: session.brandvehic_reftech ?? null,
    apptId: appointment.appointmentInternalId,
    startRecep: reception.receptionServiceAdvisorId ?? null,
    endRecep: delivery.deliveryServiceAdvisorId ?? null,
    recepDate: toMidnightIso(reception.receptionDateTime),
    recetDate: toMidnightIso(delivery.deliveryDateTime),
    recepHours: toHoursMinutes(reception.receptionDateTime),
    recetHours: toHoursMinutes(delivery.deliveryDateTime),
    recepTimeSlot: null,
    recetTimeSlot: null,
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
    intervention: collectJobDescriptions(payload).map((nom) => ({ nom })),
    pdvLanguageList: session.locale ? [session.locale] : [],
    sendSMS: null,
    idVINSF: vinData.vin ?? null,
    mobilityList: [],
    otherMobilityList: [],
    mapCarac: {},
    isMobilityPresent: null,
    isDossierDeleted: null,
    isModification: null,
    apptDossierId: null,
    idDossierSF: null,
    source: 'WiAdvisor',
    clientNom: null,
  };

  console.log('[djc] agendaSoaNaga updatenaga payload:', JSON.stringify(nagaPayload));

  return nagaPayload;
}

/**
 * Se payload.appointments[] contiene un elemento con appointmentInternalId
 * valorizzato, richiama in-process l'azione "updatenaga" della lambda
 * agendaSoaNaga (stesso pattern di require cross-cartella già usato da
 * pkManager/PkManager.js) per sincronizzare l'appuntamento NAGA dopo un
 * saveJobcard riuscito. Best-effort: eventuali errori vengono loggati ma non
 * fanno fallire la risposta di saveJobcard (già persistita con successo sulla DGT).
 */
async function syncAppointmentsToNaga(payload) {
  const appointments = Array.isArray(payload?.appointments) ? payload.appointments : [];

  for (const appointment of appointments) {
    if (!appointment?.appointmentInternalId) continue;

    try {
      const agendaSoaNaga = require('../agendaSoaNaga/index');
      const nagaPayload = buildUpdateNagaPayload(payload, appointment);
      const result = await agendaSoaNaga.handler({
        action: 'updatenaga',
        pathParameters: { apptId: String(appointment.appointmentInternalId) },
        body: JSON.stringify(nagaPayload),
      });
      console.log('[djc] agendaSoaNaga updatenaga result:', result?.statusCode);
    } catch (err) {
      console.error('[djc] agendaSoaNaga updatenaga error:', err.message ?? err);
    }
  }
}

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  'SaveRoInfo',
  'SaveDmsSync',
  'SaveCustomer',
  'SaveVehicle',
  'SaveJobs',
  'SaveConsents',
  'SaveAppointments',
  'saveJobcard',
];

/**
 * Resolves { action, body } from either:
 *  1) A direct Lambda invocation payload:  { "action": "SaveRoInfo", "body": {...} }
 *  2) A real API Gateway (REST API or HTTP API) proxy integration event, where the
 *     action is taken from the last path segment (e.g. .../djc/SaveRoInfo -> "SaveRoInfo")
 *     and the body is built by merging query string parameters with a JSON body, if any.
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

  // "saveJobcard" (POST /jobCard) invia direttamente alla DGT il payload ricevuto
  // (json_mod costruito lato client a partire dai metodi SaveRoInfo/SaveCustomer/...):
  // non richiede jobCardId né DjcManager, quindi viene gestito separatamente dal
  // resto del dispatcher (che invece legge /tmp/<jobCardId>.json).
  if (action === 'saveJobcard') {
    try {
      const { getBearerToken } = require('./authService');
      const { saveJobCard } = require('./jobCardService');
      const token = await getBearerToken();
      const jobCardPayload = body.payload ?? body;
      const result = await saveJobCard(token, jobCardPayload);
      await syncAppointmentsToNaga(jobCardPayload);
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
  }

  const {
    jobCardId,
    interiorCarWash,
    exteriorCarWash,
    old,
    original,
    returned,
    circularEconomy,
    obfcm,
    waitOnSite,
    vehicleIdentificationTagNumber,
    loanerFlag,
    dmsSynchroStatus,
    phone,
    mobile,
    email,
    address,
    additionalAddress,
    licensePlate,
    odometerOut,
    mileageUnits,
    fuelReserveLevel,
    batteryReserveLevel,
    channelCode1,
    channelCode2,
    channelCode3,
    channelCode4,
    channelCode5,
    channelCode6,
    estimatedReceptionDateTime,
    receptionDateTime,
    receptionServiceAdvisorId,
    receptionServiceAdvisorName,
    estimatedDeliveryDateTime,
    deliveryDateTime,
    deliveryServiceAdvisorId,
    deliveryServiceAdvisorName,
  } = body;

  if (!jobCardId) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: 'jobCardId is required' }),
    };
  }

  try {
    // djcJson (json_orig) è il jobCardDetails cachato in DynamoDB (chiave
    // jobcard:jobcarddetails:<jobCardId>) dalla lambda jobcard
    // (jobCardService.js::getJobCardDetails), non più /tmp — get.json resta
    // solo un fallback per uso locale/CLI senza jobCardId.
    const manager = await DjcManager.create(undefined, jobCardId);
    let result;

    if (action === 'SaveRoInfo') {
      result = manager.SaveRoInfo(
        interiorCarWash,
        exteriorCarWash,
        old,
        original,
        returned,
        circularEconomy,
        obfcm,
        waitOnSite,
        vehicleIdentificationTagNumber,
        loanerFlag
      );
    } else if (action === 'SaveDmsSync') {
      result = manager.SaveDmsSync(dmsSynchroStatus);
    } else if (action === 'SaveCustomer') {
      result = manager.SaveCustomer(phone, mobile, email, address, additionalAddress);
    } else if (action === 'SaveVehicle') {
      result = manager.SaveVehicle(licensePlate, odometerOut, mileageUnits, fuelReserveLevel, batteryReserveLevel);
    } else if (action === 'SaveJobs') {
      result = manager.SaveJobs();
    } else if (action === 'SaveConsents') {
      result = manager.SaveConsents(channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6);
    } else if (action === 'SaveAppointments') {
      result = manager.SaveAppointments(
        estimatedReceptionDateTime,
        receptionDateTime,
        receptionServiceAdvisorId,
        receptionServiceAdvisorName,
        estimatedDeliveryDateTime,
        deliveryDateTime,
        deliveryServiceAdvisorId,
        deliveryServiceAdvisorName
      );
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(result),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ success: false, message: err.message ?? String(err) }),
    };
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

function printResult(label, data) {
  console.log('\n' + '═'.repeat(65));
  console.log(`  ${label}`);
  console.log('═'.repeat(65));
  console.log(JSON.stringify(data, null, 2));
}

function printUsage() {
  console.log('\nUso: node index.js [--jobCardId <id>] <metodo> [argomenti]\n');
  console.log('  --jobCardId <id> - Legge /tmp/<id>.json (scritto dalla lambda jobcard) come');
  console.log('                     json_orig invece del fallback get.json\n');
  console.log('  SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>');
  console.log('  SaveDmsSync <dmsSynchroStatus>');
  console.log('  SaveCustomer <phone> <mobile> <email> <address> <additionalAddress>');
  console.log('  SaveVehicle <licensePlate> <odometerOut> <mileageUnits> <fuelReserveLevel> <batteryReserveLevel>');
  console.log('  SaveJobs');
  console.log('  SaveConsents <channelCode1> <channelCode2> <channelCode3> <channelCode4> <channelCode5> <channelCode6>');
  console.log('  SaveAppointments <estimatedReceptionDateTime> <receptionDateTime> <receptionServiceAdvisorId> <receptionServiceAdvisorName> <estimatedDeliveryDateTime> <deliveryDateTime> <deliveryServiceAdvisorId> <deliveryServiceAdvisorName>');
  console.log('  saveJobcard <payloadJsonFile>  (POST /jobCard — non richiede --jobCardId)\n');
  console.log('Esempi:');
  console.log('  node index.js SaveRoInfo "0/2" "1/2" false true true false false true TAG-001 N');
  console.log('  node index.js --jobCardId 84564621 SaveDmsSync SYNCED');
  console.log('  node index.js SaveCustomer "+91-22-40000000" "+91-9000000000" test@example.com "Via Roma 1" "Interno 2"');
  console.log('  node index.js SaveVehicle "EH-436-DG" 12345 km 3 85');
  console.log('  node index.js SaveJobs');
  console.log('  node index.js SaveConsents true true false true false true');
  console.log('  node index.js SaveAppointments "2025-12-05T09:30:00+05:30" "2025-12-05T09:45:00+05:30" SG36544 TEST "2025-12-05T17:30:00+05:30" "2025-12-05T17:45:00+05:30" SG5477 Peter');
  console.log('  node index.js saveJobcard ./payload.json\n');
}

async function main() {
  const rawArgs = process.argv.slice(2);

  // --jobCardId <id> è un flag opzionale globale (rimosso da rawArgs prima di
  // interpretare comando/argomenti): se presente, legge /tmp/<id>.json invece
  // del fallback get.json (stessa logica dell'handler Lambda).
  let jobCardId;
  const jobCardIdIdx = rawArgs.indexOf('--jobCardId');
  if (jobCardIdIdx !== -1) {
    jobCardId = rawArgs[jobCardIdIdx + 1];
    rawArgs.splice(jobCardIdIdx, 2);
  }

  const [command, ...args] = rawArgs;

  if (!command || !VALID_ACTIONS.includes(command)) {
    if (command) console.error(`\n❌ Metodo sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  try {
    if (command === 'saveJobcard') {
      const [payloadJsonFile] = args;
      if (!payloadJsonFile) {
        console.error('\n❌ È richiesto il path del file JSON con il payload.');
        process.exit(1);
      }
      const payload = JSON.parse(fs.readFileSync(payloadJsonFile, 'utf8'));
      const { getBearerToken } = require('./authService');
      const { saveJobCard } = require('./jobCardService');
      const token = await getBearerToken();
      const result = await saveJobCard(token, payload);
      await syncAppointmentsToNaga(payload);
      printResult('saveJobcard', result);

      console.log('\n✅ Completato.');
      return;
    }

    const manager = await DjcManager.create(undefined, jobCardId);
    if (command === 'SaveRoInfo') {
      const [
        interiorCarWash,
        exteriorCarWash,
        old,
        original,
        returned,
        circularEconomy,
        obfcm,
        waitOnSite,
        vehicleIdentificationTagNumber,
        loanerFlag,
      ] = args;

      const result = manager.SaveRoInfo(
        interiorCarWash,
        exteriorCarWash,
        old,
        original,
        returned,
        circularEconomy,
        obfcm,
        waitOnSite,
        vehicleIdentificationTagNumber,
        loanerFlag
      );
      printResult('SaveRoInfo', result);
    } else if (command === 'SaveDmsSync') {
      const [dmsSynchroStatus] = args;
      const result = manager.SaveDmsSync(dmsSynchroStatus);
      printResult('SaveDmsSync', result);
    } else if (command === 'SaveCustomer') {
      const [phone, mobile, email, address, additionalAddress] = args;
      const result = manager.SaveCustomer(phone, mobile, email, address, additionalAddress);
      printResult('SaveCustomer', result);
    } else if (command === 'SaveVehicle') {
      const [licensePlate, odometerOut, mileageUnits, fuelReserveLevel, batteryReserveLevel] = args;
      const result = manager.SaveVehicle(licensePlate, odometerOut, mileageUnits, fuelReserveLevel, batteryReserveLevel);
      printResult('SaveVehicle', result);
    } else if (command === 'SaveJobs') {
      const result = manager.SaveJobs();
      printResult('SaveJobs', result);
    } else if (command === 'SaveConsents') {
      const [channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6] = args;
      const result = manager.SaveConsents(channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6);
      printResult('SaveConsents', result);
    } else if (command === 'SaveAppointments') {
      const [
        estimatedReceptionDateTime,
        receptionDateTime,
        receptionServiceAdvisorId,
        receptionServiceAdvisorName,
        estimatedDeliveryDateTime,
        deliveryDateTime,
        deliveryServiceAdvisorId,
        deliveryServiceAdvisorName,
      ] = args;
      const result = manager.SaveAppointments(
        estimatedReceptionDateTime,
        receptionDateTime,
        receptionServiceAdvisorId,
        receptionServiceAdvisorName,
        estimatedDeliveryDateTime,
        deliveryDateTime,
        deliveryServiceAdvisorId,
        deliveryServiceAdvisorName
      );
      printResult('SaveAppointments', result);
    }

    console.log('\n✅ Completato.');
  } catch (err) {
    console.error('\n❌ Errore:', err.message ?? err);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
