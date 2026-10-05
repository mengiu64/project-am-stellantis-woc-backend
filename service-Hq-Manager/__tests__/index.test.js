'use strict';

// Mock del pool DB
const mockQuery = jest.fn();
jest.mock('../shared/dbClient', () => ({ getPool: jest.fn(async () => ({ query: mockQuery })) }));
const { getPool } = require('../shared/dbClient');
const { handler } = require('../index');

// Utility: costruisce un evento proxy
const ev = (method, path, { body, query, raw } = {}) => ({
  httpMethod: method, path, queryStringParameters: query || null,
  body: raw !== undefined ? raw : (body === undefined ? null : JSON.stringify(body)),
  requestContext: { authorizer: { sub: 'u1' } },
});
// Utility: invoca handler e parsa la risposta
const call = async (e) => { const r = await handler(e, { awsRequestId: 'rid' }); return { status: r.statusCode, body: JSON.parse(r.body) }; };

beforeEach(() => { mockQuery.mockReset(); jest.spyOn(console, 'log').mockImplementation(() => {}); });
afterEach(() => jest.restoreAllMocks());

describe('routing e errori generici', () => {
  test('risorsa sconosciuta -> 404', async () => { expect((await call(ev('GET', '/api/foo'))).status).toBe(404); });
  test('evento vuoto -> 404 e context assente', async () => {
    const r = await handler(undefined, undefined); expect(r.statusCode).toBe(404);
  });
  test('metodo non supportato -> 405', async () => { expect((await call(ev('PATCH', '/api/customer-options'))).status).toBe(405); });
  test('POST senza body -> 400', async () => { expect((await call(ev('POST', '/api/customer-options/A1'))).status).toBe(400); });
  test('body JSON malformato -> 400', async () => { expect((await call(ev('POST', '/api/customer-options/A1', { raw: '{x' }))).status).toBe(400); });
  test('body array -> 400', async () => { expect((await call(ev('POST', '/api/customer-options/A1', { body: [] }))).status).toBe(400); });
  test('body base64 e già oggetto', async () => {
    mockQuery.mockResolvedValue({ rows: [{ oic_code: 'A1' }] });
    const e = ev('POST', '/api/customer-options/A1', { raw: Buffer.from('{"customer_waiting_on_site":true}').toString('base64') });
    e.isBase64Encoded = true;
    expect((await call(e)).status).toBe(201);
    const e2 = ev('POST', '/api/customer-options/A1'); e2.body = { cleaning_approval_internal: true };
    expect((await call(e2)).status).toBe(201);
  });
  test('HTTP API v2 e stage nel path', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const r = await call({ rawPath: '/dev/api/customer-options', requestContext: { http: { method: 'get' } } });
    expect(r.status).toBe(200);
  });
  test('errore DB generico -> 500 senza dettagli', async () => {
    mockQuery.mockRejectedValue(new Error('boom'));
    const r = await call(ev('GET', '/api/customer-options'));
    expect(r.status).toBe(500); expect(r.body.message).not.toMatch(/boom/);
  });
  test('errore connessione -> 500', async () => {
    getPool.mockRejectedValueOnce(new Error('conn'));
    expect((await call(ev('GET', '/api/customer-options'))).status).toBe(500);
  });
  test('errore non Error -> 500', async () => {
    mockQuery.mockRejectedValue(null);
    expect((await call(ev('GET', '/api/customer-options'))).status).toBe(500);
  });
});

describe('customer_options', () => {
  test('GET lista', async () => {
    mockQuery.mockResolvedValue({ rows: [{ oic_code: 'A' }] });
    const r = await call(ev('GET', '/api/customer-options', { query: { limit: '5', offset: '1' } }));
    expect(r.body.data).toHaveLength(1); expect(mockQuery.mock.calls[0][1]).toEqual([5, 1]);
  });
  test('GET singolo / 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oic_code: 'A' }] });
    expect((await call(ev('GET', '/api/customer-options/A'))).status).toBe(200);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await call(ev('GET', '/api/customer-options', { query: { oic_code: 'Z' } }))).status).toBe(404);
  });
  test('POST con chiave nel body, 201 e 409', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oic_code: 'A' }] });
    expect((await call(ev('POST', '/api/customer-options', { body: { oic_code: 'A', cleaning_approval_external: true } }))).status).toBe(201);
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    expect((await call(ev('POST', '/api/customer-options/A', { body: {} }))).status).toBe(409);
  });
  test('POST chiave mancante -> 400; boolean non valido -> 422', async () => {
    expect((await call(ev('POST', '/api/customer-options', { body: {} }))).status).toBe(400);
    expect((await call(ev('POST', '/api/customer-options/A', { body: { customer_waiting_on_site: 'si' } }))).status).toBe(422);
  });
  test('PUT ok / 404 / nessun campo', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ oic_code: 'A' }] });
    expect((await call(ev('PUT', '/api/customer-options/A', { body: { customer_waiting_on_site: true } }))).status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/SET customer_waiting_on_site = \$2/);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await call(ev('PUT', '/api/customer-options/A', { body: { customer_waiting_on_site: true } }))).status).toBe(404);
    expect((await call(ev('PUT', '/api/customer-options/A', { body: {} }))).status).toBe(400);
  });
  test('DELETE ok / 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect((await call(ev('DELETE', '/api/customer-options/A'))).status).toBe(200);
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect((await call(ev('DELETE', '/api/customer-options/A'))).status).toBe(404);
  });
  test('chiave troppo lunga -> 400', async () => {
    expect((await call(ev('GET', `/api/customer-options/${'x'.repeat(21)}`))).status).toBe(400);
  });
});

describe('hq_settings_email', () => {
  const P = '/api/hq-settings-email';
  test('GET lista con filtri e senza', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect((await call(ev('GET', P, { query: { market: '1000', dealership_code: 'D', oic_code: 'O' } }))).status).toBe(200);
    expect(mockQuery.mock.calls[0][0]).toMatch(/WHERE market = \$1 AND dealership_code = \$2 AND oic_code = \$3/);
    expect((await call(ev('GET', P))).status).toBe(200);
    expect(mockQuery.mock.calls[1][0]).not.toMatch(/WHERE/);
  });
  test('GET singolo da path / 404', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] });
    expect((await call(ev('GET', `${P}/1000/D1/O1`))).status).toBe(200);
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await call(ev('GET', `${P}/1000/D1/O1`))).status).toBe(404);
  });
  test('chiave incompleta -> 400', async () => {
    expect((await call(ev('GET', `${P}/1000/D1`))).status).toBe(400);
    expect((await call(ev('DELETE', P))).status).toBe(400);
  });
  test('POST ok (chiave nel body), 409, email non valida', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] });
    const b = { market: '1000', dealership_code: 'D', oic_code: 'O', signature_email: 'a@b.it', dpo_email: null };
    expect((await call(ev('POST', P, { body: b }))).status).toBe(201);
    mockQuery.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }));
    expect((await call(ev('POST', P, { body: b }))).status).toBe(409);
    expect((await call(ev('POST', P, { body: { ...b, dpo_email: 'bad' } }))).status).toBe(422);
    expect((await call(ev('POST', P, { body: { ...b, dpo_email: 5 } }))).status).toBe(422);
  });
  test('PUT ok / 404 / vuoto; email vuota -> null', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ id: '1' }] });
    expect((await call(ev('PUT', `${P}/1000/D/O`, { body: { signature_email: '' } }))).status).toBe(200);
    expect(mockQuery.mock.calls[0][1][3]).toBeNull();
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect((await call(ev('PUT', `${P}/1000/D/O`, { body: { dpo_email: 'a@b.it' } }))).status).toBe(404);
    expect((await call(ev('PUT', `${P}/1000/D/O`, { body: {} }))).status).toBe(400);
  });
  test('DELETE ok / 404', async () => {
    mockQuery.mockResolvedValueOnce({ rowCount: 1 });
    expect((await call(ev('DELETE', `${P}/1000/D/O`))).status).toBe(200);
    mockQuery.mockResolvedValueOnce({ rowCount: 0 });
    expect((await call(ev('DELETE', `${P}/1000/D/O`))).status).toBe(404);
  });
});

describe('paginazione', () => {
  test.each([{ limit: '0' }, { limit: '501' }, { limit: 'a' }, { offset: '-1' }])('non valida %j -> 400', async (q) => {
    expect((await call(ev('GET', '/api/customer-options', { query: q }))).status).toBe(400);
  });
});
