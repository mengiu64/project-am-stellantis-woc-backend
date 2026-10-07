'use strict';

const mockFilters = jest.fn();
const mockQuote = jest.fn();
jest.mock('../wyzService', () => {
  const actual = jest.requireActual('../wyzService');
  return { ...actual, getSearchFilters: (...a) => mockFilters(...a), searchQuote: (...a) => mockQuote(...a) };
});
jest.mock('fs');

const fs = require('fs');
const { WyzError } = require('../wyzService');
const { handler, resolveActionAndBody, runAction, main } = require('../index');

const parse = (res) => JSON.parse(res.body);

describe('wyz handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  describe('resolveActionAndBody', () => {
    it('event.action ha priorità', () => {
      expect(resolveActionAndBody({ action: 'searchQuote', path: '/x/getSearchFilters' }).action).toBe('searchQuote');
    });
    it.each([
      [{ path: '/api/wyz/getSearchFilters' }],
      [{ rawPath: '/api/wyz/getSearchFilters/' }],
      [{ pathParameters: { proxy: 'getSearchFilters' } }],
    ])('estrae l\'azione dal path (%j)', (ev) => {
      expect(resolveActionAndBody(ev).action).toBe('getSearchFilters');
    });
    it('action undefined senza path', () => {
      expect(resolveActionAndBody({}).action).toBeUndefined();
    });
    it('il body ha priorità sulla query string; body oggetto accettato', () => {
      expect(resolveActionAndBody({ queryStringParameters: { a: '1', b: '2' }, body: '{"b":"3"}' }).body).toEqual({ a: '1', b: '3' });
      expect(resolveActionAndBody({ body: { c: 1 } }).body).toEqual({ c: 1 });
    });
    it('body "null" non rompe', () => {
      expect(resolveActionAndBody({ body: 'null' }).body).toEqual({});
    });
    it('lancia su body non JSON', () => {
      expect(() => resolveActionAndBody({ body: '{bad' })).toThrow();
    });
  });

  describe('handler', () => {
    it('getSearchFilters -> 200 con filters', async () => {
      mockFilters.mockResolvedValue({ filters: { seasons: [] } });
      const res = await handler({
        path: '/api/wyz/getSearchFilters', httpMethod: 'GET',
        queryStringParameters: { customerRrdiCode: 'C1', hubCode: 'H1' },
        requestContext: { requestId: 'req-1' },
      });
      expect(res.statusCode).toBe(200);
      expect(parse(res)).toEqual({ success: true, filters: { seasons: [] } });
      expect(mockFilters).toHaveBeenCalledWith({ customerRrdiCode: 'C1', hubCode: 'H1' }, { correlationId: 'req-1' });
    });

    it('searchQuote -> 200 con data, payload annidato supportato e correlationId generato', async () => {
      mockQuote.mockResolvedValue({ items: [] });
      const res = await handler({ path: '/searchQuote', rawPath: undefined, body: JSON.stringify({ payload: { width: 1 } }) });
      expect(parse(res)).toEqual({ success: true, data: { items: [] } });
      const [payload, ctx] = mockQuote.mock.calls[0];
      expect(payload).toEqual({ width: 1 });
      expect(ctx.correlationId).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('evento assente -> azione sconosciuta 400', async () => {
      const res = await handler(undefined);
      expect(res.statusCode).toBe(400);
      expect(parse(res).message).toContain('Unknown action');
    });

    it('azione sconosciuta -> 400', async () => {
      const res = await handler({ path: '/api/wyz/nope' });
      expect(res.statusCode).toBe(400);
      expect(res.headers['Content-Type']).toBe('application/json');
    });

    it('body non JSON -> 400', async () => {
      const res = await handler({ path: '/searchQuote', body: '{bad', requestContext: { http: { method: 'POST' } } });
      expect(res.statusCode).toBe(400);
      expect(parse(res).message).toBe('Request body is not valid JSON');
    });

    it('WyzError -> status mappato con errorCode/contextCode/details', async () => {
      mockQuote.mockRejectedValue(new WyzError('invalid', 422, { errorCode: 'E', contextCode: 'C', details: [1] }));
      const res = await handler({ path: '/searchQuote' });
      expect(res.statusCode).toBe(422);
      expect(parse(res)).toEqual({ success: false, message: 'invalid', errorCode: 'E', contextCode: 'C', details: [1] });
    });

    it('WyzError semplice -> solo success/message', async () => {
      mockQuote.mockRejectedValue(new WyzError('bad', 400));
      const res = await handler({ path: '/searchQuote' });
      expect(parse(res)).toEqual({ success: false, message: 'bad' });
    });

    it('eccezione imprevista -> 500 generico senza dettagli', async () => {
      mockQuote.mockRejectedValue(new Error('secret internals'));
      const res = await handler({ path: '/searchQuote' });
      expect(res.statusCode).toBe(500);
      expect(parse(res)).toEqual({ success: false, message: 'Internal server error' });
    });

    it('eccezione imprevista senza stack usa il message', async () => {
      const e = new Error('x');
      e.stack = undefined;
      mockQuote.mockRejectedValue(e);
      expect((await handler({ path: '/searchQuote' })).statusCode).toBe(500);
    });
  });

  describe('CLI', () => {
    const originalArgv = process.argv;
    let exitSpy;

    beforeEach(() => {
      exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
      jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => { process.argv = originalArgv; });

    it('runAction legge il payload dal file ed esegue l\'azione', async () => {
      fs.readFileSync.mockReturnValue('{"customerRrdiCode":"C1","hubCode":"H1"}');
      mockFilters.mockResolvedValue({ filters: {} });

      await expect(runAction('getSearchFilters', 'p.json')).resolves.toEqual({ filters: {} });
      expect(mockFilters.mock.calls[0][0]).toEqual({ customerRrdiCode: 'C1', hubCode: 'H1' });
    });

    it('main esegue il comando valido', async () => {
      fs.readFileSync.mockReturnValue('{}');
      mockQuote.mockResolvedValue({ items: [] });
      process.argv = ['node', 'index.js', 'searchQuote', 'p.json'];
      await main();
      expect(mockQuote).toHaveBeenCalled();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('main esce con 1 se il comando non è valido', async () => {
      process.argv = ['node', 'index.js', 'nope'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('main esce con 1 se manca il file payload', async () => {
      process.argv = ['node', 'index.js', 'searchQuote'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('main esce con 1 se l\'azione fallisce', async () => {
      fs.readFileSync.mockReturnValue('{}');
      mockQuote.mockRejectedValue(new Error('fail'));
      process.argv = ['node', 'index.js', 'searchQuote', 'p.json'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
