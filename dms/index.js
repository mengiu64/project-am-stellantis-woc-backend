'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js settings <country> <brand> <dealer>
 *
 * Parameters:
 *   country  - Country code (e.g. fr)
 *   brand    - Brand code   (e.g. FT)
 *   dealer   - Dealer ID    (e.g. 0062230)
 *
 * Examples:
 *   node index.js settings fr FT 0062230
 */

const { getBearerToken } = require('./authService');
const { getDmsSettings } = require('./dmsService');

async function runSettings(country, brand, dealer) {
  console.log('\n=== DMS Settings ===');
  const token = await getBearerToken();
  const result = await getDmsSettings(token, { country, brand, dealer });
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , command, ...args] = process.argv;

  try {
    if (command === 'settings') {
      const [country = 'fr', brand = 'FT', dealer = '0062230'] = args;
      await runSettings(country, brand, dealer);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js settings <country> <brand> <dealer>');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

main();
