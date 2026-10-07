'use strict';

jest.mock('../src/handlers/updatenaga', () => ({ handler: jest.fn() }));
jest.mock('../src/handlers/createnaga', () => ({ handler: jest.fn() }));
const update = require('../src/handlers/updatenaga').handler;
const create = require('../src/handlers/createnaga').handler;
const { handler } = require('../internal');
const event = {
  path: '/internal/agendasoanaga/updatenaga', httpMethod: 'POST',
  requestContext: { identity: { userArn: 'role' } },
  body: JSON.stringify({ apptId: '123', rdvBrand: 'FT' }),
};
test('forwards appointment ID and unwraps upstream handler response', async () => {
  update.mockResolvedValue({ statusCode: 200, body: '{"success":true}' });
  expect(JSON.parse((await handler(event)).body).data).toEqual({ success: true });
  expect(update).toHaveBeenCalledWith({ pathParameters: { apptId: '123' }, body: '{"apptId":"123","rdvBrand":"FT"}' });
});
test('supports creation when jobcard has no appointment id', async () => {
  create.mockResolvedValue({ statusCode: 200, body: '{"success":true,"data":{"rdvId":"NEW"}}' });
  const result = await handler({ ...event, path: '/internal/agendasoanaga/createnaga', body: '{"rdvBrand":"FT"}' });
  expect(JSON.parse(result.body).data).toEqual({ success: true, data: { rdvId: 'NEW' } });
  expect(create).toHaveBeenCalledWith({ body: '{"rdvBrand":"FT"}' });
});
test.each([
  [{ statusCode: 502, body: '{"message":"failure"}' }, 'failure'],
  [{ statusCode: 400, body: { error: 'invalid' } }, 'invalid'],
  [{ statusCode: 500, body: {} }, 'Operazione NAGA fallita'],
])('propagates failed updates', async (response, message) => {
  const log = jest.spyOn(console, 'error').mockImplementation(() => {});
  update.mockResolvedValue(response);
  const result = await handler(event);
  expect(result.statusCode).toBe(response.statusCode);
  expect(JSON.parse(result.body).message).toBe(message);
  log.mockRestore();
});
