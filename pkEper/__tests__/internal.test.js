'use strict';

jest.mock('../WsIQPckEper', () => ({ WsIQPckEper: jest.fn() }));
const { WsIQPckEper } = require('../WsIQPckEper');
const { handler } = require('../internal');
test.each(['getCompletePkEperList', 'getPackageDetailsPR'])('serves %s through the local EPER client', async (operation) => {
  const fn = jest.fn().mockResolvedValue({ result: operation });
  WsIQPckEper.mockImplementation(() => ({ [operation]: fn }));
  const payload = { params: { vin: 'VIN' }, config: { coddealer: '123', codmarket: '1000' } };
  const response = await handler({
    path: `/internal/pkeper/${operation}`, httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: JSON.stringify(payload),
  });
  expect(JSON.parse(response.body).data).toEqual({ result: operation });
  expect(WsIQPckEper).toHaveBeenCalledWith(payload.config);
  expect(fn).toHaveBeenCalledWith(payload.params);
});
test('omitted dealer config uses the owning service defaults', async () => {
  WsIQPckEper.mockImplementation(() => ({ getCompletePkEperList: async () => ({}) }));
  await handler({
    path: '/internal/pkeper/getCompletePkEperList', httpMethod: 'POST',
    requestContext: { identity: { userArn: 'role' } }, body: '{"params":{"vin":"VIN"}}',
  });
  expect(WsIQPckEper).toHaveBeenLastCalledWith({ coddealer: undefined, codmarket: undefined });
});
