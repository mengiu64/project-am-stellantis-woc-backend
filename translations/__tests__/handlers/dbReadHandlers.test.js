'use strict';

const getByLanguage = require('../../src/handlers/getByLanguage');
const search = require('../../src/handlers/search');

const ROWS_EN = [
  { path: 'shell.layout.toast.close_aria', language: 'en', context: 'shell', translation: 'Close' },
  { path: 'shell.layout.main_header.logo_alt', language: 'en', context: 'shell', translation: 'Logo' },
];

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('getByLanguage', () => {
  test('200 con JSON annidato', async () => {
    const dbRepository = { findByLanguage: jest.fn().mockResolvedValue(ROWS_EN) };
    const res = await getByLanguage.handler({ queryStringParameters: { language: 'en' } }, {}, { dbRepository });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ shell: { layout: { toast: { close_aria: 'Close' }, main_header: { logo_alt: 'Logo' } } } });
    expect(dbRepository.findByLanguage).toHaveBeenCalledWith('en');
  });

  test('accetta l\'alias lang', async () => {
    const dbRepository = { findByLanguage: jest.fn().mockResolvedValue(ROWS_EN) };
    await getByLanguage.handler({ queryStringParameters: { lang: 'it' } }, {}, { dbRepository });
    expect(dbRepository.findByLanguage).toHaveBeenCalledWith('it');
  });

  test('language mancante o non valido -> 400', async () => {
    const dbRepository = { findByLanguage: jest.fn() };
    expect((await getByLanguage.handler({}, {}, { dbRepository })).statusCode).toBe(400);
    expect((await getByLanguage.handler({ queryStringParameters: { language: 'x;y' } }, {}, { dbRepository })).statusCode).toBe(400);
    expect((await getByLanguage.handler({ body: '{bad' }, {}, { dbRepository })).statusCode).toBe(400);
    expect(dbRepository.findByLanguage).not.toHaveBeenCalled();
  });

  test('nessun record -> 404', async () => {
    const dbRepository = { findByLanguage: jest.fn().mockResolvedValue([]) };
    expect((await getByLanguage.handler({ queryStringParameters: { language: 'fr' } }, {}, { dbRepository })).statusCode).toBe(404);
  });

  test('errore DB -> 500 generico', async () => {
    const dbRepository = { findByLanguage: jest.fn().mockRejectedValue(new Error('conn refused')) };
    const res = await getByLanguage.handler({ queryStringParameters: { language: 'en' } }, {}, { dbRepository });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('conn refused');
  });

  test('repository di default (nessuna dipendenza iniettata)', async () => {
    // pg non e' raggiungibile nei test: la creazione del repository va a buon fine, la query fallisce -> 500
    jest.doMock('../../shared/dbClient', () => ({ getPool: jest.fn().mockRejectedValue(new Error('no db')) }));
    jest.resetModules();
    const fresh = require('../../src/handlers/getByLanguage');
    expect((await fresh.handler({ queryStringParameters: { language: 'en' } })).statusCode).toBe(500);
    jest.dontMock('../../shared/dbClient');
  });
});

describe('search', () => {
  test('nessun filtro -> 400', async () => {
    const dbRepository = { findByFilters: jest.fn() };
    const res = await search.handler({ queryStringParameters: {} }, {}, { dbRepository });
    expect(res.statusCode).toBe(400);
    expect(dbRepository.findByFilters).not.toHaveBeenCalled();
  });

  test('filtri vuoti o spazi non contano come filtro', async () => {
    const dbRepository = { findByFilters: jest.fn() };
    const res = await search.handler({ queryStringParameters: { path: '  ', context: '', language: '' } }, {}, { dbRepository });
    expect(res.statusCode).toBe(400);
  });

  test('tutti i filtri in AND, JSON annidato per singola lingua', async () => {
    const dbRepository = { findByFilters: jest.fn().mockResolvedValue(ROWS_EN) };
    const res = await search.handler({ queryStringParameters: { path: 'shell.layout', language: 'en', context: 'shell' } }, {}, { dbRepository });
    expect(res.statusCode).toBe(200);
    expect(dbRepository.findByFilters).toHaveBeenCalledWith({ path: 'shell.layout', language: 'en', context: 'shell' });
    expect(JSON.parse(res.body).shell.layout.toast.close_aria).toBe('Close');
  });

  test('solo context, piu lingue -> raggruppato per lingua', async () => {
    const dbRepository = { findByFilters: jest.fn().mockResolvedValue([
      ...ROWS_EN,
      { path: 'shell.layout.toast.close_aria', language: 'it', context: 'shell', translation: '[shell.layout.toast.close_aria]' },
    ]) };
    const res = await search.handler({ body: JSON.stringify({ context: 'shell' }) }, {}, { dbRepository });
    expect(Object.keys(JSON.parse(res.body)).sort()).toEqual(['en', 'it']);
    expect(dbRepository.findByFilters).toHaveBeenCalledWith({ context: 'shell' });
  });

  test('nessun record -> 404; errore DB -> 500; filtro non valido -> 400', async () => {
    const dbRepository = { findByFilters: jest.fn().mockResolvedValue([]) };
    expect((await search.handler({ queryStringParameters: { path: 'x' } }, {}, { dbRepository })).statusCode).toBe(404);
    dbRepository.findByFilters.mockRejectedValue(new Error('boom'));
    expect((await search.handler({ queryStringParameters: { path: 'x' } }, {}, { dbRepository })).statusCode).toBe(500);
    expect((await search.handler({ queryStringParameters: { language: 'zz;' } }, {}, { dbRepository })).statusCode).toBe(400);
  });

  test('repository di default', async () => {
    jest.doMock('../../shared/dbClient', () => ({ getPool: jest.fn().mockRejectedValue(new Error('no db')) }));
    jest.resetModules();
    const fresh = require('../../src/handlers/search');
    expect((await fresh.handler({ queryStringParameters: { path: 'x' } })).statusCode).toBe(500);
    jest.dontMock('../../shared/dbClient');
  });
});
