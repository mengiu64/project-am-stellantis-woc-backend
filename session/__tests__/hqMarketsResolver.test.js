'use strict';

const { resolveHqMarketsList } = require('../src/hqMarketsResolver');

describe('session/src/hqMarketsResolver — resolveHqMarketsList', () => {
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
