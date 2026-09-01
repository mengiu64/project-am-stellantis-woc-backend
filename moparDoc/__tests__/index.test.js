'use strict';

jest.mock('../moparDocService', () => ({
  createJobCard: jest.fn(),
  createAccessToken: jest.fn(),
  getUploadDocURL: jest.fn(),
  uploadedDoc: jest.fn(),
  getJobCardList: jest.fn(),
  associateJobCard: jest.fn(),
  getJobCardAndDocumentList: jest.fn(),
  getDocumentsInfo: jest.fn(),
  associateDocument: jest.fn(),
  getDocuments: jest.fn(),
  DeleteDocuments: jest.fn(),
  DeleteJobcard: jest.fn(),
  getDocumentsDownloadUrl: jest.fn(),
}));

const {
  createJobCard,
  createAccessToken,
  getUploadDocURL,
  uploadedDoc,
  getJobCardList,
  associateJobCard,
  getJobCardAndDocumentList,
  getDocumentsInfo,
  associateDocument,
  getDocuments,
  DeleteDocuments,
  DeleteJobcard,
  getDocumentsDownloadUrl,
} = require('../moparDocService');
const { handler } = require('../index');

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
});
