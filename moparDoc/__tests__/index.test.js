'use strict';

jest.mock('../moparDocService', () => ({
  createJobCard: jest.fn(),
  createAccessToken: jest.fn(),
  getUploadDocURL: jest.fn(),
  uploadedDoc: jest.fn(),
  getJobCardList: jest.fn(),
  getJobCardAndDocumentList: jest.fn(),
  getDocumentsInfo: jest.fn(),
  getDocuments: jest.fn(),
  DeleteDocuments: jest.fn(),
  DeleteJobcard: jest.fn(),
  getDocumentsDownloadUrl: jest.fn(),
  deleteDocumentsByVin: jest.fn(),
  createJobCardAndUploadDocument: jest.fn(),
}));

const {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
  createJobCardAndUploadDocument,
} = require('../moparDocService');
const { handler, resolveCreatedBy } = require('../index');

describe('moparDoc index.handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('returns 400 for unknown action', async () => {
    const res = await handler({ action: 'notAnAction', body: {} });
    expect(res.statusCode).toBe(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(false);
    expect(parsed.message).toContain('Unknown action');
  });

  test('returns 400 when no action can be resolved', async () => {
    const res = await handler({ path: '/', body: {} });
    expect(res.statusCode).toBe(400);
  });

  test('createJobCard: direct invoke payload with action + body', async () => {
    createJobCard.mockResolvedValue({ JobCardId: 'JC1' });

    const res = await handler({
      action: 'createJobCard',
      body: JSON.stringify({ vin: 'VF3CABHW6GT204366' }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ JobCardId: 'JC1' });
    expect(createJobCard).toHaveBeenCalledWith({ vin: 'VF3CABHW6GT204366' });
  });

  test('createAccessToken: direct invoke payload with action + body', async () => {
    createAccessToken.mockResolvedValue({ AccessToken: 'tok' });

    const res = await handler({
      action: 'createAccessToken',
      body: JSON.stringify({ JobCardId: 'JC1', UserName: 'user1', dealerCode: '0062230', market: 'IT', APIAccessCode: 'ACC123' }),
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ AccessToken: 'tok' });
    expect(createAccessToken).toHaveBeenCalledWith({
      JobCardId: 'JC1', UserName: 'user1', dealerCode: '0062230', market: 'IT', APIAccessCode: 'ACC123',
    });
  });

  test('getUploadDocURL: API Gateway proxy event (path + query string)', async () => {
    getUploadDocURL.mockResolvedValue({ UploadURL: 'https://x' });

    const res = await handler({
      rawPath: '/api/moparDoc/getUploadDocURL',
      queryStringParameters: { JobCardId: 'JC1' },
      body: JSON.stringify({ Filename: 'doc.pdf' }),
    });

    expect(res.statusCode).toBe(200);
    expect(getUploadDocURL).toHaveBeenCalledWith({ JobCardId: 'JC1', Filename: 'doc.pdf' });
  });

  test('uploadedDoc: object body (already parsed) is passed through as-is', async () => {
    uploadedDoc.mockResolvedValue({ success: true });

    const res = await handler({
      action: 'uploadedDoc',
      body: { JobCardId: 'JC1', DocumentId: 'DOC1' },
    });

    expect(res.statusCode).toBe(200);
    expect(uploadedDoc).toHaveBeenCalledWith({ JobCardId: 'JC1', DocumentId: 'DOC1' });
  });

  test('unwraps body.payload when present', async () => {
    createJobCard.mockResolvedValue({ JobCardId: 'JC1' });

    await handler({ action: 'createJobCard', body: { payload: { vin: 'X' }, extra: 'ignored' } });

    expect(createJobCard).toHaveBeenCalledWith({ vin: 'X' });
  });

  test('falls back to empty object body when event.body is invalid JSON (proxy event)', async () => {
    getUploadDocURL.mockResolvedValue({});

    const res = await handler({ rawPath: '/x/getUploadDocURL', body: '{not-json' });

    expect(res.statusCode).toBe(200);
    expect(getUploadDocURL).toHaveBeenCalledWith({});
  });

  test('maps "Missing required field" errors to 400', async () => {
    createJobCard.mockRejectedValue(new Error('[createJobCard] Missing required field(s): vin'));

    const res = await handler({ action: 'createJobCard', body: {} });
    expect(res.statusCode).toBe(400);
  });

  test('maps unexpected/downstream errors to 502', async () => {
    createJobCard.mockRejectedValue(new Error('[createJobCard] CreateJobCard failed: HTTP 500'));

    const res = await handler({ action: 'createJobCard', body: {} });
    expect(res.statusCode).toBe(502);
  });

  // Task 5.8 — Con getConfig che rigetta per codice di accesso mancante, l'errore si propaga
  // dal metodo di servizio fino all'handler, che restituisce una risposta di errore (non-2xx, 502).
  // Valida Requirement 2.4.
  test('propagates config load failure (missing access code) as a non-2xx error response', async () => {
    // Simula il fallimento del caricamento credenziali: getConfig rigetta perché manca un codice di accesso nel Secret
    createJobCard.mockRejectedValue(
      new Error('Secret non valido: chiavi mancanti: MOPARDOC_TAM_ACCESS_CODE'),
    );

    // Invoca l'handler con un'azione valida: l'errore di caricamento deve propagarsi fino a qui
    const res = await handler({ action: 'createJobCard', body: {} });

    // L'handler deve tradurre l'errore di credenziali in una risposta di errore non-2xx (502 per la tabella di error-handling)
    expect(res.statusCode).toBe(502);
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    const parsed = JSON.parse(res.body);
    expect(parsed.success).toBe(false);
  });
});

describe('moparDoc index — identita\' (created_by) per createJobCardAndUploadDocument', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    createJobCardAndUploadDocument.mockResolvedValue({ success: true, metadataSaved: true });
  });

  test('usa requestContext.authorizer.sub come createdBy (opzione interna, separata dal body)', async () => {
    const res = await handler({
      rawPath: '/api/repairorder/mopardoc/createJobCardAndUploadDocument',
      requestContext: { authorizer: { sub: 'auth.user' } },
      body: JSON.stringify({ vin: 'VIN1', UserName: 'body.user', Kind: 'pin' }),
    });
    expect(res.statusCode).toBe(200);
    expect(createJobCardAndUploadDocument).toHaveBeenCalledWith(
      { vin: 'VIN1', UserName: 'body.user', Kind: 'pin' },
      { createdBy: 'auth.user' },
    );
  });

  test('il body non puo\' sovrascrivere createdBy (createdBy/created_by/options nel body ignorati)', async () => {
    await handler({
      action: 'createJobCardAndUploadDocument',
      requestContext: { authorizer: { sub: 'auth.user' } },
      body: { vin: 'VIN1', createdBy: 'evil', created_by: 'evil', options: { createdBy: 'evil' } },
    });
    const [, options] = createJobCardAndUploadDocument.mock.calls[0];
    expect(options).toEqual({ createdBy: 'auth.user' });
  });

  test('authorizer presente ma senza sub -> createdBy null (nessun fallback sul body)', async () => {
    await handler({
      action: 'createJobCardAndUploadDocument',
      requestContext: { authorizer: {} },
      body: { vin: 'VIN1', UserName: 'body.user' },
    });
    expect(createJobCardAndUploadDocument.mock.calls[0][1]).toEqual({ createdBy: null });
  });

  test('authorizer del tutto assente (invocazione diretta) -> fallback su body.UserName', async () => {
    await handler({ action: 'createJobCardAndUploadDocument', body: { vin: 'VIN1', UserName: 'body.user' } });
    expect(createJobCardAndUploadDocument.mock.calls[0][1]).toEqual({ createdBy: 'body.user' });
  });

  test('le altre azioni non ricevono opzioni interne', async () => {
    getDocuments.mockResolvedValue({});
    await handler({ action: 'getDocuments', requestContext: { authorizer: { sub: 'auth.user' } }, body: { vin: 'VIN1' } });
    expect(getDocuments.mock.calls[0]).toEqual([{ vin: 'VIN1' }]);
  });

  test('resolveCreatedBy: casi limite', () => {
    expect(resolveCreatedBy(undefined, undefined)).toBeNull();
    expect(resolveCreatedBy({}, {})).toBeNull();
    expect(resolveCreatedBy({ requestContext: {} }, { UserName: 'u' })).toBe('u');
    expect(resolveCreatedBy({ requestContext: { authorizer: { sub: 's' } } }, { UserName: 'u' })).toBe('s');
  });
});