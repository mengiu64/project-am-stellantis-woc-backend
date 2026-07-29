'use strict';

jest.mock('../db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../FavoriteRepository', () => ({
  listFavorites: jest.fn(),
  toggleFavorite: jest.fn(),
}));
jest.mock('../../dms/authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/dmsService', () => ({ postDmsInquiry: jest.fn() }));

const { getPool } = require('../db');
const { listFavorites, toggleFavorite } = require('../FavoriteRepository');
const { getBearerToken } = require('../../dms/authService');
const { postDmsInquiry } = require('../../dms/dmsService');
const { handler } = require('../index');

const FAKE_POOL = { query: jest.fn() };

function apiGwEvent({ method, authorizerSub, query, body }) {
  return {
    httpMethod: method,
    requestContext: { authorizer: authorizerSub ? { sub: authorizerSub } : {} },
    queryStringParameters: query || null,
    body: body ? JSON.stringify(body) : null,
  };
}

describe('pkfavorite index.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockResolvedValue(FAKE_POOL);
  });

  it('returns 401 when authorizer.sub is missing (requestContext present)', async () => {
    const event = apiGwEvent({ method: 'GET', query: { vin: 'VF3CABHW6GT204366' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(listFavorites).not.toHaveBeenCalled();
  });

  it('GET: returns 400 when vin is missing', async () => {
    const event = apiGwEvent({ method: 'GET', authorizerSub: '0062230.d001' });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).message).toMatch(/vin/);
  });

  it('GET: lists favorites for username (from authorizer) + vin (from query), enriched via DML (LFP)', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({
      UpSelling: {
        Packages: [
          {
            Code: '42001AER01FR0201',
            PackageDescription: 'FORFAIT VIDANGE INEO 5W30 5L MAX',
            PartsAvailablity: true,
            TotalPriceInclTax: 74,
            TotalPriceExclTax: 59.2,
            PartsItem: [{ PartNumber: '1109AY' }], // campo extra DML, non deve finire nella risposta
          },
        ],
      },
    });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const res = await handler(event);

    expect(listFavorites).toHaveBeenCalledWith(FAKE_POOL, {
      username: '0062230.d001',
      vin: 'VF3CABHW6GT204366',
    });
    expect(getBearerToken).toHaveBeenCalledTimes(1);
    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', {
      PartsInquiryHeader: { MessageType: 'LFP', VehicleID: 'VF3CABHW6GT204366' },
      package: 'FORFAIT',
    });
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed).toEqual({
      success: true,
      username: '0062230.d001',
      vin: 'VF3CABHW6GT204366',
      favorites: [{
        Code: '42001AER01FR0201',
        PackageDescription: 'FORFAIT VIDANGE INEO 5W30 5L MAX',
        PartsAvailablity: true,
        TotalPriceInclTax: 74,
        TotalPriceExclTax: 59.2,
      }],
    });
  });

  it('GET: does one DML call per codice pacchetto preferito and combines (flatten) i risultati', async () => {
    listFavorites.mockResolvedValue([
      { packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' },
      { packageCode: 'TAGLIANDO', createdAt: '2026-01-02T09:00:00Z' },
    ]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry
      .mockResolvedValueOnce({ UpSelling: { Packages: [{ Code: 'A1', PackageDescription: 'Pkg A1', PartsAvailablity: true, TotalPriceInclTax: 10, TotalPriceExclTax: 8 }] } })
      .mockResolvedValueOnce({ UpSelling: { Packages: [{ Code: 'B1', PackageDescription: 'Pkg B1', PartsAvailablity: false, TotalPriceInclTax: 20, TotalPriceExclTax: 16 }] } });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const res = await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledTimes(2);
    const parsed = JSON.parse(res.body);
    expect(parsed.favorites).toEqual([
      { Code: 'A1', PackageDescription: 'Pkg A1', PartsAvailablity: true, TotalPriceInclTax: 10, TotalPriceExclTax: 8 },
      { Code: 'B1', PackageDescription: 'Pkg B1', PartsAvailablity: false, TotalPriceInclTax: 20, TotalPriceExclTax: 16 },
    ]);
  });

  it('GET: with no favorites, returns an empty list without calling the DML gateway', async () => {
    listFavorites.mockResolvedValue([]);
    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const res = await handler(event);

    expect(getBearerToken).not.toHaveBeenCalled();
    expect(postDmsInquiry).not.toHaveBeenCalled();
    const parsed = JSON.parse(res.body);
    expect(parsed.favorites).toEqual([]);
  });

  it('GET: maps DML gateway errors to 502', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockRejectedValue(new Error('[dms] inquiry failed: HTTP 500 - ...'));

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const res = await handler(event);

    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).success).toBe(false);
  });

  it('POST: returns 400 when vin or package is missing', async () => {
    const event = apiGwEvent({
      method: 'POST',
      authorizerSub: '0062230.d001',
      body: { vin: 'VF3CABHW6GT204366' },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(toggleFavorite).not.toHaveBeenCalled();
  });

  it('POST: toggles favorite using username (authorizer) + vin/package (body)', async () => {
    toggleFavorite.mockResolvedValue({ action: 'added', packageCode: 'FORFAIT-A', id: 1, createdAt: 'now' });
    const event = apiGwEvent({
      method: 'POST',
      authorizerSub: '0062230.d001',
      body: { vin: 'VF3CABHW6GT204366', package: 'FORFAIT-A' },
    });

    const res = await handler(event);

    expect(toggleFavorite).toHaveBeenCalledWith(FAKE_POOL, {
      username: '0062230.d001',
      vin: 'VF3CABHW6GT204366',
      packageCode: 'FORFAIT-A',
    });
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({
      success: true,
      username: '0062230.d001',
      vin: 'VF3CABHW6GT204366',
      package: 'FORFAIT-A',
      action: 'added',
      id: 1,
      createdAt: 'now',
    });
  });

  it('falls back to body.username when the event has no requestContext.authorizer (direct invoke/CLI)', async () => {
    listFavorites.mockResolvedValue([]);
    const event = {
      method: 'GET',
      body: JSON.stringify({ username: 'cli-user', vin: 'VF3CABHW6GT204366' }),
    };

    const res = await handler(event);

    expect(listFavorites).toHaveBeenCalledWith(FAKE_POOL, { username: 'cli-user', vin: 'VF3CABHW6GT204366' });
    expect(res.statusCode).toBe(200);
  });

  it('returns 405 for unsupported methods', async () => {
    const event = apiGwEvent({ method: 'DELETE', authorizerSub: '0062230.d001', query: { vin: 'x' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(405);
  });

  it('maps repository "is required" errors to 400', async () => {
    listFavorites.mockRejectedValue(new Error('"vin" is required'));
    const event = apiGwEvent({ method: 'GET', authorizerSub: '0062230.d001', query: { vin: 'x' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
  });

  it('maps unexpected/downstream errors to 502', async () => {
    listFavorites.mockRejectedValue(new Error('connection timeout'));
    const event = apiGwEvent({ method: 'GET', authorizerSub: '0062230.d001', query: { vin: 'x' } });
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
  });
});
