'use strict';

jest.mock('../db', () => ({
  getPool: jest.fn(),
}));
jest.mock('../FavoriteRepository', () => ({
  listFavorites: jest.fn(),
  toggleFavorite: jest.fn(),
}));
jest.mock('../../dms/authService', () => ({ getBearerToken: jest.fn() }));
jest.mock('../../dms/dmsService', () => ({ postDmsInquiry: jest.fn(), resolveDynamicSenderFields: jest.fn() }));

const { getPool } = require('../db');
const { listFavorites, toggleFavorite } = require('../FavoriteRepository');
const { getBearerToken } = require('../../dms/authService');
const { postDmsInquiry, resolveDynamicSenderFields } = require('../../dms/dmsService');
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
    // Nessuna risoluzione automatica di default: i singoli test che vogliono
    // verificarla la sovrascrivono esplicitamente. Di default si comporta
    // come il vero dms/dmsService.js::resolveDynamicSenderFields quando la
    // risoluzione non produce nulla: ritorna semplicemente gli overrides.
    resolveDynamicSenderFields.mockImplementation((_identifiers, overrides) => Promise.resolve({ ...overrides }));
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

  it('GET: lists favorites for username only (from authorizer), enriched via DML (LFP) using vin from query', async () => {
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
    });
    expect(getBearerToken).toHaveBeenCalledTimes(1);
    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', {
      PartsInquiryHeader: { MessageType: 'LFP', VehicleID: 'VF3CABHW6GT204366' },
      package: 'FORFAIT',
      // Nessun dato di sessione (mainSincom/market/brand/...) in query, e
      // resolveDynamicSenderFields (mockata) non risolve nulla: il Sender
      // dinamico contiene solo serviceId (username da authorizer.sub).
      sender: { serviceId: '0062230.d001' },
    });
    expect(resolveDynamicSenderFields).toHaveBeenCalledWith(
      { username: '0062230.d001', vin: 'VF3CABHW6GT204366' },
      expect.anything(),
    );
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

  it('GET: builds a dynamic Sender from query params (mainSincom/market/brand/language/dealerCountryCode) and threads it to every postDmsInquiry call', async () => {
    // Stesso meccanismo/stessi criteri di jobcard::buildDmsSender e
    // pkManager::_buildDmsSender: dealerNumberId<-mainSincom,
    // serviceId<-username (authorizer), languageCode<-language,
    // dealerCountryCode<-dealerCountryCode, brand<-brand, market<-market
    // (solo chiave di lookup lato dms, mai un campo Sender vero e proprio).
    listFavorites.mockResolvedValue([
      { packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' },
      { packageCode: 'TAGLIANDO', createdAt: '2026-01-02T09:00:00Z' },
    ]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({ UpSelling: { Packages: [] } });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: {
        vin: 'VF3CABHW6GT204366',
        mainSincom: '1234567',
        market: '10102',
        brand: 'AP',
        language: 'FR',
        dealerCountryCode: 'FR',
      },
    });

    await handler(event);

    const expectedSender = {
      dealerNumberId: '1234567',
      serviceId: '0062230.d001',
      languageCode: 'FR',
      dealerCountryCode: 'FR',
      brand: 'AP',
      market: '10102',
    };
    expect(postDmsInquiry).toHaveBeenCalledTimes(2);
    expect(postDmsInquiry).toHaveBeenNthCalledWith(1, 'fake-bearer-token', expect.objectContaining({ sender: expectedSender }));
    expect(postDmsInquiry).toHaveBeenNthCalledWith(2, 'fake-bearer-token', expect.objectContaining({ sender: expectedSender }));
  });

  it('GET: accepts codmarket/codbrand/marketIso as fallback query param names for market/brand/dealerCountryCode', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({ UpSelling: { Packages: [] } });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: {
        vin: 'VF3CABHW6GT204366',
        codmarket: '10102',
        codbrand: 'AP',
        marketIso: 'FR',
      },
    });

    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', expect.objectContaining({
      sender: expect.objectContaining({ market: '10102', brand: 'AP', dealerCountryCode: 'FR' }),
    }));
  });

  it('GET: nessun parametro dal FE — risolve automaticamente mainSincom/market/brand/language/dealerCountryCode tramite dms/dmsService.js::resolveDynamicSenderFields, usando solo lo username autenticato e il vin', async () => {
    // Il caso reale: il FE passa solo vin (nessun mainSincom/market/brand/
    // language/dealerCountryCode in query). Il Sender dinamico viene quindi
    // costruito interamente a partire da username+vin, tramite
    // dms/dmsService.js::resolveDynamicSenderFields (session + v360).
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({ UpSelling: { Packages: [] } });
    resolveDynamicSenderFields.mockResolvedValue({
      mainSincom: '0062230',
      market: '10102',
      brand: 'FT',
      language: 'it',
      dealerCountryCode: 'IT',
    });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    await handler(event);

    expect(resolveDynamicSenderFields).toHaveBeenCalledWith(
      { username: '0062230.d001', vin: 'VF3CABHW6GT204366' },
      expect.anything(),
    );
    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', expect.objectContaining({
      sender: {
        dealerNumberId: '0062230',
        serviceId: '0062230.d001',
        languageCode: 'it',
        dealerCountryCode: 'IT',
        brand: 'FT',
        market: '10102',
      },
    }));
  });

  it('GET: i parametri espliciti in query hanno priorità sulla risoluzione automatica', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({ UpSelling: { Packages: [] } });
    // Simula il comportamento reale di resolveDynamicSenderFields: gli
    // override espliciti (query) vincono sempre sulla risoluzione automatica.
    resolveDynamicSenderFields.mockImplementation((_identifiers, overrides) => Promise.resolve({
      mainSincom: overrides.mainSincom || '9999999',
      market: overrides.market || '99999',
      brand: overrides.brand || 'XX',
      language: overrides.language || 'en',
      dealerCountryCode: overrides.dealerCountryCode || 'GB',
    }));

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366', mainSincom: '1234567', brand: 'AP' },
    });

    await handler(event);

    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', expect.objectContaining({
      sender: expect.objectContaining({
        dealerNumberId: '1234567', // esplicito, non sovrascritto dalla risoluzione automatica
        brand: 'AP', // esplicito, non sovrascritto dalla risoluzione automatica
        market: '99999', // assente in query, risolto automaticamente
        languageCode: 'en', // assente in query, risolto automaticamente
        dealerCountryCode: 'GB', // assente in query, risolto automaticamente
      }),
    }));
  });

  it('GET: se la risoluzione automatica fallisce, il Sender ricade sui soli campi già disponibili (nessun errore propagato)', async () => {
    listFavorites.mockResolvedValue([{ packageCode: 'FORFAIT', createdAt: '2026-01-01T09:00:00Z' }]);
    getBearerToken.mockResolvedValue('fake-bearer-token');
    postDmsInquiry.mockResolvedValue({ UpSelling: { Packages: [] } });
    resolveDynamicSenderFields.mockResolvedValue({}); // best-effort: es. myPeople/v360 irraggiungibili

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const res = await handler(event);

    expect(res.statusCode).toBe(200);
    expect(postDmsInquiry).toHaveBeenCalledWith('fake-bearer-token', expect.objectContaining({
      sender: { serviceId: '0062230.d001' },
    }));
  });

  it('GET: con più preferiti, esegue tutte le chiamate DML in parallelo (non in coda)', async () => {
    // Regressione: le N chiamate a postDmsInquiry devono partire tutte
    // "subito" (stesso tick), non attendere il completamento l'una
    // dell'altra. Se fossero sequenziali, la seconda chiamata verrebbe
    // avviata solo dopo la risoluzione della prima (dopo ~50ms), quindi il
    // tempo totale sarebbe la SOMMA dei ritardi; se sono in parallelo, il
    // tempo totale è vicino al MASSIMO dei ritardi.
    listFavorites.mockResolvedValue([
      { packageCode: 'P1', createdAt: '2026-01-01T09:00:00Z' },
      { packageCode: 'P2', createdAt: '2026-01-01T09:00:00Z' },
      { packageCode: 'P3', createdAt: '2026-01-01T09:00:00Z' },
    ]);
    getBearerToken.mockResolvedValue('fake-bearer-token');

    const callOrder = [];
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    postDmsInquiry.mockImplementation(async (_token, { package: packageCode }) => {
      callOrder.push({ packageCode, startedAt: Date.now() });
      await delay(50);
      return { UpSelling: { Packages: [] } };
    });

    const event = apiGwEvent({
      method: 'GET',
      authorizerSub: '0062230.d001',
      query: { vin: 'VF3CABHW6GT204366' },
    });

    const startedAt = Date.now();
    const res = await handler(event);
    const elapsedMs = Date.now() - startedAt;

    expect(res.statusCode).toBe(200);
    expect(postDmsInquiry).toHaveBeenCalledTimes(3);
    // Tutte e 3 le chiamate devono essere partite entro pochi ms l'una
    // dall'altra (stesso "giro" di Promise.all), non a ~50ms di distanza
    // l'una dall'altra come sarebbe con un await in sequenza.
    const spread = Math.max(...callOrder.map((c) => c.startedAt)) - Math.min(...callOrder.map((c) => c.startedAt));
    expect(spread).toBeLessThan(40);
    // Tempo totale vicino al singolo delay (50ms), non alla somma (150ms).
    expect(elapsedMs).toBeLessThan(120);
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

    expect(listFavorites).toHaveBeenCalledWith(FAKE_POOL, { username: 'cli-user' });
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
