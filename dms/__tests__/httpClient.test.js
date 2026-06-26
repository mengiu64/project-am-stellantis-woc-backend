'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest } = require('../httpClient');

function buildMockReq(onErrorCb = null) {
  return {
    on: jest.fn((event, cb) => {
      if (event === 'error' && onErrorCb) onErrorCb(cb);
    }),
    write: jest.fn(),
    end: jest.fn(),
  };
}

function buildMockRes(statusCode, chunks) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json' },
    on: jest.fn((event, cb) => {
      if (event === 'data') chunks.forEach((c) => cb(c));
      if (event === 'end') cb();
    }),
  };
}

describe('httpsRequest', () => {
  afterEach(() => jest.clearAllMocks());

  test('resolves with statusCode, headers and parsed JSON body', async () => {
    const data = JSON.stringify({ success: true });
    const mockRes = buildMockRes(200, [Buffer.from(data)]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ success: true });
    expect(result.headers).toEqual(mockRes.headers);
    expect(mockReq.end).toHaveBeenCalled();
  });

  test('resolves with raw string when body is not valid JSON', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('plain text response')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    expect(result.body).toBe('plain text response');
  });

  test('resolves with multiple chunks concatenated', async () => {
    const mockRes = buildMockRes(200, [
      Buffer.from('{"part":'),
      Buffer.from('"value"}'),
    ]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.body).toEqual({ part: 'value' });
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/post', method: 'POST' }, '{"key":"val"}');
    expect(mockReq.write).toHaveBeenCalledWith('{"key":"val"}');
  });

  test('does not write body when body is null', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({ hostname: 'test', path: '/get', method: 'GET' }, null);
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

    const promise = httpsRequest({ hostname: 'test', path: '/test', method: 'GET' });
    errorCb(new Error('connection refused'));
    await expect(promise).rejects.toThrow('connection refused');
  });

  test('handles 404 response correctly', async () => {
    const mockRes = buildMockRes(404, [Buffer.from(JSON.stringify({ message: 'not found' }))]);
    const mockReq = buildMockReq();
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.statusCode).toBe(404);
    expect(result.body).toEqual({ message: 'not found' });
  });
});
