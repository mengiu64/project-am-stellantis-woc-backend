'use strict';

/**
 * index.js — Entry point della lambda dbManager (Aurora PostgreSQL, tabelle HQ_PKCONFIG
 * e woc.ang_snowflakes)
 *
 * Espone il metodo getPkwstouse(codmarket, codbrand): risolve quale web service
 * pacchetti (eper/docsoa/menupricing) usare per un dato mercato/brand, leggendo
 * la tabella HQ_PKCONFIG. Vedi PkConfigRepository.js per la logica di fallback
 * (match esatto su CODMARKET+CODBRAND, altrimenti CODMARKET NULL+CODBRAND).
 *
 * Espone inoltre il metodo getCountryIsoCode(market): risolve il codice ISO
 * paese del dealer (cd_dealer_country_iso_code) a partire dal codice mercato
 * (cd_market_code), leggendo la tabella woc.ang_snowflakes. Vedi
 * AnagSnowflakesRepository.js.
 *
 * Espone inoltre il metodo getPhysicalSite(mainSincom, market, brand): risolve
 * physicalSiteId (gn_physical_site_arcad) e dealerNumberIdSource
 * (cd_sincom_code) dalla stessa tabella woc.ang_snowflakes, usati dal
 * chiamante (es. jobcard/jobCardService.js) per completare il Sender
 * dell'inquiry DMS in modo dinamico invece dei valori statici via env. Vedi
 * AnagSnowflakesRepository.js::getPhysicalSiteAndSincom.
 *
 * Uso CLI:
 *   node index.js getPkwstouse <codmarket> <codbrand>
 *   node index.js getCountryIsoCode <market>
 *   node index.js getPhysicalSite <mainSincom> <market> <brand>
 */

const { getPool } = require('./db');
const { getPkwstouse } = require('./PkConfigRepository');
const { getCountryIsoCode, getPhysicalSiteAndSincom } = require('./AnagSnowflakesRepository');

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

exports.handler = async (event = {}) => {
  // Supporta sia l'invocazione diretta { action, body } sia un evento API
  // Gateway (query string + body JSON), come gli altri moduli del repo.
  const body = event.action
    ? (event.body || {})
    : { ...(event.queryStringParameters || {}), ...parseBody(event) };
  const action = event.action || body.action || 'getPkwstouse';
  const { codmarket, codbrand, market, mainSincom, brand } = body;

  try {
    const pool = await getPool();

    if (action === 'getPkwstouse') {
      const pkwstouse = await getPkwstouse(pool, { codmarket, codbrand });
      return response(200, { success: true, codmarket: codmarket || null, codbrand, pkwstouse });
    }

    if (action === 'getCountryIsoCode') {
      const marketIso = await getCountryIsoCode(pool, { market });
      return response(200, { success: true, market, marketIso });
    }

    if (action === 'getPhysicalSite') {
      const { physicalSiteId, dealerNumberIdSource } = await getPhysicalSiteAndSincom(pool, { mainSincom, market, brand });
      return response(200, { success: true, mainSincom, market, brand, physicalSiteId, dealerNumberIdSource });
    }

    return response(400, { success: false, message: `Azione non supportata: "${action}"` });
  } catch (err) {
    const statusCode = err.message.includes('is required') ? 400 : 502;
    return response(statusCode, { success: false, message: err.message });
  }
};

// ── CLI ───────────────────────────────────────────────────────────────────────

async function runGetPkwstouse(codmarket, codbrand) {
  console.log('\n=== dbManager getPkwstouse ===');
  const pool = await getPool();
  const pkwstouse = await getPkwstouse(pool, { codmarket: codmarket || null, codbrand });
  console.log(JSON.stringify({ success: true, codmarket: codmarket || null, codbrand, pkwstouse }, null, 2));
  return pkwstouse;
}

async function runGetCountryIsoCode(market) {
  console.log('\n=== dbManager getCountryIsoCode ===');
  const pool = await getPool();
  const marketIso = await getCountryIsoCode(pool, { market });
  console.log(JSON.stringify({ success: true, market, marketIso }, null, 2));
  return marketIso;
}

async function runGetPhysicalSite(mainSincom, market, brand) {
  console.log('\n=== dbManager getPhysicalSite ===');
  const pool = await getPool();
  const result = await getPhysicalSiteAndSincom(pool, { mainSincom, market, brand });
  console.log(JSON.stringify({ success: true, mainSincom, market, brand, ...result }, null, 2));
  return result;
}

async function main() {
  const [, , command, arg1, arg2, arg3] = process.argv;

  try {
    if (command === 'getPkwstouse') {
      // node index.js getPkwstouse <codmarket> <codbrand>
      // node index.js getPkwstouse null <codbrand>   (per forzare il fallback)
      const codmarket = arg1 && arg1 !== 'null' ? arg1 : null;
      const codbrand = arg2;
      if (!codbrand) {
        console.error('[ERROR] "codbrand" è obbligatorio. Uso: node index.js getPkwstouse <codmarket> <codbrand>');
        process.exit(1);
        return;
      }
      await runGetPkwstouse(codmarket, codbrand);
    } else if (command === 'getCountryIsoCode') {
      // node index.js getCountryIsoCode <market>
      const market = arg1;
      if (!market) {
        console.error('[ERROR] "market" è obbligatorio. Uso: node index.js getCountryIsoCode <market>');
        process.exit(1);
        return;
      }
      await runGetCountryIsoCode(market);
    } else if (command === 'getPhysicalSite') {
      // node index.js getPhysicalSite <mainSincom> <market> <brand>
      const mainSincom = arg1;
      const market = arg2;
      const brand = arg3;
      if (!mainSincom || !market || !brand) {
        console.error('[ERROR] "mainSincom", "market" e "brand" sono obbligatori. Uso: node index.js getPhysicalSite <mainSincom> <market> <brand>');
        process.exit(1);
        return;
      }
      await runGetPhysicalSite(mainSincom, market, brand);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js getPkwstouse <codmarket> <codbrand>');
      console.error('  node index.js getCountryIsoCode <market>');
      console.error('  node index.js getPhysicalSite <mainSincom> <market> <brand>');
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

module.exports.parseBody = parseBody;
module.exports.runGetPkwstouse = runGetPkwstouse;
module.exports.runGetCountryIsoCode = runGetCountryIsoCode;
module.exports.runGetPhysicalSite = runGetPhysicalSite;
module.exports.main = main;
