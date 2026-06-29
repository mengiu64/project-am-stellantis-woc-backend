'use strict';

require('dotenv').config();
const { MenuPricingSoapClient } = require('./MenuPricingSoapClient');

async function main() {
  const client = new MenuPricingSoapClient();

  // Esempio: getJobs con i parametri da .env
  const jobs = await client.getJobs({
    languageCode:            process.env.LANGUAGE_CODE,
    countryCode:             process.env.COUNTRY_CODE,
    dealerIdentificationCode: process.env.DEALER_IDENTIFICATION_CODE,
    manufacturer:            process.env.MANUFACTURER,
    vin:                     process.env.VIN,
  });

  console.log('getJobs:', JSON.stringify(jobs, null, 2));
}

main().catch((err) => {
  console.error('Errore:', err.message ?? err);
  process.exit(1);
});
