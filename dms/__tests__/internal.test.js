'use strict';

jest.mock('../authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../dmsService', () => ({
  getDmsSettings: jest.fn(), getCompanyTypes: jest.fn(), getCustomerTitles: jest.fn(),
  postDmsInquiry: jest.fn(), resolveDynamicSenderFields: jest.fn(),
}));
const { getBearerToken } = require('../authService');
const service = require('../dmsService');
const { handler } = require('../internal');
const request = (operation, payload) => ({
  path: `/internal/dms/${operation}`, httpMethod: 'POST',
  requestContext: { identity: { userArn: 'arn:aws:sts::123:assumed-role/caller/session' } },
  body: JSON.stringify(payload),
});
beforeEach(() => {
  jest.clearAllMocks();
  getBearerToken.mockResolvedValue('upstream-token');
});
test.each([
  ['settings', 'getDmsSettings'], ['company-types', 'getCompanyTypes'],
  ['customer-titles', 'getCustomerTitles'], ['inquiry', 'postDmsInquiry'],
])('%s owns upstream authentication', async (op, fn) => {
  service[fn].mockResolvedValue({ result: true });
  const response = await handler(request(op, { vin: 'VIN' }));
  expect(JSON.parse(response.body).data).toEqual({ result: true });
  expect(service[fn]).toHaveBeenCalledWith('upstream-token', { vin: 'VIN' });
});
test('resolves sender without acquiring upstream credentials', async () => {
  service.resolveDynamicSenderFields.mockResolvedValue({ mainSincom: '123' });
  expect(JSON.parse((await handler(request('resolveSender', {
    context: { username: 'user', vin: 'VIN' }, overrides: { market: 'fr' },
  }))).body).data).toEqual({ mainSincom: '123' });
  expect(service.resolveDynamicSenderFields).toHaveBeenCalledWith({ username: 'user', vin: 'VIN' }, { market: 'fr' });
  expect(getBearerToken).not.toHaveBeenCalled();
});
