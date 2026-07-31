'use strict';

const { buildRepository } = require('../repositoryFactory');

const DEFAULT_LANG = process.env.TRANSLATIONS_DEFAULT_LANG || 'en';

/**
 * Lambda handler – GET /translations?lang=en
 *
 * Expected queryStringParameters / body / params:
 *   { lang: "en" }   (default: "en" se assente)
 *
 * Se il file di traduzione per la lingua richiesta non esiste su S3
 * (TranslationNotFoundError), effettua un fallback automatico verso
 * TRANSLATIONS_DEFAULT_LANG ("en" di default). Il 404 viene quindi
 * restituito solo se anche la lingua di fallback risulta assente.
 */
exports.handler = async (event) => {
  const { lang } = parseParams(event);

  try {
    const repository = buildRepository();
    const translations = await getTranslationsWithFallback(repository, lang);
    return response(200, translations);
  } catch (err) {
    if (err.code === 'TRANSLATION_NOT_FOUND') {
      return response(404, { success: false, message: err.message });
    }
    return response(502, { success: false, message: err.message ?? String(err) });
  }
};

/**
 * Recupera le traduzioni per `lang`; se non trovate e `lang` non è già la
 * lingua di default, ritenta con TRANSLATIONS_DEFAULT_LANG. Se anche il
 * fallback fallisce (o `lang` era già la lingua di default), viene
 * propagato l'errore originale (riferito alla lingua richiesta).
 */
async function getTranslationsWithFallback(repository, lang) {
  try {
    return await repository.getTranslations(lang);
  } catch (err) {
    if (err.code !== 'TRANSLATION_NOT_FOUND' || lang === DEFAULT_LANG) {
      throw err;
    }

    console.log(JSON.stringify({
      logType: 'translations_fallback',
      service: 'translations',
      requestedLang: lang,
      fallbackLang: DEFAULT_LANG,
      message: `Traduzioni non trovate per "${lang}", fallback su "${DEFAULT_LANG}"`,
    }));

    try {
      return await repository.getTranslations(DEFAULT_LANG);
    } catch (_fallbackErr) {
      throw err;
    }
  }
}

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
