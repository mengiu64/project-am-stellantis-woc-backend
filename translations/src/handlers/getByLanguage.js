'use strict';

const { buildDbRepository } = require('../repositoryFactory');
const { NoTranslationsFoundError } = require('../errors');
const { buildTranslationsPayload } = require('../utils/translationsJson');
const { response, errorResponse } = require('../utils/httpResponse');
const { parseRequestParams, validateLanguage } = require('../utils/requestParams');

/**
 * Lambda handler – GET /translations/by-language?language=en
 * Legge da woc.translations tutti i record della lingua e ricostruisce il JSON
 * annidato (stessa struttura di translation.json).
 *
 * @param {object} event - evento API Gateway proxy / invocazione diretta
 * @param {object} _context - contesto Lambda (non usato)
 * @param {object} [deps] - dipendenze iniettabili (test)
 */
exports.handler = async (event, _context, deps = {}) => {
  try {
    const params = parseRequestParams(event); // parametri da query/body/params
    const language = validateLanguage(params.language !== undefined ? params.language : params.lang, true); // obbligatorio
    console.log(JSON.stringify({ logType: 'translations_by_language_start', service: 'translations', language }));
    const repository = deps.dbRepository || buildDbRepository(); // repository Aurora
    const rows = await repository.findByLanguage(language); // record della lingua
    if (rows.length === 0) throw new NoTranslationsFoundError(`Nessuna traduzione trovata per la lingua "${language}"`);
    const payload = buildTranslationsPayload(rows); // ricostruzione JSON annidato
    console.log(JSON.stringify({ logType: 'translations_by_language_done', service: 'translations', language, records: rows.length }));
    return response(200, payload);
  } catch (err) {
    return errorResponse(err, 'translations_by_language');
  }
};
