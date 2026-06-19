'use strict';

/**
 * index.js — Entry point
 *
 * Usage:
 *   node index.js list    <dealerId>
 *   node index.js details <jobCardId>
 *
 * Examples:
 *   node index.js list 0062219
 *   node index.js details 79
 */

const { getBearerToken } = require('./authService');
const { getJobCardList, getJobCardDetails } = require('./jobCardService');

async function runList(dealerId) {
  console.log('\n=== JobCard List ===');
  const token = await getBearerToken();
  const result = await getJobCardList(token, dealerId);
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

async function main() {
  const [, , command, param] = process.argv;

  try {
    if (command === 'list') {
      const dealerId = param || '0062219';
      await runList(dealerId);
    } else if (command === 'details') {
      const jobCardId = param || '79';
      await runDetails(jobCardId);
    } else {
      console.error('[ERROR] Comando non valido. Usa:');
      console.error('  node index.js list    <dealerId>');
      console.error('  node index.js details <jobCardId>');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exit(1);
  }
}

main();
