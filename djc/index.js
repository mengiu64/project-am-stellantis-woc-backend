'use strict';

/**
 * index.js — CLI entry point per djc
 *
 * Uso:
 *   node index.js SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>
 *
 * Esempio:
 *   node index.js SaveRoInfo "0/2" "1/2" false true true false false true TAG-001 N
 */

require('dotenv').config();
const { DjcManager } = require('./DjcManager');

// ── Lambda handler ────────────────────────────────────────────────────────────

const VALID_ACTIONS = [
  'SaveRoInfo',
  'SaveDmsSync',
  'SaveCustomer',
  'SaveVehicle',
  'SaveJobs',
  'SaveConsents',
  'SaveAppointments',
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

  const {
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

  try {
    const manager = new DjcManager();
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
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>');
  console.log('  SaveDmsSync <dmsSynchroStatus>');
  console.log('  SaveCustomer <phone> <mobile> <email> <address> <additionalAddress>');
  console.log('  SaveVehicle <licensePlate> <odometerOut> <mileageUnits> <fuelReserveLevel> <batteryReserveLevel>');
  console.log('  SaveJobs');
  console.log('  SaveConsents <channelCode1> <channelCode2> <channelCode3> <channelCode4> <channelCode5> <channelCode6>');
  console.log('  SaveAppointments <estimatedReceptionDateTime> <receptionDateTime> <receptionServiceAdvisorId> <receptionServiceAdvisorName> <estimatedDeliveryDateTime> <deliveryDateTime> <deliveryServiceAdvisorId> <deliveryServiceAdvisorName>\n');
  console.log('Esempi:');
  console.log('  node index.js SaveRoInfo "0/2" "1/2" false true true false false true TAG-001 N');
  console.log('  node index.js SaveDmsSync SYNCED');
  console.log('  node index.js SaveCustomer "+91-22-40000000" "+91-9000000000" test@example.com "Via Roma 1" "Interno 2"');
  console.log('  node index.js SaveVehicle "EH-436-DG" 12345 km 3 85');
  console.log('  node index.js SaveJobs');
  console.log('  node index.js SaveConsents true true false true false true');
  console.log('  node index.js SaveAppointments "2025-12-05T09:30:00+05:30" "2025-12-05T09:45:00+05:30" SG36544 TEST "2025-12-05T17:30:00+05:30" "2025-12-05T17:45:00+05:30" SG5477 Peter\n');
}

async function main() {
  const [, , command, ...args] = process.argv;

  if (!command || !VALID_ACTIONS.includes(command)) {
    if (command) console.error(`\n❌ Metodo sconosciuto: "${command}"`);
    printUsage();
    process.exit(command ? 1 : 0);
  }

  const manager = new DjcManager();

  try {
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
