'use strict';

/**
 * index.js — Entry point della lambda hqManager (Aurora PostgreSQL, tabelle
 * woc.ang_snowflakes / woc.addr_snowflakes / woc.hq_application_enabling).
 *
 * Espone le azioni, delegate a HqManager.js (a sua volta wrapper su
 * dbManager/HqRepository.js):
 *   - getEnablingConfiguration(codmarket): elenco siti del mercato con
 *     l'eventuale configurazione di abilitazione WOC/firma digitale.
 *   - setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature):
 *     crea/aggiorna (upsert) la configurazione di abilitazione per la coppia
 *     (codmarket, oic).
 *   - getVehicleInspection(market, type): elenco voci di controllo veicolo
 *     non cancellate per il "type" richiesto, con priorita' al mercato.
 *   - setVehicleInspectionVisible(id, value): aggiorna il flag "visible".
 *   - deletetVehicleInspectionVisible(id, value): aggiorna il flag "deleted".
 *   - insertVehicleInspection(market, type, descr): crea una nuova voce di
 *     controllo veicolo.
 *   - setMarketEnable(market): abilita il mercato (woc.hq_pk_market) e
 *     disabilita a cascata tutti i suoi OIC (woc.hq_pk_oic).
 *   - setMarketDisable(market): disabilita il mercato e riabilita a cascata
 *     tutti i suoi OIC.
 *   - setOicEnable(market, oic): abilita l'OIC (woc.hq_pk_oic) e, a cascata,
 *     disabilita il mercato (woc.hq_pk_market).
 *   - insertDomain(market, oic, descr): crea un nuovo dominio
 *     (woc.hq_pk_domain).
 *   - setDomain(market, iddomain, descr): aggiorna la descr del dominio.
 *   - deleteDomain(market, iddomain): cancella logicamente il dominio
 *     (woc.hq_pk_domain.deleted = 1).
 *   - insertPackage(market, oic, iddomain, descr, timeop, pricewithvat):
 *     crea un nuovo pacchetto (woc.hq_pk_packages).
 *   - setPackage(idpackage, iddomain, descr, timeop, pricewithvat):
 *     aggiorna iddomain/descr/timeop/pricewithvat del pacchetto.
 *   - getPackageList(market, oic): elenco della gerarchia mercato -> OIC ->
 *     dominio -> pacchetto configurata (oic facoltativo: se assente, elenca
 *     la configurazione "a livello mercato").
 *
 * Uso CLI:
 *   node index.js getEnablingConfiguration <codmarket>
 *   node index.js setEnablingConfiguration <codmarket> <oic> <enableWOC> <enableSignature>
 *   node index.js getVehicleInspection <market> <type>
 *   node index.js setVehicleInspectionVisible <id> <value>
 *   node index.js deletetVehicleInspectionVisible <id> <value>
 *   node index.js insertVehicleInspection <market> <type> <descr>
 *   node index.js setMarketEnable <market>
 *   node index.js setMarketDisable <market>
 *   node index.js setOicEnable <market> <oic>
 *   node index.js insertDomain <market> <oic> <descr>
 *   node index.js setDomain <market> <iddomain> <descr>
 *   node index.js insertPackage <market> <oic> <iddomain> <descr> <timeop> <pricewithvat>
 *   node index.js setPackage <idpackage> <iddomain> <descr> <timeop> <pricewithvat>
 */

const { HqManager } = require('./HqManager');

const VALID_ACTIONS = [
  'getEnablingConfiguration',
  'setEnablingConfiguration',
  'getVehicleInspection',
  'setVehicleInspectionVisible',
  'deletetVehicleInspectionVisible',
  'insertVehicleInspection',
  'setMarketEnable',
  'setMarketDisable',
  'setOicEnable',
  'insertDomain',
  'setDomain',
  'deleteDomain',
  'insertPackage',
  'setPackage',
  'getPackageList',
];

function parseBody(event) {
  if (!event.body) return {};
  try {
    return typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
  } catch (_) {
    return {};
  }
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };
}

/**
 * Risolve { action, body } da:
 *  1) un'invocazione diretta { "action": "...", "body": {...} }, oppure
 *  2) un vero evento API Gateway proxy, prendendo l'azione dall'ultimo
 *     segmento del path e unendo query string + body JSON — stesso pattern
 *     di pkManager/index.js::resolveActionAndBody.
 */
function resolveActionAndBody(event) {
  if (event.action) {
    return { action: event.action, body: event.body || {} };
  }

  const rawPath = event.rawPath || event.path || (event.pathParameters && event.pathParameters.proxy) || '';
  const segments = String(rawPath).split('/').filter(Boolean);
  const pathAction = segments.length ? decodeURIComponent(segments[segments.length - 1]) : undefined;

  const body = { ...(event.queryStringParameters || {}), ...parseBody(event) };
  return { action: body.action || pathAction, body };
}

exports.handler = async (event = {}) => {
  const { action, body } = resolveActionAndBody(event);

  if (!action || !VALID_ACTIONS.includes(action)) {
    return response(400, { success: false, message: `Azione non supportata: "${action}". Azioni valide: ${VALID_ACTIONS.join(', ')}` });
  }

  const {
    codmarket, oic, enableWOC, enableSignature, market, type, id, value, descr,
    iddomain, timeop, pricewithvat, idpackage,
  } = body;
  const manager = new HqManager();

  try {
    if (action === 'getEnablingConfiguration') {
      const configurations = await manager.getEnablingConfiguration(codmarket);
      return response(200, { success: true, codmarket, configurations });
    }

    if (action === 'setEnablingConfiguration') {
      await manager.setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature);
      return response(200, { success: true, codmarket, oic, enableWOC, enableSignature });
    }

    if (action === 'getVehicleInspection') {
      const vehicleInspections = await manager.getVehicleInspection(market, type);
      return response(200, { success: true, market, type, vehicleInspections });
    }

    if (action === 'setVehicleInspectionVisible') {
      await manager.setVehicleInspectionVisible(id, value);
      return response(200, { success: true, id, value });
    }

    if (action === 'deletetVehicleInspectionVisible') {
      await manager.deletetVehicleInspectionVisible(id, value);
      return response(200, { success: true, id, value });
    }

    if (action === 'insertVehicleInspection') {
      await manager.insertVehicleInspection(market, type, descr);
      return response(200, { success: true, market, type, descr });
    }

    if (action === 'setMarketEnable') {
      await manager.setMarketEnable(market);
      return response(200, { success: true, market });
    }

    if (action === 'setMarketDisable') {
      await manager.setMarketDisable(market);
      return response(200, { success: true, market });
    }

    if (action === 'setOicEnable') {
      await manager.setOicEnable(market, oic);
      return response(200, { success: true, market, oic });
    }

    if (action === 'insertDomain') {
      const newIddomain = await manager.insertDomain(market, oic, descr);
      return response(200, { success: true, market, oic, descr, iddomain: newIddomain });
    }

    if (action === 'setDomain') {
      await manager.setDomain(market, iddomain, descr);
      return response(200, { success: true, market, iddomain, descr });
    }

    if (action === 'deleteDomain') {
      await manager.deleteDomain(market, iddomain);
      return response(200, { success: true, market, iddomain });
    }

    if (action === 'insertPackage') {
      const newIdpackage = await manager.insertPackage(market, oic, iddomain, descr, timeop, pricewithvat);
      return response(200, { success: true, market, oic, iddomain, descr, timeop, pricewithvat, idpackage: newIdpackage });
    }

    if (action === 'setPackage') {
      await manager.setPackage(idpackage, iddomain, descr, timeop, pricewithvat);
      return response(200, { success: true, idpackage, iddomain, descr, timeop, pricewithvat });
    }

    const packages = await manager.getPackageList(market, oic);
    return response(200, { success: true, market, oic: oic ?? null, packages });
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return response(statusCode, { success: false, message: err.message });
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log('\nUso: node index.js <metodo> [argomenti]\n');
  console.log('  getEnablingConfiguration <codmarket>                                       Elenco siti + configurazione WOC/firma');
  console.log('  setEnablingConfiguration <codmarket> <oic> <enableWOC> <enableSignature>    Crea/aggiorna la configurazione');
  console.log('  getVehicleInspection <market> <type>                                       Elenco voci di controllo veicolo');
  console.log('  setVehicleInspectionVisible <id> <value>                                   Aggiorna il flag "visible"');
  console.log('  deletetVehicleInspectionVisible <id> <value>                               Aggiorna il flag "deleted"');
  console.log('  insertVehicleInspection <market> <type> <descr>                            Crea una nuova voce di controllo veicolo\n');
  console.log('Esempi:');
  console.log('  node index.js getEnablingConfiguration 1000');
  console.log('  node index.js setEnablingConfiguration 1000 00006821 1 0');
  console.log('  node index.js getVehicleInspection 1000 EXTERIOR');
  console.log('  node index.js setVehicleInspectionVisible 1 1');
  console.log('  node index.js deletetVehicleInspectionVisible 1 1');
  console.log('  node index.js insertVehicleInspection 1000 EXTERIOR "Controllo carrozzeria"\n');
}

async function runGetEnablingConfiguration(codmarket) {
  console.log('\n=== hqManager getEnablingConfiguration ===');
  const manager = new HqManager();
  const configurations = await manager.getEnablingConfiguration(codmarket);
  console.log(JSON.stringify({ success: true, codmarket, configurations }, null, 2));
  return configurations;
}

async function runSetEnablingConfiguration(codmarket, oic, enableWOC, enableSignature) {
  console.log('\n=== hqManager setEnablingConfiguration ===');
  const manager = new HqManager();
  await manager.setEnablingConfiguration(codmarket, oic, enableWOC, enableSignature);
  const result = { success: true, codmarket, oic, enableWOC, enableSignature };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runGetVehicleInspection(market, type) {
  console.log('\n=== hqManager getVehicleInspection ===');
  const manager = new HqManager();
  const vehicleInspections = await manager.getVehicleInspection(market, type);
  console.log(JSON.stringify({ success: true, market, type, vehicleInspections }, null, 2));
  return vehicleInspections;
}

async function runSetVehicleInspectionVisible(id, value) {
  console.log('\n=== hqManager setVehicleInspectionVisible ===');
  const manager = new HqManager();
  await manager.setVehicleInspectionVisible(id, value);
  const result = { success: true, id, value };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runDeletetVehicleInspectionVisible(id, value) {
  console.log('\n=== hqManager deletetVehicleInspectionVisible ===');
  const manager = new HqManager();
  await manager.deletetVehicleInspectionVisible(id, value);
  const result = { success: true, id, value };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function runInsertVehicleInspection(market, type, descr) {
  console.log('\n=== hqManager insertVehicleInspection ===');
  const manager = new HqManager();
  await manager.insertVehicleInspection(market, type, descr);
  const result = { success: true, market, type, descr };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, arg1, arg2, arg3, arg4] = process.argv;

  try {
    if (command === 'getEnablingConfiguration') {
      if (!arg1) { printUsage(); process.exit(1); return; }
      await runGetEnablingConfiguration(arg1);
    } else if (command === 'setEnablingConfiguration') {
      if (!arg1 || !arg2 || arg3 === undefined || arg4 === undefined) { printUsage(); process.exit(1); return; }
      await runSetEnablingConfiguration(arg1, arg2, Number(arg3), Number(arg4));
    } else if (command === 'getVehicleInspection') {
      if (!arg1 || !arg2) { printUsage(); process.exit(1); return; }
      await runGetVehicleInspection(arg1, arg2);
    } else if (command === 'setVehicleInspectionVisible') {
      if (!arg1 || arg2 === undefined) { printUsage(); process.exit(1); return; }
      await runSetVehicleInspectionVisible(Number(arg1), Number(arg2));
    } else if (command === 'deletetVehicleInspectionVisible') {
      if (!arg1 || arg2 === undefined) { printUsage(); process.exit(1); return; }
      await runDeletetVehicleInspectionVisible(Number(arg1), Number(arg2));
    } else if (command === 'insertVehicleInspection') {
      if (!arg1 || !arg2 || !arg3) { printUsage(); process.exit(1); return; }
      await runInsertVehicleInspection(arg1, arg2, arg3);
    } else {
      printUsage();
      process.exit(command ? 1 : 0);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports.parseBody = parseBody;
module.exports.runGetEnablingConfiguration = runGetEnablingConfiguration;
module.exports.runSetEnablingConfiguration = runSetEnablingConfiguration;
module.exports.runGetVehicleInspection = runGetVehicleInspection;
module.exports.runSetVehicleInspectionVisible = runSetVehicleInspectionVisible;
module.exports.runDeletetVehicleInspectionVisible = runDeletetVehicleInspectionVisible;
module.exports.runInsertVehicleInspection = runInsertVehicleInspection;
module.exports.main = main;
