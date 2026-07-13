'use strict';

const { getSessionData } = require('./service/sessionService');
const { DEFAULT_MARKET } = require('./data/sessionDataByMarket');

/**
 * Handler compatibile con AWS Lambda (event, context) -> risposta HTTP-like.
 * Puo' essere usato direttamente come entry point di una funzione Lambda
 * (es. dietro API Gateway) oppure richiamato da altri moduli.
 *
 * Il mercato (codmarket) puo' arrivare da:
 *  - event.pathParameters.codmarket (es. rotta /session/{codmarket})
 *  - event.queryStringParameters.codmarket (es. ?codmarket=FR)
 *  - event.criteria.codmarket (invocazione diretta, utile per test)
 *
 * @param {object} [event] - Evento Lambda.
 * @returns {Promise<object>} { statusCode, body }
 */
async function handler(event = {}) {
  const criteria = {
    ...(event.queryStringParameters || {}),
    ...(event.criteria || {}),
  };
  if (!criteria.codmarket && event.pathParameters && event.pathParameters.codmarket) {
    criteria.codmarket = event.pathParameters.codmarket;
  }

  try {
    const data = await getSessionData(criteria);
    return {
      statusCode: 200,
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
}

// Esecuzione da riga di comando: `node src/index.js [codmarket]`.
// Se omesso, viene usato il mercato di default (IT).
// Esempi:
//   node src/index.js         -> mercato di default (IT)
//   node src/index.js FR      -> mercato FR
if (require.main === module) {
  const [, , codmarket = DEFAULT_MARKET] = process.argv;

  getSessionData({ codmarket })
    .then((data) => {
      console.log(JSON.stringify(data, null, 2));
    })
    .catch((err) => {
      console.error(`[session] Errore: ${err.message}`);
      process.exitCode = 1;
    });
}

module.exports = { handler };

