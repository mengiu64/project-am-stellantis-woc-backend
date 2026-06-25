'use strict';

/**
 * Local smoke-test for AgendaSOAClient.
 * Copy .env.example -> .env, fill in credentials, then run:
 *   node src/test.js [methodName] [key=value ...]
 *
 * Examples:
 *   node src/test.js availableHours id=MY_PDV startDate=2025-03-01
 *   node src/test.js appointment ccs=MY_CCS date=2025-06-01 ldapId=MY_LDAP pdvId=MY_PDV locale=fr_FR
 *   node src/test.js data id=MY_APPT
 */
require('dotenv').config();
const AgendaSOAClient = require('./agendaSOAClient');

// Parse key=value args starting from argv[3]
const cliParams = process.argv.slice(3).reduce((acc, arg) => {
  const idx = arg.indexOf('=');
  if (idx !== -1) acc[arg.slice(0, idx)] = arg.slice(idx + 1);
  return acc;
}, {});

const PDV_ID     = cliParams.id     || cliParams.pdvId    || process.env.TEST_PDV_ID   || 'DEMO_PDV';
const APPT_ID    = cliParams.id     || process.env.TEST_APPT_ID  || 'DEMO_APPT';
const START_DATE = cliParams.startDate || '2025-01-01';
const END_DATE   = cliParams.endDate   || '2025-01-31';
const CCS        = cliParams.ccs    || process.env.TEST_CCS    || 'DEMO_CCS';
const DATE       = cliParams.date   || START_DATE;
const LDAP_ID    = cliParams.ldapId || process.env.TEST_LDAP_ID || '';
const LOCALE     = cliParams.locale || process.env.TEST_LOCALE  || 'fr_FR';

async function run() {
  const client = new AgendaSOAClient();

  const tests = [
    {
      name: 'appointment',
      fn: () => client.appointment({ ccs: CCS, date: DATE, ldapId: LDAP_ID, pdvId: PDV_ID, locale: LOCALE }),
    },
    {
      name: 'availableHours',
      fn: () => client.availableHours({ id: PDV_ID, startDate: START_DATE }),
    },
    {
      name: 'cCSList',
      fn: () => client.cCSList({ id: PDV_ID }),
    },
    {
      name: 'data',
      fn: () => client.data({ id: APPT_ID }),
    },
  ];

  const filter = process.argv[2];
  const filtered = filter ? tests.filter((t) => t.name === filter) : tests;

  for (const t of filtered) {
    process.stdout.write(`▶ ${t.name} ... `);
    try {
      const result = await t.fn();
      if (result.success) {
        console.log(`✅  success`);
        console.log(JSON.stringify(result.data, null, 2));
      } else {
        console.log(`⚠️  responded with error: ${JSON.stringify(result.data)}`);
      }
    } catch (err) {
      console.log(`❌  threw: ${err.message}`);
    }
  }
}

run().catch((err) => {
  console.error('Fatal error:', err.message);
  process.exit(1);
});
