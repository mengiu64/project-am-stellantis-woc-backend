'use strict';

/**
 * Local smoke-test for AgendaNagaClient.
 * Copy .env.example -> .env, fill in credentials, then run:
 *   node src/test.js [methodName] [key=value ...]
 *
 * Examples:
 *   node src/test.js createnaga
 *   node src/test.js updatenaga apptId=MY_APPT_ID
 */
require('dotenv').config();
const AgendaNagaClient = require('./agendaNagaClient');

const cliParams = process.argv.slice(3).reduce((acc, arg) => {
  const idx = arg.indexOf('=');
  if (idx !== -1) acc[arg.slice(0, idx)] = arg.slice(idx + 1);
  return acc;
}, {});

const APPT_ID = cliParams.apptId || process.env.TEST_APPT_ID || 'DEMO_APPT';

const updatenagaBody = {
  rdvBrand: 'AP',
  apptId: 106799025,
  startRecep: 16501,
  endRecep: 16501,
  recepDate: '2026-06-22T00:00:00.000Z',
  recetDate: '2026-06-23T00:00:00.000Z',
  recepHours: '0800',
  recetHours: '0930',
  recepTimeSlot: '1',
  recetTimeSlot: '2',
  reason: null,
  apptStatus: 2,
  comments: '',
  rea: false,
  exceedworkshop: false,
  pdvid: '017721L',
  locale: 'fr_FR',
  sfPdvBrand: '31',
  user: 'M0039657',
  clientLanguage: 'fr_FR',
  idCustomerSF: '',
  idVehicleSF: '',
  intervention: [
    {
      nom: 'A Classer',
      duration: '01',
      team: 6782,
      numLdt: '01',
      dureeref: null,
      category: null,
      code: 99999999,
      memberPresent: 'true',
    },
    {
      nom: 'REMPLACEMENT DES DISQUES ET PLAQUETTES DE FREIN AV',
      duration: '01',
      team: 6782,
      numLdt: '02',
      dureeref: null,
      category: null,
      code: 99999999,
      memberPresent: 'true',
    },
  ],
  pdvLanguageList: ['fr_FR'],
  sendSMS: true,
  idVINSF: 'VF3CABHW6GT204366',
  mobilityList: [],
  otherMobilityList: [],
  mapCarac: {},
  isMobilityPresent: false,
  isDossierDeleted: false,
  isModification: 'false',
  apptDossierId: 0,
  idDossierSF: '1781858874026',
  source: 'WiAdvisor',
  clientNom: 'JSON',
  authUser: '***REMOVED***',
};

async function run() {
  const client = new AgendaNagaClient();

  const tests = [
    {
      name: 'createnaga',
      fn: () => client.createnaga({ /* appointment payload */ }),
    },
    {
      name: 'updatenaga',
      fn: () => client.updatenaga(updatenagaBody, updatenagaBody.apptId),
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
