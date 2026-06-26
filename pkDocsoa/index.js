'use strict';

require('dotenv').config();
const { DocSOARestClient, vinParts } = require('./DocSOARestClient');

async function main() {
  const client = new DocSOARestClient();
  const vin    = process.env.VIN;

  // Esempio: ottieni la lista funzioni per un VIN
  const result = await client.functionsService({
    langue: process.env.LANGUE,
    pays:   process.env.PAYS,
    marque: process.env.MARQUE,
    mode:   'MODE_XML',
    typedoc: ['4'],
    ...vinParts(vin),
  });

  console.log('functionsService:', JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Errore:', err.message ?? err);
  process.exit(1);
});
