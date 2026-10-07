'use strict';

jest.mock('../db', () => ({ getPool: jest.fn() }));
jest.mock('../HqRepository');
jest.mock('../AnagSnowflakesRepository');
jest.mock('../PkConfigRepository');
jest.mock('../ConfigPackagesRepository');

const { getPool } = require('../db');
const hq = require('../HqRepository');
const snowflakes = require('../AnagSnowflakesRepository');
const pk = require('../PkConfigRepository');
const config = require('../ConfigPackagesRepository');
const { handler } = require('../internal');
const pool = { query: jest.fn() };
const request = (operation, args = []) => ({
  path: `/internal/dbmanager/${operation}`, httpMethod: 'POST',
  requestContext: { identity: { userArn: 'arn:aws:sts::123:assumed-role/hq/session' } },
  body: JSON.stringify({ args }),
});
const data = async (operation, args) => JSON.parse((await handler(request(operation, args))).body).data;

beforeEach(() => {
  jest.clearAllMocks();
  getPool.mockResolvedValue(pool);
});
test.each([
  ...Object.keys(hq).filter((name) => !['getAnagSection', 'getAnagAllocation'].includes(name)),
  'getCountryIsoCode', 'getPhysicalSiteAndSincom', 'getPhysicalSiteAndPdvId', 'getBrandsByOics', 'getMarkets',
  'getPkwstouse', 'getConfigPackages',
])('dispatches %s locally with the owning DB pool', async (operation) => {
  const fn = hq[operation] || snowflakes[operation] || pk[operation] || config[operation];
  fn.mockResolvedValue({ result: operation });
  expect(await data(operation, ['arg'])).toEqual({ result: operation });
  expect(fn).toHaveBeenCalledWith(pool, 'arg');
});
test.each(['getAnagSection', 'getAnagAllocation'])('dispatches S3 reference %s without a pool', async (op) => {
  hq[op].mockResolvedValue([]);
  expect(await data(op)).toEqual([]);
  expect(getPool).not.toHaveBeenCalled();
});
test('serializes native Set and Map as wire arrays', async () => {
  hq.getDisabledOics.mockResolvedValue(new Set(['fr|A']));
  hq.getAddressByOics.mockResolvedValue(new Map([['A', { city: 'Paris' }]]));
  expect(await data('getDisabledOics', [[{ market: 'fr', oic: 'A' }]])).toEqual(['fr|A']);
  expect(await data('getAddressByOics', [['A']])).toEqual([['A', { city: 'Paris' }]]);
});
test('brand logo lookup uses a parameterized query and omits empty paths', async () => {
  pool.query.mockResolvedValue({ rows: [
    { codbrand: 'FT', logo_s3_key: 'logos/ft.png' },
    { codbrand: 'AC', logo_s3_key: '' }, { codbrand: 'AP', logo_s3_key: ' ' },
  ] });
  expect(await data('getBrandLogos', [{ codes: ['FT', 'AC', 'AP'] }])).toEqual({ FT: 'logos/ft.png' });
  expect(pool.query).toHaveBeenCalledWith(expect.objectContaining({ values: [['FT', 'AC', 'AP']] }));
});
test('empty logo batch does not open a pool', async () => {
  expect(await data('getBrandLogos', [{ codes: [] }])).toEqual({});
  expect(getPool).not.toHaveBeenCalled();
});
test('rejects invalid args/codes and does not expose repository utilities', async () => {
  const warn = jest.spyOn(console, 'error').mockImplementation(() => {});
  expect((await handler(request('getBrandLogos', [{ codes: null }]))).statusCode).toBe(400);
  expect((await handler(request('getBrandLogos', []))).statusCode).toBe(400);
  expect((await handler({ ...request('getPkwstouse'), body: '{}' })).statusCode).toBe(400);
  expect((await handler(request('resolveArcadBrandCode', ['FT']))).statusCode).toBe(404);
  warn.mockRestore();
});
