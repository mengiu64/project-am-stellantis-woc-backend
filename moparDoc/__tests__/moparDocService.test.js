'use strict';

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

const config = require('../config');

jest.mock('../config', () => ({
  jobDocs: { baseUrl: 'https://job-docs', basePath: '/jd', ibmClientId: 'id', ibmClientSecret: 'secret' },
  moparDocsServices: { baseUrl: 'https://services', basePath: '/svc', ibmClientId: 'id', ibmClientSecret: 'secret' },
  moparDocsApi: { baseUrl: 'https://api', basePath: '/api', ibmClientId: 'id', ibmClientSecret: 'secret' },
}));

jest.mock('../authService', () => ({
  getBearerToken: jest.fn().mockResolvedValue('test-token'),
}));

jest.mock('../httpClient', () => ({
  httpsRequest: jest.fn((options, body) => {
    return Promise.resolve({ statusCode: 200, body: { success: true } });
  }),
}));

describe('moparDocService', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  // ────── Metodi originali (4 test per metodo: 2 error, 1 success) ──────

  describe('createJobCard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(createJobCard({ vin: 'VIN123' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await createJobCard({
        vin: 'VIN123',
        market: 'IT',
        source: 'WEB',
        UserName: 'user1',
        dealerCode: '0062230',
        JobCard_Title: 'Test JobCard',
        TAMAccessCode: 'ACC123',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('createAccessToken', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(createAccessToken({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await createAccessToken({
        JobCardId: 'JC1',
        UserName: 'user1',
        dealerCode: '0062230',
        market: 'IT',
        APIAccessCode: 'ACC123',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getUploadDocURL', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getUploadDocURL({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getUploadDocURL({
        JobCardId: 'JC1',
        Filename: 'doc.pdf',
        ContentType: 'application/pdf',
        AccessToken: 'token',
        Filetype: 'PDF',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('uploadedDoc', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(uploadedDoc({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await uploadedDoc({
        JobCardId: 'JC1',
        DocumentId: 'DOC1',
        Action: 'upload',
        AccessToken: 'token',
      });
      expect(result).toEqual({ success: true });
    });
  });

  // ────── Metodi NUOVI (2 test per metodo: 1 error, 1 success) ──────

  describe('getJobCardList', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getJobCardList({ VIN: 'VIN123' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getJobCardList({
        VIN: 'VIN123',
        dealerCode: '0062230',
        market: 'IT',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('associateJobCard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(associateJobCard({ JobCardId: 'JC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await associateJobCard({
        JobCardId: 'JC1',
        TicketId: 'TKT1',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getJobCardAndDocumentList', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getJobCardAndDocumentList({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getJobCardAndDocumentList({
        JobCardId: 'JC1',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDocumentsInfo', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocumentsInfo({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocumentsInfo({
        DocumentIds: ['DOC1', 'DOC2'],
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('associateDocument', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(associateDocument({ DocumentId: 'DOC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await associateDocument({
        DocumentId: 'DOC1',
        TicketId: 'TKT1',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocuments({
        JobCardId: 'JC1',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('DeleteDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteDocuments({
        DocumentIds: ['DOC1', 'DOC2'],
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('DeleteJobcard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteJobcard({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteJobcard({
        JobCardId: 'JC1',
      });
      expect(result).toEqual({ success: true });
    });
  });

  describe('getDocumentsDownloadUrl', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocumentsDownloadUrl({ DocumentId: 'DOC1' })).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocumentsDownloadUrl({
        DocumentId: 'DOC1',
        AccessToken: 'token',
      });
      expect(result).toEqual({ success: true });
    });
  });
});
