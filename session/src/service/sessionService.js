'use strict';

const config = require('../config');
const StaticSessionProvider = require('../providers/staticSessionProvider');
const DbSessionProvider = require('../providers/dbSessionProvider');

/**
 * Factory: sceglie il provider in base a config.dataSource ("static" | "db").
 * @returns {import('../providers/sessionProvider')}
 */
function createProvider() {
  if (config.dataSource === 'db') {
    return new DbSessionProvider(config.db);
  }
  return new StaticSessionProvider();
}

/**
 * Restituisce i dati di sessione, delegando al provider configurato.
 * @param {object} [criteria] - Criteri di ricerca (es. { pdvId, sincom, codmarket }).
 * @returns {Promise<object>}
 */
async function getSessionData(criteria = {}) {
  const provider = createProvider();
  return provider.getSessionData(criteria);
}

module.exports = { getSessionData, createProvider };
