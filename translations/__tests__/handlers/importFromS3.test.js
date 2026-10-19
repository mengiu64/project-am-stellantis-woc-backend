'use strict';

const { handler, _decodeKey, _expectedKey } = require('../../src/handlers/importFromS3');

const BUCKET = 'bucket-test';
const KEY = 'locales/en/translation.json';

function record(over = {}) {
  return {
    eventSource: 'aws:s3',
    eventName: 'ObjectCreated:Put',
    s3: { bucket: { name: BUCKET }, object: { key: KEY, versionId: 'v1', sequencer: 's1' } },
    ...over,
  };
}

describe('importFromS3', () => {
  let dbRepository; let fileReader;
  const ENV = { ...process.env };

  beforeEach(() => {
    process.env.TRANSLATIONS_BUCKET_NAME = BUCKET;
    delete process.env.TRANSLATIONS_KEY_PREFIX;
    delete process.env.TRANSLATIONS_S3_READ_VERSION;
    dbRepository = { upsertRows: jest.fn().mockResolvedValue({ inserted: 5, updated: 0 }) };
    fileReader = { readJson: jest.fn().mockResolvedValue({ shell: { layout: { toast: { close_aria: 'Close' } } } }) };
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => { process.env = { ...ENV }; jest.restoreAllMocks(); });

  test('importa 5 righe per voce leggendo la versione indicata dall\'evento', async () => {
    const out = await handler({ Records: [record()] }, {}, { dbRepository, fileReader });
    expect(out.success).toBe(true);
    expect(out.results[0]).toEqual({ skipped: false, rows: 5, inserted: 5, updated: 0 });
    expect(fileReader.readJson).toHaveBeenCalledWith({ bucket: BUCKET, key: KEY, versionId: 'v1' });
    const rows = dbRepository.upsertRows.mock.calls[0][0];
    expect(rows.map((r) => r.language)).toEqual(['en', 'de', 'it', 'es', 'fr']);
  });

  test('chiave URL-encoded con "+" e prefisso configurabile', async () => {
    process.env.TRANSLATIONS_KEY_PREFIX = 'my loc';
    const out = await handler({ Records: [record({ s3: { bucket: { name: BUCKET }, object: { key: 'my+loc/en/translation.json' } } })] }, {}, { dbRepository, fileReader });
    expect(out.results[0].skipped).toBe(false);
    expect(fileReader.readJson).toHaveBeenCalledWith({ bucket: BUCKET, key: 'my loc/en/translation.json', versionId: undefined });
    expect(_decodeKey('a%2Fb+c')).toBe('a/b c');
    expect(_expectedKey()).toBe('my loc/en/translation.json');
  });

  test('flag TRANSLATIONS_S3_READ_VERSION=false legge l\'ultima versione', async () => {
    process.env.TRANSLATIONS_S3_READ_VERSION = 'false';
    await handler({ Records: [record()] }, {}, { dbRepository, fileReader });
    expect(fileReader.readJson).toHaveBeenCalledWith({ bucket: BUCKET, key: KEY, versionId: undefined });
  });

  test.each([
    ['evento di cancellazione', record({ eventName: 'ObjectRemoved:Delete' })],
    ['sorgente non S3', record({ eventSource: 'aws:sqs' })],
    ['bucket diverso', record({ s3: { bucket: { name: 'altro' }, object: { key: KEY } } })],
    ['chiave con stesso prefisso', record({ s3: { bucket: { name: BUCKET }, object: { key: `${KEY}.bak` } } })],
    ['record senza dati s3', { eventSource: 'aws:s3', eventName: 'ObjectCreated:Put' }],
  ])('scarta: %s', async (_n, rec) => {
    const out = await handler({ Records: [rec] }, {}, { dbRepository, fileReader });
    expect(out.results[0].skipped).toBe(true);
    expect(fileReader.readJson).not.toHaveBeenCalled();
    expect(dbRepository.upsertRows).not.toHaveBeenCalled();
  });

  test('bucket atteso non configurato -> record scartato', async () => {
    delete process.env.TRANSLATIONS_BUCKET_NAME;
    const out = await handler({ Records: [record()] }, {}, { dbRepository, fileReader });
    expect(out.results[0].skipped).toBe(true);
  });

  test('file senza voci importabili -> nessuna scrittura', async () => {
    fileReader.readJson.mockResolvedValue({});
    const out = await handler({ Records: [record()] }, {}, { dbRepository, fileReader });
    expect(out.results[0]).toEqual({ skipped: true, reason: 'nessuna voce importabile' });
    expect(dbRepository.upsertRows).not.toHaveBeenCalled();
  });

  test('voci scartate loggate ma import eseguito', async () => {
    fileReader.readJson.mockResolvedValue({ a: { ok: 'x', arr: [1] } });
    const out = await handler({ Records: [record()] }, {}, { dbRepository, fileReader });
    expect(out.results[0].rows).toBe(5);
  });

  test('file non oggetto -> errore rilanciato', async () => {
    fileReader.readJson.mockResolvedValue([1, 2]);
    await expect(handler({ Records: [record()] }, {}, { dbRepository, fileReader })).rejects.toThrow(/oggetto JSON/);
  });

  test('errore DB o S3 -> rilanciato per i retry Lambda', async () => {
    dbRepository.upsertRows.mockRejectedValue(new Error('db down'));
    await expect(handler({ Records: [record()] }, {}, { dbRepository, fileReader })).rejects.toThrow('db down');
    const bare = { eventSource: 'aws:s3', eventName: 'ObjectCreated:Put', s3: { bucket: { name: BUCKET }, object: { key: KEY } } };
    fileReader.readJson.mockRejectedValue(new Error('s3 ko'));
    await expect(handler({ Records: [bare] }, {}, { dbRepository, fileReader })).rejects.toThrow('s3 ko');
  });

  test('errore su record privo di s3 viene loggato senza eccezioni secondarie', async () => {
    fileReader.readJson.mockResolvedValue([]);
    await expect(handler({ Records: [record()] }, {}, { dbRepository, fileReader })).rejects.toThrow();
  });

  test('evento senza Records e dipendenze di default', async () => {
    const out = await handler(undefined);
    expect(out).toEqual({ success: true, results: [] });
  });
});
