'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });

const { callService } = require('../../serviceClient');
const { resolveHqMarketsList } = require('../src/hqMarketsResolver');

describe('session/src/hqMarketsResolver — resolveHqMarketsList', () => {
  beforeEach(() => callService.mockReset());

  it('HQ centrale chiama REST senza argomenti, HQ mercato conserva il filtro', async () => {
    const rows = [{ market: '3109', description: 'France' }];
    callService.mockResolvedValue(rows);
    expect(await resolveHqMarketsList({ hqCentral: 1 })).toBe(rows);
    expect(await resolveHqMarketsList({ hqMarket: 1, roles: ['HQNSC3109'] })).toBe(rows);
    expect(callService.mock.calls).toEqual([
      ['dbmanager', 'getMarkets', { args: [] }],
      ['dbmanager', 'getMarkets', { args: [{ markets: ['3109'] }] }],
    ]);
  });

  it('gli errori HTTP REST sono loggati e ritornano elenco vuoto', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    callService.mockRejectedValue(new Error('HTTP 503'));
    expect(await resolveHqMarketsList({ hqCentral: 1 })).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 503'));
    errorSpy.mockRestore();
  });
  it('ritorna [] per un dealer (hqCentral=0, hqMarket=0), senza chiamare fetchMarketsFn', async () => {
    const fetchMarketsFn = jest.fn();

    const result = await resolveHqMarketsList({ hqCentral: 0, hqMarket: 0, roles: ['dealer'] }, fetchMarketsFn);

    expect(result).toEqual([]);
    expect(fetchMarketsFn).not.toHaveBeenCalled();
  });

  it('per HQ centrale chiama fetchMarketsFn() senza filtro e ritorna tutti i mercati', async () => {
    const rows = [
      { market: '1000', description: 'Italy' },
      { market: '3109', description: 'France' },
    ];
    const fetchMarketsFn = jest.fn().mockResolvedValue(rows);

    const result = await resolveHqMarketsList(
      { hqCentral: 1, hqMarket: 0, roles: ['ZWRT.WOC.NONPROD.HQCENTRAL'] },
      fetchMarketsFn,
    );

    expect(result).toEqual(rows);
    expect(fetchMarketsFn).toHaveBeenCalledWith();
  });

  it('per HQ mercato ricava il codice mercato dal ruolo HQNSC<codice> e filtra fetchMarketsFn', async () => {
    const fetchMarketsFn = jest.fn().mockResolvedValue([{ market: '3109', description: 'France' }]);

    const result = await resolveHqMarketsList(
      { hqCentral: 0, hqMarket: 1, roles: ['ZWRT.WOC.NONPROD.HQNSC3109'] },
      fetchMarketsFn,
    );

    expect(result).toEqual([{ market: '3109', description: 'France' }]);
    expect(fetchMarketsFn).toHaveBeenCalledWith({ markets: ['3109'] });
  });

  it('per HQ mercato senza alcun ruolo HQNSC<codice> ritorna [] senza chiamare fetchMarketsFn', async () => {
    const fetchMarketsFn = jest.fn();

    const result = await resolveHqMarketsList({ hqCentral: 0, hqMarket: 1, roles: ['altro.ruolo'] }, fetchMarketsFn);

    expect(result).toEqual([]);
    expect(fetchMarketsFn).not.toHaveBeenCalled();
  });

  it('ritorna [] (fault-tolerant) se fetchMarketsFn rigetta, senza propagare l\'errore', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMarketsFn = jest.fn().mockRejectedValue(new Error('db unreachable'));

    const result = await resolveHqMarketsList({ hqCentral: 1, hqMarket: 0, roles: [] }, fetchMarketsFn);

    expect(result).toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('db unreachable'));
    errorSpy.mockRestore();
  });

  it('gestisce roles assente/non array senza lanciare', async () => {
    const result = await resolveHqMarketsList({ hqCentral: 0, hqMarket: 1 }, jest.fn());
    expect(result).toEqual([]);
  });

  it('chiamata senza argomenti ritorna [] (dealer di default)', async () => {
    const result = await resolveHqMarketsList();
    expect(result).toEqual([]);
  });
});
