'use strict';

jest.mock('axios');
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/agendaSOAClient');
jest.mock('../src/certService', () => ({
  getHttpsAgent: jest.fn(),
}));

const AgendaSOAClient = require('../src/agendaSOAClient');
const { getHttpsAgent } = require('../src/certService');
const { buildClient } = require('../src/clientFactory');

describe('clientFactory (agendaSoa)', () => {
  beforeEach(() => {
    getHttpsAgent.mockResolvedValue(undefined);
  });

  afterEach(() => jest.clearAllMocks());

  test('buildClient returns an AgendaSOAClient instance', async () => {
    const instance = await buildClient();
    expect(AgendaSOAClient).toHaveBeenCalled();
    expect(instance).toBeInstanceOf(AgendaSOAClient);
  });

  test('buildClient passes env vars to AgendaSOAClient constructor', async () => {
    process.env.AGENDA_SOA_HOST = 'http://host';
    process.env.AGENDA_SOA_USERNAME = 'user';
    process.env.AGENDA_SOA_PASSWORD = 'pass';
    process.env.AGENDA_SOA_API_KEY = 'apikey';
    process.env.AGENDA_SOA_PROXY = 'http://proxy';

    await buildClient();

    expect(AgendaSOAClient).toHaveBeenCalledWith(
      expect.objectContaining({
        host: 'http://host',
        username: 'user',
        password: 'pass',
        apiKey: 'apikey',
        proxy: 'http://proxy',
      })
    );

    delete process.env.AGENDA_SOA_HOST;
    delete process.env.AGENDA_SOA_USERNAME;
    delete process.env.AGENDA_SOA_PASSWORD;
    delete process.env.AGENDA_SOA_API_KEY;
    delete process.env.AGENDA_SOA_PROXY;
  });

  test('buildClient applies overrides over env vars', async () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    await buildClient({ host: 'http://override-host' });
    expect(AgendaSOAClient).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'http://override-host' })
    );
    delete process.env.AGENDA_SOA_HOST;
  });

  test('buildClient uses the httpsAgent from certService when no override is provided', async () => {
    const fakeAgent = { fake: true };
    getHttpsAgent.mockResolvedValue(fakeAgent);

    await buildClient();

    expect(AgendaSOAClient).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: fakeAgent })
    );
  });

  test('buildClient lets an explicit httpsAgent override win over certService', async () => {
    const fakeAgent = { fromCertService: true };
    const overrideAgent = { fromOverride: true };
    getHttpsAgent.mockResolvedValue(fakeAgent);

    await buildClient({ httpsAgent: overrideAgent });

    expect(AgendaSOAClient).toHaveBeenCalledWith(
      expect.objectContaining({ httpsAgent: overrideAgent })
    );
  });
});
