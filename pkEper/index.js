'use strict';

/**
 * index.js — entry point dimostrativo
 * Mostra come importare e usare WsIQPckEper in modo programmatico.
 * Per eseguire il test completo: node test.js
 */

const { WsIQPckEper } = require('./WsIQPckEper');

async function main() {
  const wsIQ = new WsIQPckEper({
    coddealer: '0073741',
    codmarket: '1000',
  });

  // Esempio: ottieni i gruppi per un VIN
  const groups = await wsIQ.getGroupsPRRequest({
    ticket: null,
    lingua: 'IT',
    VIN: 'ZAC5JABL9PJK00363',
  });

  console.log('Gruppi ePer:', JSON.stringify(groups, null, 2));
}

main().catch((err) => {
  console.error('Errore:', err.message ?? err);
  process.exit(1);
});
