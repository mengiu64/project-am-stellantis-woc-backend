'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest } = require('../httpClient');

describe('httpsRequest (jobcard)', () => {
  afterEach(() => jest.clearAllMocks());

  function buildMockRes(statusCode, chunks) {
    return {
      statusCode,
      headers: {},
      on: jest.fn((event, cb) => {
        if (event === 'data') chunks.forEach((c) => cb(c));
        if (event === 'end') cb();
      }),
    };
  }

  test('resolves with parsed JSON body and statusCode', async () => {
    const data = JSON.stringify({ jobCards: [] });
    const mockRes = buildMockRes(200, [Buffer.from(data)]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/jobCardList', method: 'GET' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ jobCards: [] });
  });

  test('resolves with raw string for non-JSON body', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('not json')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.body).toBe('not json');
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ method: 'POST' }, 'body-content');
    expect(mockReq.write).toHaveBeenCalledWith('body-content');
  });

  test('does not write body when body is null', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({}, null);
    expect(mockReq.write).not.toHaveBeenCalled();
  });

  test('rejects on request error', async () => {
    let errorCb;
    const mockReq = {
      on: jest.fn((event, cb) => { if (event === 'error') errorCb = cb; }),
      write: jest.fn(),
      end: jest.fn(),
    };
    https.request.mockImplementation(() => mockReq);

    const promise = httpsRequest({});
    errorCb(new Error('ECONNREFUSED'));
    await expect(promise).rejects.toThrow('ECONNREFUSED');
  });

  test('calls req.end() after setup', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({});
    expect(mockReq.end).toHaveBeenCalled();
  });
});
