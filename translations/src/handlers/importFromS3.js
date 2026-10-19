'use strict';

const { buildDbRepository, buildFileReader } = require('../repositoryFactory');
const { buildImportRows, isPlainObject, SOURCE_LANGUAGE } = require('../utils/translationsJson');

/**
 * Decodifica la chiave S3 dell'evento (URL-encoded, con "+" al posto dello spazio).
 */
function decodeKey(rawKey) {
  return decodeURIComponent(String(rawKey).replace(/\+/g, ' '));
}

/**
 * Chiave S3 attesa: {prefisso}/en/translation.json (default locales/en/translation.json).
 */
function expectedKey() {
  const prefix = process.env.TRANSLATIONS_KEY_PREFIX || 'locales'; // prefisso configurabile
  return `${prefix}/${SOURCE_LANGUAGE}/translation.json`;
}

/**
 * Elabora un singolo record S3: valida, legge il JSON, genera le righe per 5 lingue e fa l'upsert.
 *
 * @param {object} record - elemento di event.Records
 * @param {{dbRepository:object, fileReader:object}} deps - dipendenze
 * @returns {Promise<object>} esito del record
 */
async function processRecord(record, { dbRepository, fileReader }) {
  const eventName = String(record.eventName || ''); // es. ObjectCreated:Put
  const bucket = record.s3 && record.s3.bucket && record.s3.bucket.name; // bucket sorgente
  const rawKey = record.s3 && record.s3.object && record.s3.object.key; // chiave grezza
  const versionId = record.s3 && record.s3.object && record.s3.object.versionId; // versione dell'oggetto
  const sequencer = record.s3 && record.s3.object && record.s3.object.sequencer; // ordine eventi

  // Solo eventi di creazione/sovrascrittura (createObject / updateObject): mai ObjectRemoved
  if (record.eventSource !== 'aws:s3' || !eventName.startsWith('ObjectCreated:')) {
    console.log(JSON.stringify({ logType: 's3_import_skipped', service: 'translations', reason: 'evento non ammesso', eventSource: record.eventSource, eventName }));
    return { skipped: true, reason: 'evento non ammesso' };
  }
  // Il bucket deve essere esattamente quello configurato per l'ambiente
  const expectedBucket = process.env.TRANSLATIONS_BUCKET_NAME;
  if (!expectedBucket || bucket !== expectedBucket) {
    console.log(JSON.stringify({ logType: 's3_import_skipped', service: 'translations', reason: 'bucket non atteso', bucket }));
    return { skipped: true, reason: 'bucket non atteso' };
  }
  // La chiave deve coincidere esattamente (il filtro S3 lavora solo per prefisso/suffisso)
  const key = decodeKey(rawKey || '');
  if (key !== expectedKey()) {
    console.log(JSON.stringify({ logType: 's3_import_skipped', service: 'translations', reason: 'chiave non ammessa', bucket, key }));
    return { skipped: true, reason: 'chiave non ammessa' };
  }

  const ctx = { bucket, key, versionId: versionId || null, sequencer: sequencer || null }; // contesto di log
  console.log(JSON.stringify({ logType: 's3_import_start', service: 'translations', ...ctx }));

  // Lettura del file: se disabilitato il flag, si legge sempre l'ultima versione
  const useVersion = String(process.env.TRANSLATIONS_S3_READ_VERSION || 'true').toLowerCase() !== 'false';
  const json = await fileReader.readJson({ bucket, key, versionId: useVersion ? versionId : undefined });
  // Il file deve essere un oggetto JSON (non array / scalare)
  if (!isPlainObject(json)) {
    throw new Error(`Il file "${key}" non contiene un oggetto JSON di traduzioni`);
  }

  // Appiattimento e generazione delle righe per en + de/it/es/fr
  const { rows, skipped } = buildImportRows(json);
  if (skipped.length > 0) {
    // Log (limitato) delle voci scartate, senza il contenuto dei testi
    console.log(JSON.stringify({ logType: 's3_import_skipped_entries', service: 'translations', ...ctx, count: skipped.length, sample: skipped.slice(0, 20) }));
  }
  if (rows.length === 0) {
    console.log(JSON.stringify({ logType: 's3_import_empty', service: 'translations', ...ctx }));
    return { skipped: true, reason: 'nessuna voce importabile' };
  }

  // Upsert transazionale: solo INSERT/UPDATE, nessuna cancellazione
  const { inserted, updated } = await dbRepository.upsertRows(rows);
  console.log(JSON.stringify({ logType: 's3_import_done', service: 'translations', ...ctx, rows: rows.length, inserted, updated, skippedEntries: skipped.length }));
  return { skipped: false, rows: rows.length, inserted, updated };
}

/**
 * Handler dell'evento S3 (ObjectCreated: upload / sovrascrittura di translation.json).
 * In caso di errore RILANCIA l'eccezione, cosi' Lambda esegue i retry asincroni.
 *
 * @param {object} event - evento S3 con Records[]
 * @param {object} _context - contesto Lambda (non usato)
 * @param {object} [deps] - dipendenze iniettabili (test)
 * @returns {Promise<{success:boolean, results:Array}>}
 */
exports.handler = async (event, _context, deps = {}) => {
  const records = Array.isArray(event && event.Records) ? event.Records : []; // record dell'evento
  console.log(JSON.stringify({ logType: 's3_import_event', service: 'translations', records: records.length }));
  const dependencies = {
    dbRepository: deps.dbRepository || buildDbRepository(), // repository Aurora
    fileReader: deps.fileReader || buildFileReader(), // lettore S3
  };
  const results = []; // esiti per record
  for (const record of records) {
    try {
      results.push(await processRecord(record, dependencies)); // elaborazione sequenziale
    } catch (err) {
      // Log strutturato senza contenuto del file ne' credenziali, poi rilancio
      console.error(JSON.stringify({
        logType: 's3_import_error',
        service: 'translations',
        bucket: record.s3 && record.s3.bucket && record.s3.bucket.name,
        key: record.s3 && record.s3.object && record.s3.object.key,
        versionId: record.s3 && record.s3.object && record.s3.object.versionId,
        error: err.message,
        stack: err.stack,
      }));
      throw err;
    }
  }
  return { success: true, results };
};

exports._decodeKey = decodeKey;
exports._expectedKey = expectedKey;
