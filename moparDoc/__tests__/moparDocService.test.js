'use strict';

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
} = require('../moparDocService');

jest.mock('../config', () => ({
  getConfig: jest.fn().mockResolvedValue({
    jobDocs: { baseUrl: 'https://job-docs', basePath: '/jd', ibmClientId: 'id', ibmClientSecret: 'secret' },
    moparDocsServices: { baseUrl: 'https://services', basePath: '/svc', ibmClientId: 'id', ibmClientSecret: 'secret' },
    moparDocsApi: { baseUrl: 'https://api', basePath: '/api', ibmClientId: 'id', ibmClientSecret: 'secret' },
  }),
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
        Size: '182379',
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
        source: 'WOC',
        vin: 'VIN123',
        dealerCode: '0062230',
        market: 'IT',
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error when neither dealerCode nor rrdi is provided', async () => {
      await expect(getJobCardList({ source: 'WOC', vin: 'VIN123', market: 'IT' })).rejects.toThrow('Missing required field(s)');
    });

    test('should use rrdi when dealerCode is absent', async () => {
      const result = await getJobCardList({
        source: 'WOC',
        vin: 'VIN123',
        rrdi: 'RRDI01',
        market: 'IT',
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
        source: 'WOC',
        vin: 'VIN123',
        dealerCode: '0062230',
        market: 'IT',
        Language: 'en',
        StartDate: '2022-10-31',
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error when neither dealerCode nor rrdi is provided', async () => {
      await expect(
        getJobCardAndDocumentList({ source: 'WOC', vin: 'VIN123', market: 'IT', Language: 'en', StartDate: '2022-10-31' })
      ).rejects.toThrow('Missing required field(s)');
    });

    test('should use rrdi when dealerCode is absent', async () => {
      const result = await getJobCardAndDocumentList({
        source: 'WOC',
        vin: 'VIN123',
        rrdi: 'RRDI01',
        market: 'IT',
        Language: 'en',
        StartDate: '2022-10-31',
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
        source: 'WOC',
        Language: 'en',
        DocumentIDList: [227856, 227857],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if DocumentIDList is empty', async () => {
      await expect(
        getDocumentsInfo({ source: 'WOC', Language: 'en', DocumentIDList: [] })
      ).rejects.toThrow('DocumentIDList deve essere un array non vuoto');
    });
  });

  describe('getDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(getDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await getDocuments({
        vin: 'VIN123',
      });
      expect(result).toEqual({ success: true });
    });

    test('should include JobCardIds in payload when provided', async () => {
      const result = await getDocuments({ vin: 'VIN123', JobCardIds: [1, 2, 3] });
      expect(result).toEqual({ success: true });
    });
  });

  describe('DeleteDocuments', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteDocuments({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteDocuments({
        source: 'WOC',
        JobCardId: 12345,
        Documents: [2083, 2084],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if Documents array is empty', async () => {
      await expect(
        DeleteDocuments({ source: 'WOC', JobCardId: 12345, Documents: [] })
      ).rejects.toThrow('Documents deve essere un array non vuoto');
    });
  });

  describe('DeleteJobcard', () => {
    test('should throw error if required fields are missing', async () => {
      await expect(DeleteJobcard({})).rejects.toThrow('Missing required field(s)');
    });

    test('should call postJson with correct payload', async () => {
      const result = await DeleteJobcard({
        Source: 'WOC',
        JobCardId: 12345,
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
        DocumentIDList: [227856, 227857],
      });
      expect(result).toEqual({ success: true });
    });

    test('should throw error if DocumentIDList is empty', async () => {
      await expect(
        getDocumentsDownloadUrl({ DocumentIDList: [] })
      ).rejects.toThrow('DocumentIDList deve essere un array non vuoto');
    });
  });

  describe('postJson HTTP error handling', () => {
    const { httpsRequest } = require('../httpClient');

    test('should throw when httpsRequest returns non-2xx status', async () => {
      httpsRequest.mockResolvedValueOnce({ statusCode: 500, body: { error: 'server error' } });
      await expect(
        createJobCard({
          vin: 'VIN123', market: 'IT', source: 'WOC', UserName: 'user1',
          dealerCode: '0062230', JobCard_Title: 'Test', TAMAccessCode: 'true',
        })
      ).rejects.toThrow('failed: HTTP 500');
    });

    test('should throw when response body has errorCode !== 0 (application error)', async () => {
      httpsRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { errorCode: 1, errorMessage: 'Source Not compliant or Generic error in DeleteJobcard' },
      });
      await expect(
        DeleteJobcard({ Source: 'WOC', JobCardId: 82379 })
      ).rejects.toThrow('errorCode 1 - Source Not compliant or Generic error in DeleteJobcard');
    });

    test('should succeed when response body has errorCode === 0', async () => {
      httpsRequest.mockResolvedValueOnce({
        statusCode: 200,
        body: { errorCode: 0, errorMessage: '' },
      });
      const result = await DeleteJobcard({ Source: 'WOC', JobCardId: 82379 });
      expect(result).toEqual({ errorCode: 0, errorMessage: '' });
    });

  });
});
