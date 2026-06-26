'use strict';

jest.mock('axios');
jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('../src/agendaSOAClient');

const AgendaSOAClient = require('../src/agendaSOAClient');
const { buildClient } = require('../src/clientFactory');

describe('clientFactory (agendaSoa)', () => {
  afterEach(() => jest.clearAllMocks());

  test('buildClient returns an AgendaSOAClient instance', () => {
    const instance = buildClient();
    expect(AgendaSOAClient).toHaveBeenCalled();
    expect(instance).toBeInstanceOf(AgendaSOAClient);
  });

  test('buildClient passes env vars to AgendaSOAClient constructor', () => {
    process.env.AGENDA_SOA_HOST = 'http://host';
    process.env.AGENDA_SOA_USERNAME = 'user';
    process.env.AGENDA_SOA_PASSWORD = 'pass';
    process.env.AGENDA_SOA_API_KEY = 'apikey';
    process.env.AGENDA_SOA_PROXY = 'http://proxy';

    buildClient();

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

  test('buildClient applies overrides over env vars', () => {
    process.env.AGENDA_SOA_HOST = 'http://env-host';
    buildClient({ host: 'http://override-host' });
    expect(AgendaSOAClient).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'http://override-host' })
    );
    delete process.env.AGENDA_SOA_HOST;
  });
});
