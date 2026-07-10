'use strict';

jest.mock('axios');
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/certService', () => ({
  getHttpsAgent: jest.fn(),
}));

const axios = require('axios');
const { getHttpsAgent } = require('../src/certService');
const { buildClient } = require('../src/clientFactory');

describe('clientFactory', () => {
  let mockHttp;

  beforeEach(() => {
    mockHttp = {
      post: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    axios.create.mockReturnValue(mockHttp);
    getHttpsAgent.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  test('buildClient creates an AgendaNagaClient using env vars', async () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    process.env.AGENDA_SOA_USERNAME = 'env-user';
    process.env.AGENDA_SOA_PASSWORD = 'env-pass';
    process.env.AGENDA_SOA_API_KEY = 'env-key';

    const client = await buildClient();

    expect(client.host).toBe('http://env-host');
    expect(client.username).toBe('env-user');
    expect(client.password).toBe('env-pass');
    expect(client.apiKey).toBe('env-key');

    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
    delete process.env.AGENDA_SOA_PASSWORD;
    delete process.env.AGENDA_SOA_API_KEY;
  });

  test('buildClient applies overrides over env vars', async () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    process.env.AGENDA_SOA_USERNAME = 'env-user';

    const client = await buildClient({ host: 'http://override-host', username: 'override-user' });

    expect(client.host).toBe('http://override-host');
    expect(client.username).toBe('override-user');

    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
  });

  test('buildClient returns an object with createnaga and updatenaga methods', async () => {
    const client = await buildClient({ host: 'http://test', username: 'u', password: 'p' });
    expect(typeof client.createnaga).toBe('function');
    expect(typeof client.updatenaga).toBe('function');
  });

  test('buildClient uses the httpsAgent from certService when no override is provided', async () => {
    const fakeAgent = { fake: true };
    getHttpsAgent.mockResolvedValue(fakeAgent);

    await buildClient({ host: 'http://test' });

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: fakeAgent })
    );
  });

  test('buildClient lets an explicit httpsAgent override win over certService', async () => {
    const fakeAgent = { fromCertService: true };
    const overrideAgent = { fromOverride: true };
    getHttpsAgent.mockResolvedValue(fakeAgent);

    await buildClient({ host: 'http://test', httpsAgent: overrideAgent });

    expect(axios.create).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: overrideAgent })
    );
  });
});
