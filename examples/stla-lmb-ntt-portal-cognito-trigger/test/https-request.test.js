const https = require('https');
const { makeHttpsRequest } = require('../src/https-request.js');

jest.mock('https');

describe('makeHttpsRequest', () => {
  const url = 'https://example.com/api';
  const pfxBuffer = Buffer.from('dummy-cert');
  const passphrase = 'pass123';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return parsed JSON from response', async () => {
    const mockResponseData = { Response: { User: { username: 'jdoe' } } };
    const onDataCallbacks = [];
    const onEndCallbacks = [];

    const mockRes = {
      on: (event, cb) => {
        if (event === 'data') {
          onDataCallbacks.push(cb);
        }
        if (event === 'end') {
          onEndCallbacks.push(cb);
        }
      }
    };

    const mockGet = jest.fn((urlArg, options, callback) => {
      callback(mockRes);
      return { on: jest.fn() }; // for .on('error')
    });

    https.get.mockImplementation(mockGet);

    const promise = makeHttpsRequest(url, pfxBuffer, passphrase);

    // Simulate data events
    onDataCallbacks.forEach(cb => cb(JSON.stringify(mockResponseData)));
    // Simulate end
    onEndCallbacks.forEach(cb => cb());

    const result = await promise;

    expect(result).toEqual(mockResponseData);
    expect(mockGet).toHaveBeenCalledWith(url, expect.objectContaining({ agent: expect.any(Object) }), expect.any(Function));
  });

  it('should reject promise on https error', async () => {
    const error = new Error('Network error');

    const mockGet = jest.fn(() => ({ on: (event, cb) => {
      if (event==='error') {
        cb(error);
      } 
    } }));
    https.get.mockImplementation(mockGet);

    await expect(makeHttpsRequest(url, pfxBuffer, passphrase)).rejects.toThrow('Network error');
  });

  it('should create agent with pfx and passphrase', async () => {
    const mockResponseData = { ok: true };
    const mockRes = {
      on: (event, cb) => {
        if (event==='data') {
          cb(JSON.stringify(mockResponseData));
        } if (event==='end') {
          cb();
        } 
      }
    };

    https.get.mockImplementation((urlArg, options, callback) => {
      callback(mockRes);
      expect(options.agent.options.pfx).toBe(pfxBuffer);
      expect(options.agent.options.passphrase).toBe(passphrase);
      return { on: jest.fn() };
    });

    const result = await makeHttpsRequest(url, pfxBuffer, passphrase);
    expect(result).toEqual(mockResponseData);
  });
});