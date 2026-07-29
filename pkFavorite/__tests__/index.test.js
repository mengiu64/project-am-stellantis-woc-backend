'use strict';

jest.mock('../db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../FavoriteRepository', () => ({
  listFavorites: jest.fn(),
  toggleFavorite: jest.fn(),
}));

const { getPool } = require('../db');
const { listFavorites, toggleFavorite } = require('../FavoriteRepository');
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

  it('GET: lists favorites for username (from authorizer) + vin (from query)', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT-A', createdAt: '2026-01-01T09:00:00Z' }]);
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
    expect(res.statusCode).toBe(200);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(true);
    expect(parsed.username).toBe('0062230.d001');
    expect(parsed.vin).toBe('VF3CABHW6GT204366');
    expect(parsed.favorites).toHaveLength(1);
  });

  it('POST: returns 400 when vin or packageCode is missing', async () => {
    const event = apiGwEvent({
      method: 'POST',
      authorizerSub: '0062230.d001',
      body: { vin: 'VF3CABHW6GT204366' },
    });
    const res = await handler(event);
    expect(res.statusCode).toBe(400);
    expect(toggleFavorite).not.toHaveBeenCalled();
  });

  it('POST: toggles favorite using username (authorizer) + vin/packageCode (body)', async () => {
    toggleFavorite.mockResolvedValue({ action: 'added', packageCode: 'FORFAIT-A', id: 1, createdAt: 'now' });
    const event = apiGwEvent({
      method: 'POST',
      authorizerSub: '0062230.d001',
      body: { vin: 'VF3CABHW6GT204366', packageCode: 'FORFAIT-A' },
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
      action: 'added',
      packageCode: 'FORFAIT-A',
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
