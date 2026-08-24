'use strict';

jest.mock('dotenv', () => ({ config: jest.fn() }));
jest.mock('axios');
jest.mock('../certService');
// Factory espliciti (invece del semplice jest.mock('../db')) per evitare che
// jest carichi il modulo reale ../config, che richiede DOCSOA_DB_HOST a
// require-time (env non impostata in questo file di test).
jest.mock('../db', () => ({ getPool: jest.fn() }));
jest.mock('../ListFunctionsRepository', () => ({ listFunctions: jest.fn() }));

process.env.DOCSOA_HOST = 'https://api.test.com';
process.env.DOCSOA_USERNAME = 'user';
process.env.DOCSOA_PASSWORD = 'pass';
process.env.DOCSOA_IBM_CLIENT_ID = 'ibm-client-id';
process.env.DOCSOA_IBM_CLIENT_SECRET = 'ibm-client-secret';

const { getPool } = require('../db');
const { listFunctions } = require('../ListFunctionsRepository');
const { DocSOARestClient } = require('../DocSOARestClient');

describe('DocSOARestClient.functionServiceDb', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new DocSOARestClient();
  });

  test('returns the same output shape as functionsService, sourced from woc.listfunctions', async () => {
    const fakePool = { query: jest.fn() };
    getPool.mockResolvedValue(fakePool);
    listFunctions.mockResolvedValue([{ function: 'FCT0040' }, { function: 'FCT0050' }]);

    const result = await client.functionServiceDb();

    expect(getPool).toHaveBeenCalledTimes(1);
    expect(listFunctions).toHaveBeenCalledWith(fakePool);
    expect(result).toEqual({
      success: true,
      data: [
        { ordreAffichage: 1, idFunction: 'FCT0040', IdFunctionPath: 'FCT0040', Label: 'FCT0040', image: '', listFunctions: '' },
        { ordreAffichage: 2, idFunction: 'FCT0050', IdFunctionPath: 'FCT0050', Label: 'FCT0050', image: '', listFunctions: '' },
      ],
    });
  });

  test('returns an empty data array when the table has no rows', async () => {
    getPool.mockResolvedValue({});
    listFunctions.mockResolvedValue([]);

    const result = await client.functionServiceDb();

    expect(result).toEqual({ success: true, data: [] });
  });

  test('returns success:false with the error message when the DB call fails', async () => {
    getPool.mockRejectedValue(new Error('connection refused'));

    const result = await client.functionServiceDb();

    expect(result).toEqual({ success: false, data: null, message: 'connection refused' });
  });

  test('does not remove functionsService (both methods coexist)', () => {
    expect(typeof client.functionsService).toBe('function');
    expect(typeof client.functionServiceDb).toBe('function');
  });
});
