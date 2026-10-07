'use strict';

const mockHttps = jest.fn();
const mockToken = jest.fn();
const mockInvalidate = jest.fn();
let mockBaseUrl = 'https://api.wyz.test';
jest.mock('../httpClient', () => ({ httpsRequest: (...a) => mockHttps(...a) }));
jest.mock('../authService', () => ({
  getBearerToken: (...a) => mockToken(...a),
  invalidateToken: (...a) => mockInvalidate(...a),
}));
jest.mock('../config', () => ({
  getConfig: async () => ({ api: { baseUrl: mockBaseUrl }, partner: 'WIADVISOR', timeoutMs: 1000 }),
}));

const { getSearchFilters, searchQuote, WyzError, mapStatus } = require('../wyzService');

const ok = (data) => ({ statusCode: 200, body: { data } });

// Risponde in base al path chiamato
function routeResponses(map) {
  mockHttps.mockImplementation(async (options) => {
    const key = Object.keys(map).find((k) => options.path.startsWith(k));
    const res = map[key];
    return typeof res === 'function' ? res(options) : res;
  });
}

describe('wyzService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBaseUrl = 'https://api.wyz.test';
    mockToken.mockResolvedValue('tok');
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('mapStatus', () => {
    it.each([
      [500, 'CUSTOMER_NOT_FOUND', 404],
      [400, undefined, 400],
      [404, undefined, 404],
      [422, undefined, 422],
      [401, undefined, 502],
      [403, undefined, 502],
      [500, undefined, 502],
    ])('upstream %s/%s -> %s', (up, code, expected) => {
      expect(mapStatus(up, code)).toBe(expected);
    });
  });

  describe('getSearchFilters', () => {
    const fourOk = () => ({
      '/api/tyres/vehicle-brands': ok([{ publicKey: 'vb1', brand: 'Fiat' }]),
      '/api/tyres/vehicle-types': ok([
        { publicKey: 't1', name: 'TO', groupPublicKey: 'g1', groupName: 'TC4' },
        { publicKey: 't2', name: 'CAM', groupPublicKey: 'g1', groupName: 'TC4' },
        { publicKey: 't3', name: 'X', groupPublicKey: 'g2', groupName: 'Other' },
      ]),
      '/api/tyres/brands': ok([
        { publicKey: 'b2', name: 'B', segment: 'BUDGET', rank: 2 },
        { publicKey: 'b0', name: 'NoRank', segment: 'QUALITY' },
        { publicKey: 'b1', name: 'A', segment: 'PREMIUM', rank: 1 },
      ]),
      '/api/tyres/seasons': ok([{ publicKey: 's1', i18nKey: 'season.summer', name: 'Ete' }]),
    });

    it('restituisce i filtri normalizzati e passa partner/customer/hub/correlation id', async () => {
      routeResponses(fourOk());

      const res = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' }, { correlationId: 'cid' });

      expect(Object.keys(res)).toEqual(['filters']);
      expect(res.filters.vehicleBrands).toEqual([{ id: 'vb1', name: 'Fiat' }]);
      expect(res.filters.vehicleTypes).toHaveLength(3);
      expect(res.filters.vehicleTypeGroups).toEqual([
        { id: 'g1', name: 'TC4', types: [{ id: 't1', name: 'TO' }, { id: 't2', name: 'CAM' }] },
        { id: 'g2', name: 'Other', types: [{ id: 't3', name: 'X' }] },
      ]);
      expect(res.filters.tyreBrands.map((b) => b.id)).toEqual(['b1', 'b2', 'b0']);
      expect(res.filters.seasons).toEqual([{ id: 's1', name: 'Ete', i18nKey: 'season.summer' }]);

      expect(mockHttps).toHaveBeenCalledTimes(4);
      const brandsCall = mockHttps.mock.calls.map(([o]) => o).find((o) => o.path.startsWith('/api/tyres/brands'));
      expect(brandsCall.path).toBe('/api/tyres/brands?customerRrdiCode=C1&hubCode=H1&partner=WIADVISOR');
      expect(brandsCall.headers).toMatchObject({ Authorization: 'Bearer tok', 'X-Correlation-Id': 'cid' });
      const seasonsCall = mockHttps.mock.calls.map(([o]) => o).find((o) => o.path.startsWith('/api/tyres/seasons'));
      expect(seasonsCall.path).toBe('/api/tyres/seasons?partner=WIADVISOR');
    });

    it.each([
      [undefined, ['customerRrdiCode', 'hubCode']],
      [{ customerRrdiCode: 'C1' }, ['hubCode']],
      [{ customerRrdiCode: '  ', hubCode: 'H' }, ['customerRrdiCode']],
    ])('400 se mancano campi obbligatori (%j)', async (params, missing) => {
      const err = await getSearchFilters(params).catch((e) => e);
      expect(err).toBeInstanceOf(WyzError);
      expect(err.statusCode).toBe(400);
      missing.forEach((m) => expect(err.message).toContain(m));
      expect(mockHttps).not.toHaveBeenCalled();
    });

    it('fallisce se una sola chiamata fallisce (CUSTOMER_NOT_FOUND su brands)', async () => {
      const map = fourOk();
      map['/api/tyres/brands'] = {
        statusCode: 500,
        body: { error: { context_code: 'PLUGIN_ERROR', error_code: 'CUSTOMER_NOT_FOUND', status: 500 } },
      };
      routeResponses(map);

      const err = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' }).catch((e) => e);

      expect(err).toBeInstanceOf(WyzError);
      expect(err.statusCode).toBe(404);
      expect(err.errorCode).toBe('CUSTOMER_NOT_FOUND');
      expect(err.message).toContain('tyreBrands');
      expect(err.details.failedCalls).toEqual([
        { call: 'tyreBrands', status: 404, message: expect.any(String), errorCode: 'CUSTOMER_NOT_FOUND' },
      ]);
    });

    it('errore di rete su una chiamata -> 502 senza errorCode', async () => {
      const map = fourOk();
      map['/api/tyres/seasons'] = () => { throw new Error('boom'); };
      routeResponses(map);

      const err = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' }).catch((e) => e);
      expect(err.statusCode).toBe(502);
      expect(err.details.failedCalls).toEqual([
        { call: 'seasons', status: 502, message: 'Servizio Wyz non raggiungibile' },
      ]);
    });

    it('più chiamate fallite: elenca tutte, status della prima', async () => {
      const map = fourOk();
      map['/api/tyres/vehicle-types'] = { statusCode: 400, body: {} };
      map['/api/tyres/seasons'] = { statusCode: 500, body: {} };
      routeResponses(map);

      const err = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' }).catch((e) => e);
      expect(err.statusCode).toBe(400);
      expect(err.details.failedCalls.map((c) => c.call)).toEqual(['vehicleTypes', 'seasons']);
    });

    it('tutte fallite -> errore', async () => {
      mockHttps.mockResolvedValue({ statusCode: 500, body: 'oops' });
      const err = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' }).catch((e) => e);
      expect(err.statusCode).toBe(502);
      expect(err.details.failedCalls).toHaveLength(4);
    });

    it('gestisce data non-array come lista vuota', async () => {
      routeResponses({
        '/api/tyres/vehicle-brands': ok(null),
        '/api/tyres/vehicle-types': ok({}),
        '/api/tyres/brands': ok('x'),
        '/api/tyres/seasons': ok(undefined),
      });
      const res = await getSearchFilters({ customerRrdiCode: 'C1', hubCode: 'H1' });
      expect(res.filters.vehicleBrands).toEqual([]);
      expect(res.filters.vehicleTypes).toEqual([]);
      expect(res.filters.tyreBrands).toEqual([]);
    });
  });

  describe('searchQuote', () => {
    const valid = {
      customerRrdiCode: 'C1', hubCode: 'H1', width: 205, height: 55, diameter: 16, quantity: 2,
      vehicleTypes: ['t1'], vehicleBrands: ['vb1'], seasons: ['s1'], brands: ['b1'],
      speedIndexes: ['H'], loadIndexes: [91], runFlat: false, tyreBrands: ['x'], evil: 'dropme', nullable: null,
    };

    it('invia il POST con i soli campi ammessi e restituisce data', async () => {
      mockHttps.mockResolvedValue(ok({ items: [{ a: 1 }, { a: 2 }] }));

      const data = await searchQuote(valid, { correlationId: 'cid' });

      expect(data).toEqual({ items: [{ a: 1 }, { a: 2 }] });
      const [options, bodyStr] = mockHttps.mock.calls[0];
      expect(options).toMatchObject({
        hostname: 'api.wyz.test', port: 443, method: 'POST', timeout: 1000,
        path: '/api/tyres/search/quote?partner=WIADVISOR',
      });
      expect(options.headers['Content-Type']).toBe('application/json');
      const sent = JSON.parse(bodyStr);
      expect(sent.evil).toBeUndefined();
      expect(sent.tyreBrands).toBeUndefined();
      expect(sent).toMatchObject({ width: 205, brands: ['b1'], quantity: 2 });
      expect(options.headers['Content-Length']).toBe(Buffer.byteLength(bodyStr));
    });

    it('gestisce data senza items nel log', async () => {
      mockHttps.mockResolvedValue(ok({}));
      await expect(searchQuote(valid)).resolves.toEqual({});
    });

    it.each([
      ['input assente', undefined],
      ['input non oggetto', 'x'],
      ['width non numerico', { ...valid, width: '205' }],
      ['height <= 0', { ...valid, height: 0 }],
      ['quantity non intera', { ...valid, quantity: 1.5 }],
      ['quantity < 1', { ...valid, quantity: 0 }],
      ['customerRrdiCode vuoto', { ...valid, customerRrdiCode: '' }],
      ['hubCode assente', { ...valid, hubCode: undefined }],
      ['vehicleTypes vuoto', { ...valid, vehicleTypes: [] }],
      ['vehicleBrands non array', { ...valid, vehicleBrands: 'x' }],
    ])('400 se %s', async (_n, input) => {
      const err = await searchQuote(input).catch((e) => e);
      expect(err).toBeInstanceOf(WyzError);
      expect(err.statusCode).toBe(400);
      expect(mockHttps).not.toHaveBeenCalled();
    });

    it('422 da Wyz propaga lo status e i dettagli', async () => {
      mockHttps.mockResolvedValue({
        statusCode: 422,
        body: { error: { context_code: 'VALIDATION_ERROR', error_code: 'PAYLOAD_VALIDATION_FAILED', status: 422, details: [{ f: 'x' }] } },
      });
      const err = await searchQuote(valid).catch((e) => e);
      expect(err.statusCode).toBe(422);
      expect(err.errorCode).toBe('PAYLOAD_VALIDATION_FAILED');
      expect(err.contextCode).toBe('VALIDATION_ERROR');
      expect(err.details).toEqual([{ f: 'x' }]);
    });

    it('422 con "errors" come dettagli alternativi', async () => {
      mockHttps.mockResolvedValue({ statusCode: 422, body: { errors: ['e'] } });
      const err = await searchQuote(valid).catch((e) => e);
      expect(err.details).toEqual(['e']);
    });

    it('il body di errore al top level (senza "error") viene comunque letto', async () => {
      mockHttps.mockResolvedValue({ statusCode: 400, body: { error_code: 'X', context_code: 'Y' } });
      const err = await searchQuote(valid).catch((e) => e);
      expect(err).toMatchObject({ statusCode: 400, errorCode: 'X', contextCode: 'Y' });
    });

    it('risposta priva di "data" -> 502', async () => {
      mockHttps.mockResolvedValue({ statusCode: 200, body: { foo: 1 } });
      await expect(searchQuote(valid)).rejects.toMatchObject({ statusCode: 502 });
    });

    it('body non oggetto -> 502', async () => {
      mockHttps.mockResolvedValue({ statusCode: 200, body: 'html' });
      await expect(searchQuote(valid)).rejects.toMatchObject({ statusCode: 502 });
    });
  });

  describe('callWyz: resilienza', () => {
    const params = { customerRrdiCode: 'C1', hubCode: 'H1' };
    const quote = {
      customerRrdiCode: 'C1', hubCode: 'H1', width: 205, height: 55, diameter: 16, quantity: 2,
      vehicleTypes: ['t'], vehicleBrands: ['v'],
    };

    it('su 401 invalida il token e ritenta una volta con successo', async () => {
      mockHttps
        .mockResolvedValueOnce({ statusCode: 401, body: {} })
        .mockResolvedValueOnce(ok({ items: [] }));

      await expect(searchQuote(quote)).resolves.toEqual({ items: [] });
      expect(mockInvalidate).toHaveBeenCalledTimes(1);
      expect(mockToken).toHaveBeenCalledTimes(2);
    });

    it('doppio 401 -> 502 (mai 401 al front-end)', async () => {
      mockHttps.mockResolvedValue({ statusCode: 401, body: {} });
      await expect(searchQuote(quote)).rejects.toMatchObject({ statusCode: 502, upstreamStatus: 401 });
      expect(mockHttps).toHaveBeenCalledTimes(2);
    });

    it('autenticazione fallita -> 502', async () => {
      mockToken.mockRejectedValue(new Error('[auth] HTTP 401'));
      await expect(searchQuote(quote)).rejects.toMatchObject({
        statusCode: 502, message: 'Autenticazione verso il servizio Wyz fallita',
      });
    });

    it('timeout di rete -> 504', async () => {
      mockHttps.mockRejectedValue(new Error('Timeout richiesta HTTP dopo 10000ms'));
      await expect(searchQuote(quote)).rejects.toMatchObject({ statusCode: 504 });
    });

    it('errore di rete -> 502', async () => {
      mockHttps.mockRejectedValue(new Error('ECONNREFUSED'));
      await expect(searchQuote(quote)).rejects.toMatchObject({ statusCode: 502, message: 'Servizio Wyz non raggiungibile' });
    });

    it('baseUrl non valido -> 500', async () => {
      mockBaseUrl = 'not a url';
      await expect(getSearchFilters(params)).rejects.toMatchObject({ statusCode: 500 });
    });

    it('baseUrl con path e porta esplicita', async () => {
      mockBaseUrl = 'https://gw.wyz.test:8443/prefix/';
      mockHttps.mockResolvedValue(ok({ items: [] }));
      await searchQuote(quote);
      expect(mockHttps.mock.calls[0][0]).toMatchObject({
        hostname: 'gw.wyz.test', port: '8443', path: '/prefix/api/tyres/search/quote?partner=WIADVISOR',
      });
    });
  });
});
