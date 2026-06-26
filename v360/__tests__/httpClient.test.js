'use strict';

jest.mock('https');

const https = require('https');
const { httpsRequest } = require('../httpClient');

describe('httpsRequest (v360)', () => {
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

  test('resolves with parsed JSON body', async () => {
    const data = JSON.stringify({ vin: 'VIN123', compatible: true });
    const mockRes = buildMockRes(200, [Buffer.from(data)]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({ hostname: 'api.test', path: '/otaCompatibility', method: 'POST' });
    expect(result.statusCode).toBe(200);
    expect(result.body).toEqual({ vin: 'VIN123', compatible: true });
  });

  test('resolves with raw string for non-JSON body', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('plain response')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const result = await httpsRequest({});
    expect(result.body).toBe('plain response');
  });

  test('writes body when provided', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    const bodyStr = JSON.stringify({ vin: 'VIN1' });
    await httpsRequest({ method: 'POST' }, bodyStr);
    expect(mockReq.write).toHaveBeenCalledWith(bodyStr);
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
    errorCb(new Error('TLS handshake failed'));
    await expect(promise).rejects.toThrow('TLS handshake failed');
  });

  test('calls req.end()', async () => {
    const mockRes = buildMockRes(200, [Buffer.from('{}')]);
    const mockReq = { on: jest.fn(), write: jest.fn(), end: jest.fn() };
    https.request.mockImplementation((opts, cb) => { cb(mockRes); return mockReq; });

    await httpsRequest({});
    expect(mockReq.end).toHaveBeenCalled();
  });
});
