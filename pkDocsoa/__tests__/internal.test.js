'use strict';

jest.mock('../DocSOARestClient', () => ({ DocSOARestClient: jest.fn() }));
const { DocSOARestClient } = require('../DocSOARestClient');
const { handler } = require('../internal');
test.each(['getCompletePkSOAList', 'ibxDetailForfaitService', 'ibxDetailtpService'])('serves %s without sharing upstream credentials', async (operation) => {
  const fn = jest.fn().mockResolvedValue({ success: true, data: [] });
  DocSOARestClient.mockImplementation(() => ({ [operation]: fn }));
  const response = await handler({
    path: `/internal/pkdocsoa/${operation}`, httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: '{"params":{"vin":"VIN"}}',
  });
  expect(JSON.parse(response.body).data).toEqual({ success: true, data: [] });
  expect(DocSOARestClient).toHaveBeenCalledWith();
  expect(fn).toHaveBeenCalledWith({ vin: 'VIN' });
});
