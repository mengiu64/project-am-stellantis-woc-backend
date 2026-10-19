'use strict';

// Lingue derivate create automaticamente per ogni voce della lingua sorgente (inglese)
const DERIVED_LANGUAGES = ['de', 'it', 'es', 'fr'];
// Lingua sorgente del file translation.json
const SOURCE_LANGUAGE = 'en';
// Limiti di lunghezza delle colonne di woc.translations
const MAX_PATH_LENGTH = 2048;
const MAX_TRANSLATION_LENGTH = 2048;
const MAX_CONTEXT_LENGTH = 512;

/**
 * Verifica che un valore sia un oggetto "semplice" (non null, non array).
 */
function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Appiattisce il JSON annidato in una lista di record { path, context, translation }.
 * Esempio: { shell: { layout: { toast: { close_aria: "Close" } } } }
 *   -> { path: "shell.layout.toast.close_aria", context: "shell", translation: "Close" }
 * Le voci non importabili (array, null, chiavi con "." o vuote, lunghezze oltre i limiti
 * della colonna) vengono scartate e riportate in `skipped`, senza interrompere l'import.
 *
 * @param {object} json - contenuto di translation.json
 * @returns {{records: Array<{path:string,context:string,translation:string}>, skipped: Array<{path:string,reason:string}>}}
 */
function flattenTranslations(json) {
  const records = []; // record validi da inserire
  const skipped = []; // voci scartate con motivazione

  // Visita ricorsiva: `segments` e' il percorso di chiavi fin qui attraversato
  const walk = (node, segments) => {
    for (const [key, value] of Object.entries(node)) {
      // Una chiave vuota o contenente "." renderebbe ambigua la ricostruzione del path
      if (key === '' || key.includes('.')) {
        skipped.push({ path: [...segments, key].join('.'), reason: 'chiave non valida (vuota o con ".")' });
        continue;
      }
      const current = [...segments, key]; // percorso corrente
      if (isPlainObject(value)) {
        walk(value, current); // nodo intermedio: scendo di livello
        continue;
      }
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        const path = current.join('.'); // path completo con separatore "."
        const context = current[0]; // il contesto e' il primo segmento (es. shell)
        const translation = String(value); // i valori scalari sono salvati come testo
        // Controllo dei limiti delle colonne per evitare errori DB sull'intero batch
        if (path.length > MAX_PATH_LENGTH || translation.length > MAX_TRANSLATION_LENGTH || context.length > MAX_CONTEXT_LENGTH) {
          skipped.push({ path, reason: 'lunghezza oltre il limite della colonna' });
          continue;
        }
        records.push({ path, context, translation });
        continue;
      }
      // Array, null o altri tipi non sono supportati
      skipped.push({ path: current.join('.'), reason: 'tipo di valore non supportato' });
    }
  };

  walk(json, []);
  return { records, skipped };
}

/**
 * Costruisce le righe da scrivere in woc.translations a partire dal JSON inglese:
 * per ogni voce "en" crea 4 righe (de, it, es, fr) con stesso path e stesso context
 * e con translation = path tra parentesi quadre (segnaposto da tradurre).
 *
 * @param {object} json - contenuto di translation.json (inglese)
 * @returns {{rows: Array<{path:string,language:string,context:string,translation:string}>, skipped: Array}}
 */
function buildImportRows(json) {
  const { records, skipped } = flattenTranslations(json);
  const rows = []; // righe finali per tutte le lingue
  for (const rec of records) {
    // Riga della lingua sorgente con il testo reale
    rows.push({ path: rec.path, language: SOURCE_LANGUAGE, context: rec.context, translation: rec.translation });
    // Righe delle altre lingue con segnaposto "[path]"
    for (const language of DERIVED_LANGUAGES) {
      const placeholder = `[${rec.path}]`; // path racchiuso tra parentesi quadre
      // Il segnaposto non deve superare il limite della colonna translation
      if (placeholder.length > MAX_TRANSLATION_LENGTH) {
        skipped.push({ path: rec.path, reason: `segnaposto troppo lungo per la lingua ${language}` });
        continue;
      }
      rows.push({ path: rec.path, language, context: rec.context, translation: placeholder });
    }
  }
  return { rows, skipped };
}

/**
 * Ricostruisce il JSON annidato (stessa struttura di translation.json) da righe di una
 * singola lingua. Un path in conflitto (e' sia foglia sia nodo intermedio) viene scartato.
 *
 * @param {Array<{path:string,translation:string}>} rows - righe di woc.translations
 * @returns {object} oggetto annidato
 */
function unflattenTranslations(rows) {
  const root = Object.create(null); // prototipo nullo: protegge da chiavi tipo __proto__
  for (const row of rows) {
    const segments = String(row.path).split('.'); // spezza il path nei segmenti originali
    let node = root; // nodo corrente, parte dalla radice
    let conflict = false; // true se il path collide con un'altra voce
    for (let i = 0; i < segments.length - 1; i += 1) {
      const seg = segments[i]; // segmento intermedio
      if (node[seg] === undefined) {
        node[seg] = Object.create(null); // creo il nodo intermedio mancante
      } else if (typeof node[seg] !== 'object') {
        conflict = true; // esiste gia' una foglia con questo prefisso
        break;
      }
      node = node[seg]; // scendo nel nodo figlio
    }
    const leaf = segments[segments.length - 1]; // ultimo segmento: la foglia
    // Conflitto anche se la foglia coincide con un nodo intermedio gia' creato
    if (conflict || (node[leaf] !== undefined && typeof node[leaf] === 'object')) {
      console.log(JSON.stringify({ logType: 'unflatten_conflict', service: 'translations', path: row.path }));
      continue;
    }
    node[leaf] = row.translation; // assegno il testo tradotto
  }
  return root;
}

/**
 * Costruisce il payload di risposta dalle righe lette dal DB.
 * - una sola lingua nel risultato: JSON annidato identico a translation.json;
 * - piu' lingue (ricerca senza filtro language): { "<lingua>": <JSON annidato>, ... },
 *   perche' lo stesso path in lingue diverse non puo' convivere nello stesso albero.
 *
 * @param {Array<{path:string,language:string,translation:string}>} rows - righe dal DB
 * @returns {object} JSON ricostruito
 */
function buildTranslationsPayload(rows) {
  // Raggruppo le righe per lingua
  const byLanguage = new Map();
  for (const row of rows) {
    if (!byLanguage.has(row.language)) byLanguage.set(row.language, []);
    byLanguage.get(row.language).push(row);
  }
  // Caso singola lingua: struttura identica al file originale
  if (byLanguage.size === 1) {
    return unflattenTranslations(rows);
  }
  // Caso multi-lingua: un albero per ciascuna lingua
  const result = {};
  for (const [language, langRows] of byLanguage.entries()) {
    result[language] = unflattenTranslations(langRows);
  }
  return result;
}

module.exports = {
  DERIVED_LANGUAGES,
  SOURCE_LANGUAGE,
  isPlainObject,
  flattenTranslations,
  buildImportRows,
  unflattenTranslations,
  buildTranslationsPayload,
};
