'use strict';

jest.mock('../MenuPricingSoapClient', () => ({ MenuPricingSoapClient: jest.fn() }));
const { MenuPricingSoapClient } = require('../MenuPricingSoapClient');
const { handler } = require('../internal');
test.each(['getCompletePkMpList', 'getJobDetails'])('serves %s through the local SOAP client', async (operation) => {
  const fn = jest.fn().mockResolvedValue({ success: true, data: {} });
  MenuPricingSoapClient.mockImplementation(() => ({ [operation]: fn }));
  const response = await handler({
    path: `/internal/pkmenupricing/${operation}`, httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: '{"params":{"vin":"VIN"}}',
  });
  expect(JSON.parse(response.body).data).toEqual({ success: true, data: {} });
  expect(MenuPricingSoapClient).toHaveBeenCalledWith();
  expect(fn).toHaveBeenCalledWith({ vin: 'VIN' });
});
