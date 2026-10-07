'use strict';

jest.mock('../v360Service', () => ({ getCachedBrand: jest.fn() }));
jest.mock('../s3ConfigRepository', () => ({ S3ConfigRepository: jest.fn() }));
const { getCachedBrand } = require('../v360Service');
const { S3ConfigRepository } = require('../s3ConfigRepository');
const getBrandOwners = jest.fn().mockResolvedValue([{ codbrand: 'FT', owner: 'XF' }]);
S3ConfigRepository.mockImplementation(() => ({ getBrandOwners }));
const { handler } = require('../internal');
const event = (operation, args = []) => ({
  path: `/internal/v360/${operation}`, httpMethod: 'POST',
  requestContext: { identity: { userArn: 'role' } }, body: JSON.stringify({ args }),
});
test('brand resolution remains cached in v360', async () => {
  getCachedBrand.mockResolvedValue('FT');
  expect(JSON.parse((await handler(event('getBrand', ['VIN']))).body).data).toBe('FT');
  expect(getCachedBrand).toHaveBeenCalledWith('VIN');
});
test('reference-data cache remains in v360', async () => {
  expect(JSON.parse((await handler(event('getBrandOwners'))).body).data).toEqual([{ codbrand: 'FT', owner: 'XF' }]);
  expect(getBrandOwners).toHaveBeenCalled();
});
