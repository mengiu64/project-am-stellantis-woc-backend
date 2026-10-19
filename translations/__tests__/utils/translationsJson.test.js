'use strict';

const {
  flattenTranslations, buildImportRows, unflattenTranslations, buildTranslationsPayload,
} = require('../../src/utils/translationsJson');

// Frammento di esempio tratto dalla specifica
const SAMPLE = {
  shell: {
    layout: {
      main_header: { logo_alt: 'WI Advisor - Your Total Service Resource' },
      toast: { close_aria: 'Close' },
    },
  },
};

describe('flattenTranslations', () => {
  test('appiattisce il JSON in path/context/translation', () => {
    const { records, skipped } = flattenTranslations(SAMPLE);
    expect(skipped).toEqual([]);
    expect(records).toEqual([
      { path: 'shell.layout.main_header.logo_alt', context: 'shell', translation: 'WI Advisor - Your Total Service Resource' },
      { path: 'shell.layout.toast.close_aria', context: 'shell', translation: 'Close' },
    ]);
  });

  test('converte numeri/booleani in testo e scarta tipi non supportati e chiavi non valide', () => {
    const { records, skipped } = flattenTranslations({
      a: { n: 5, b: true, arr: ['x'], nul: null, 'bad.key': 'x', '': 'y' },
    });
    expect(records).toEqual([
      { path: 'a.n', context: 'a', translation: '5' },
      { path: 'a.b', context: 'a', translation: 'true' },
    ]);
    expect(skipped.map((s) => s.path)).toEqual(['a.arr', 'a.nul', 'a.bad.key', 'a.']);
  });

  test('scarta voci oltre i limiti di lunghezza delle colonne', () => {
    const { records, skipped } = flattenTranslations({ c: { t: 'x'.repeat(2049) }, ['k'.repeat(513)]: { a: 'ok' } });
    expect(records).toEqual([]);
    expect(skipped).toHaveLength(2);
  });
});

describe('buildImportRows', () => {
  test('genera 5 righe per voce: en reale + de/it/es/fr con [path]', () => {
    const { rows } = buildImportRows(SAMPLE);
    expect(rows).toHaveLength(10);
    const toast = rows.filter((r) => r.path === 'shell.layout.toast.close_aria');
    expect(toast.map((r) => r.language)).toEqual(['en', 'de', 'it', 'es', 'fr']);
    expect(toast[0].translation).toBe('Close');
    for (const r of toast.slice(1)) {
      expect(r.translation).toBe('[shell.layout.toast.close_aria]');
      expect(r.context).toBe('shell');
    }
  });

  test('scarta le lingue derivate se il segnaposto supera il limite', () => {
    const longPath = `ctx.${'a'.repeat(2044)}`; // 2048 caratteri: ok per path, segnaposto da 2050
    const { rows, skipped } = buildImportRows({ ctx: { ['a'.repeat(2044)]: 'v' } });
    expect(longPath).toHaveLength(2048);
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(4);
  });
});

describe('unflattenTranslations / buildTranslationsPayload', () => {
  test('round-trip: flatten + unflatten restituisce il JSON originale', () => {
    const { rows } = buildImportRows(SAMPLE);
    const en = rows.filter((r) => r.language === 'en');
    expect(JSON.parse(JSON.stringify(unflattenTranslations(en)))).toEqual(SAMPLE);
  });

  test('scarta i path in conflitto (foglia vs nodo) e protegge da __proto__', () => {
    const tree = unflattenTranslations([
      { path: 'a.b', translation: 'leaf' },
      { path: 'a.b.c', translation: 'conflict' },
      { path: 'x.y.z', translation: 'node' },
      { path: 'x.y', translation: 'conflict2' },
      { path: '__proto__.polluted', translation: 'p' },
    ]);
    expect(JSON.parse(JSON.stringify(tree))).toEqual({ a: { b: 'leaf' }, x: { y: { z: 'node' } }, ['__proto__']: { polluted: 'p' } });
    expect({}.polluted).toBeUndefined();
  });

  test('una sola lingua -> albero diretto; piu lingue -> raggruppato per lingua', () => {
    const one = buildTranslationsPayload([{ path: 'a.b', language: 'en', translation: 'X' }]);
    expect(JSON.parse(JSON.stringify(one))).toEqual({ a: { b: 'X' } });
    const many = buildTranslationsPayload([
      { path: 'a.b', language: 'en', translation: 'X' },
      { path: 'a.b', language: 'it', translation: 'Y' },
    ]);
    expect(JSON.parse(JSON.stringify(many))).toEqual({ en: { a: { b: 'X' } }, it: { a: { b: 'Y' } } });
  });
});
