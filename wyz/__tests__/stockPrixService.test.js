'use strict';

const mockRequest = jest.fn();
jest.mock('../httpClient', () => ({ httpsRequest: (...a) => mockRequest(...a) }));
const mockGetConfig = jest.fn();
jest.mock('../config', () => ({ getConfig: (...a) => mockGetConfig(...a) }));
const mockGetAgent = jest.fn();
const mockInvalidateAgent = jest.fn();
jest.mock('../certService', () => ({
  getHttpsAgent: (...a) => mockGetAgent(...a),
  invalidateAgent: (...a) => mockInvalidateAgent(...a),
}));
// wyzService importa authService/config: si espone solo la classe di errore reale
jest.mock('../authService', () => ({ getBearerToken: jest.fn(), invalidateToken: jest.fn() }));

const {
  getStockPrix, buildSoapEnvelope, escapeXml, mapFault, normalizeItem, validateInput, resolveDealerId,
} = require('../stockPrixService');
const { WyzError } = require('../wyzService');

const SP = {
  baseUrl: 'https://api-cert-preprod.groupe-psa.com',
  extensionPort: 2773,
  username: 'USR',
  password: 'PWD',
  clientId: 'cid',
  clientApplicationName: 'WIADVISOR',
  timeoutMs: 1000,
};
const AGENT = { fake: 'agent' };
const VALID = {
  customerDMSHeader: '95754',
  dealerId: '345678A',
  country: 'fr',
  brand: 'ac',
  vin: '',
  partLines: [{ partReference: '00001109AK', quantity: 1 }],
};

const soap = (body) => `<?xml version='1.0' encoding='UTF-8'?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body>${body}</S:Body></S:Envelope>`;
const DETAIL = '<StockPrixKBRWDetails><partReference>00001109AK</partReference><inStockqt>0</inStockqt><priceHT>13.7340</priceHT><priceTTC>16.6200</priceTTC><remise>40.00</remise><statusOfAvailibilityDMS>NON_DISPO</statusOfAvailibilityDMS><discountCodePanier>N</discountCodePanier></StockPrixKBRWDetails>';
const OK_BODY = soap(`<ns2:getStockPrixKBRWResponse xmlns:ns2="http://xml.inetpsa.com/pnr/stockprixservice/">${DETAIL}</ns2:getStockPrixKBRWResponse>`);
const ITEM = {
  partReference: '00001109AK', inStockQuantity: 0, priceHT: 13.734, priceTTC: 16.62,
  discountPercent: 40, availabilityStatus: 'NON_DISPO', discountCodePanier: 'N',
};

describe('stockPrixService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGetConfig.mockResolvedValue({ stockPrix: { ...SP } });
    mockGetAgent.mockResolvedValue(AGENT);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('escapeXml / buildSoapEnvelope', () => {
    it('esegue l\'escape dei caratteri riservati e gestisce null', () => {
      expect(escapeXml('<a href="x">&\'</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&apos;&lt;/a&gt;');
      expect(escapeXml(null)).toBe('');
    });
    it('costruisce la busta con tutti i tag nell\'ordine dell\'XSD', () => {
      const req = validateInput(VALID, '345678A');
      const xml = buildSoapEnvelope(req, 'WIADVISOR');
      expect(xml).toContain('<clientApplicationName>WIADVISOR</clientApplicationName><customerDMSHeader>95754</customerDMSHeader><dealerId>345678A</dealerId><country>FR</country><brand>AC</brand><vin></vin>');
      expect(xml).toContain('<stoc:partLineKBRW><partReference>00001109AK</partReference><quantity>1</quantity><partReferenceManfacture></partReferenceManfacture><triGramManfacture></triGramManfacture><idManufacturer></idManufacturer></stoc:partLineKBRW>');
    });
  });

  describe('resolveDealerId', () => {
    it('con authorizer usa SOLO profile.dealer_code e ignora il body', () => {
      const authorizer = { profile: JSON.stringify({ dealer_code: ' 111111A ' }) };
      expect(resolveDealerId({ dealerId: '999999Z' }, authorizer)).toBe('111111A');
      expect(console.warn).toHaveBeenCalled();
    });
    it('accetta un profile già oggetto', () => {
      expect(resolveDealerId({ dealerId: '111111A' }, { profile: { dealer_code: '111111A' } })).toBe('111111A');
      expect(console.warn).not.toHaveBeenCalled();
    });
    it.each([
      [{}],
      [{ profile: '{bad' }],
      [{ profile: JSON.stringify({ dealer_code: '' }) }],
    ])('con authorizer senza dealer_code valido -> 400 (%j)', (authorizer) => {
      expect(() => resolveDealerId({ dealerId: 'X' }, authorizer)).toThrow(expect.objectContaining({ statusCode: 400 }));
    });
    it('senza authorizer usa il body (o stringa vuota)', () => {
      expect(resolveDealerId({ dealerId: ' 345678A ' })).toBe('345678A');
      expect(resolveDealerId({})).toBe('');
    });
  });

  describe('validateInput', () => {
    it('normalizza i campi e accetta customerDMSHeader numerico e vin valorizzato', () => {
      const req = validateInput({ ...VALID, customerDMSHeader: 95754, vin: 'vr3fbyhztly048318', partLines: [{ partReference: 'P', quantity: 2, triGramManfacture: ' ABC ' }] }, 'D');
      expect(req).toEqual({
        customerDMSHeader: '95754', dealerId: 'D', country: 'FR', brand: 'AC', vin: 'VR3FBYHZTLY048318',
        partLines: [{ partReference: 'P', quantity: 2, partReferenceManfacture: '', triGramManfacture: 'ABC', idManufacturer: '' }],
      });
    });
    it('vin null è trattato come assente', () => {
      expect(validateInput({ ...VALID, vin: null }, 'D').vin).toBe('');
    });
    it('elenca tutti i campi non validi con 400', () => {
      const bad = {
        customerDMSHeader: 'x', country: 'FRA', brand: 1, vin: 'short',
        partLines: [null, { partReference: 'P', quantity: 0, idManufacturer: 5, partReferenceManfacture: 'x'.repeat(41) }],
      };
      try {
        validateInput(bad, '');
        throw new Error('atteso errore');
      } catch (e) {
        expect(e).toBeInstanceOf(WyzError);
        expect(e.statusCode).toBe(400);
        ['customerDMSHeader', 'dealerId', 'country', 'brand', 'vin', 'partLines[0].partReference', 'partLines[0].quantity',
          'partLines[1].quantity', 'partLines[1].idManufacturer', 'partLines[1].partReferenceManfacture']
          .forEach((f) => expect(e.message).toContain(f));
      }
    });
    it.each([[undefined], [[]], [new Array(101).fill({ partReference: 'P', quantity: 1 })]])('partLines non valido (%#)', (partLines) => {
      expect(() => validateInput({ ...VALID, partLines }, 'D')).toThrow('partLines (array');
    });
  });

  describe('mapFault / normalizeItem', () => {
    it('fault del gateway IBM -> 502 GATEWAY_FAULT (mai 401)', () => {
      const e = mapFault({ faultcode: 'soapenv:Client', faultstring: 'security', detail: { SOAPFaultInfo: { httpCode: '401' } } }, 401);
      expect(e).toMatchObject({ statusCode: 502, errorCode: 'GATEWAY_FAULT', upstreamStatus: 401 });
    });
    it('fault del gateway senza httpCode usa lo status HTTP', () => {
      expect(mapFault({ detail: { SOAPFaultInfo: {} } }, 500).upstreamStatus).toBe(500);
    });
    it('dealer sconosciuto -> 404', () => {
      expect(mapFault({ faultcode: 'S:Server', faultstring: 'Dealer Id unknown', detail: { UnknowDealerException: '' } }, 500))
        .toMatchObject({ statusCode: 404, errorCode: 'UNKNOWN_DEALER' });
      expect(mapFault({ faultstring: 'dealer id unknown' }, 500).statusCode).toBe(404);
    });
    it('fault Client -> 422 con faultString', () => {
      expect(mapFault({ faultcode: 'S:Client', faultstring: 'cvc' }, 500)).toMatchObject({ statusCode: 422, details: { faultString: 'cvc' } });
      expect(mapFault({ faultcode: 'Client' }, 500).statusCode).toBe(422);
    });
    it('altri fault -> 502', () => {
      expect(mapFault({}, 500)).toMatchObject({ statusCode: 502, errorCode: 'UPSTREAM_FAULT' });
    });
    it('normalizeItem gestisce valori non numerici o assenti', () => {
      expect(normalizeItem({ priceHT: 'abc' })).toEqual({
        partReference: null, inStockQuantity: null, priceHT: null, priceTTC: null,
        discountPercent: null, availabilityStatus: null, discountCodePanier: null,
      });
      expect(normalizeItem(null).priceHT).toBeNull();
    });
  });

  describe('getStockPrix', () => {
    it('chiama il servizio con mTLS, Basic Auth e client_id e normalizza la risposta', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, body: OK_BODY });
      const res = await getStockPrix(VALID, { correlationId: 'c-1' });
      expect(res).toEqual({ items: [ITEM] });

      const [options, xml] = mockRequest.mock.calls[0];
      expect(options).toMatchObject({
        hostname: 'api-cert-preprod.groupe-psa.com', port: 443, method: 'POST', timeout: 1000, agent: AGENT,
        path: '/api/cert-aai/applications/panier-soa/ws/StockPrixService/v1?client_id=cid',
      });
      expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('USR:PWD').toString('base64')}`);
      expect(options.headers['Content-Type']).toBe('text/xml; charset=utf-8');
      expect(options.headers['Content-Length']).toBe(Buffer.byteLength(xml));
      expect(options.headers['X-Correlation-Id']).toBe('c-1');
      expect(xml).toContain('<dealerId>345678A</dealerId>');
      expect(mockGetAgent).toHaveBeenCalledWith({ extensionPort: 2773 });
    });

    it('usa la porta esplicita dell\'URL e il dealer dell\'authorizer', async () => {
      mockGetConfig.mockResolvedValue({ stockPrix: { ...SP, baseUrl: 'https://api-cert.groupe-psa.com:8443' } });
      mockRequest.mockResolvedValue({ statusCode: 200, body: OK_BODY });
      await getStockPrix(VALID, { authorizer: { profile: JSON.stringify({ dealer_code: '111111A' }) } });
      expect(mockRequest.mock.calls[0][0]).toMatchObject({
        hostname: 'api-cert.groupe-psa.com', port: '8443',
        path: '/applications/panier-soa/ws/StockPrixService/v1?client_id=cid',
      });
      expect(mockRequest.mock.calls[0][1]).toContain('<dealerId>111111A</dealerId>');
    });

    it('più righe -> array; risposta senza dettagli -> items vuoto', async () => {
      mockRequest.mockResolvedValueOnce({ statusCode: 200, body: soap(`<getStockPrixKBRWResponse>${DETAIL}${DETAIL}</getStockPrixKBRWResponse>`) });
      expect((await getStockPrix(VALID)).items).toHaveLength(2);
      mockRequest.mockResolvedValueOnce({ statusCode: 200, body: soap('<getStockPrixKBRWResponse/>') });
      expect(await getStockPrix(VALID)).toEqual({ items: [] });
    });

    it('payload non oggetto -> 400', async () => {
      await expect(getStockPrix(null)).rejects.toMatchObject({ statusCode: 400 });
    });

    it('secret incompleto -> 500 senza chiamare il servizio', async () => {
      mockGetConfig.mockResolvedValue({ stockPrix: { ...SP, password: '', clientId: undefined, baseUrl: undefined } });
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 500, message: 'Configurazione StockPrixService incompleta' });
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('STOCKPRIX_PASSWORD, STOCKPRIX_CLIENT_ID, WYZ_STOCKPRIX_BASE_URL'));
      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('URL non valido -> 500', async () => {
      mockGetConfig.mockResolvedValue({ stockPrix: { ...SP, baseUrl: 'not a url' } });
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 500 });
    });

    it('certificato non disponibile -> 500', async () => {
      mockGetAgent.mockRejectedValue(new Error('no secret'));
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 500, message: expect.stringContaining('Certificato') });
    });

    it.each([
      ['timeout', new Error('Timeout richiesta HTTP dopo 1000ms'), 504, false],
      ['handshake TLS', Object.assign(new Error('alert certificate unknown'), { code: 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN' }), 502, true],
      ['rete', Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }), 502, false],
      ['rete senza code', new Error('socket hang up'), 502, false],
    ])('errore di trasporto: %s', async (_, err, status, invalidated) => {
      mockRequest.mockRejectedValue(err);
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: status });
      expect(mockInvalidateAgent).toHaveBeenCalledTimes(invalidated ? 1 : 0);
    });

    it.each([
      ['corpo non XML', { statusCode: 502, body: '<html' }],
      ['corpo JSON', { statusCode: 500, body: { error: 'x' } }],
      ['corpo vuoto', { statusCode: 200, body: '' }],
      ['XML non SOAP', { statusCode: 200, body: '<a>1</a>' }],
      ['Body vuoto', { statusCode: 200, body: soap('') }],
    ])('risposta non SOAP (%s) -> 502', async (_, response) => {
      mockRequest.mockResolvedValue(response);
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 502 });
    });

    it('SOAP Fault -> errore mappato', async () => {
      mockRequest.mockResolvedValue({ statusCode: 500, body: soap('<S:Fault><faultcode>S:Server</faultcode><faultstring>Dealer Id unknown</faultstring><detail><ns2:UnknowDealerException xmlns:ns2="x"/></detail></S:Fault>') });
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 404, errorCode: 'UNKNOWN_DEALER' });
    });

    it('HTTP non 2xx senza Fault -> 502', async () => {
      mockRequest.mockResolvedValue({ statusCode: 503, body: soap('<getStockPrixKBRWResponse/>') });
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 502, upstreamStatus: 503 });
    });

    it('risposta senza getStockPrixKBRWResponse -> 502', async () => {
      mockRequest.mockResolvedValue({ statusCode: 200, body: soap('<other/>') });
      await expect(getStockPrix(VALID)).rejects.toMatchObject({ statusCode: 502, message: 'Risposta non valida da StockPrixService' });
    });
  });
});
