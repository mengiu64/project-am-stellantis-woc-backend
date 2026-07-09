'use strict';

const { buildRepository } = require('../repositoryFactory');

const DEFAULT_LANG = process.env.TRANSLATIONS_DEFAULT_LANG || 'en';

/**
 * Lambda handler – GET /translations?lang=en
 *
 * Expected queryStringParameters / body / params:
 *   { lang: "en" }   (default: "en" se assente)
 */
exports.handler = async (event) => {
  const { lang } = parseParams(event);

  try {
    const repository = buildRepository();
    const translations = await repository.getTranslations(lang);
    return response(200, translations);
  } catch (err) {
    if (err.code === 'TRANSLATION_NOT_FOUND') {
      return response(404, { success: false, message: err.message });
    }
    return response(502, { success: false, message: err.message ?? String(err) });
  }
};

function parseParams(event) {
  const params = {
    ...(event.queryStringParameters || {}),
    ...(event.body ? JSON.parse(event.body) : {}),
    ...(event.params || {}),
  };
  return { lang: params.lang || DEFAULT_LANG };
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
