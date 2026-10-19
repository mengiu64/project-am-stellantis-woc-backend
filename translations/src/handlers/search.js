'use strict';

const { buildDbRepository } = require('../repositoryFactory');
const { ValidationError, NoTranslationsFoundError } = require('../errors');
const { buildTranslationsPayload } = require('../utils/translationsJson');
const { response, errorResponse } = require('../utils/httpResponse');
const { parseRequestParams, validateLanguage, validateText } = require('../utils/requestParams');

/**
 * Lambda handler – GET /translations/search?path=...&language=...&context=...
 * Almeno uno tra path, language, context; i filtri passati sono combinati in AND.
 * Ricostruisce il JSON annidato dai record trovati.
 *
 * @param {object} event - evento API Gateway proxy / invocazione diretta
 * @param {object} _context - contesto Lambda (non usato)
 * @param {object} [deps] - dipendenze iniettabili (test)
 */
exports.handler = async (event, _context, deps = {}) => {
  try {
    const params = parseRequestParams(event); // parametri da query/body/params
    const filters = {}; // solo i filtri valorizzati
    const path = validateText(params.path, 'path', 2048); // path (esatto o prefisso)
    const language = validateLanguage(params.language, false); // lingua
    const context = validateText(params.context, 'context', 512); // contesto
    if (path !== undefined) filters.path = path;
    if (language !== undefined) filters.language = language;
    if (context !== undefined) filters.context = context;
    // Vincolo di business: almeno un filtro
    if (Object.keys(filters).length === 0) {
      throw new ValidationError('Specificare almeno uno tra "path", "language" e "context"');
    }
    console.log(JSON.stringify({ logType: 'translations_search_start', service: 'translations', filters: Object.keys(filters) }));
    const repository = deps.dbRepository || buildDbRepository(); // repository Aurora
    const rows = await repository.findByFilters(filters); // ricerca con filtri in AND
    if (rows.length === 0) throw new NoTranslationsFoundError();
    const payload = buildTranslationsPayload(rows); // ricostruzione JSON annidato
    console.log(JSON.stringify({ logType: 'translations_search_done', service: 'translations', records: rows.length }));
    return response(200, payload);
  } catch (err) {
    return errorResponse(err, 'translations_search');
  }
};
