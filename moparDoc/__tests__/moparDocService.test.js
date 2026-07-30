'use strict';

jest.mock('../config', () => ({
  jobDocs: {
    baseUrl: 'https://jobdocs.test',
    basePath: '/job-docs/connector/v1',
    ibmClientId: 'ibm-id',
    ibmClientSecret: 'ibm-secret',
  },
  moparDocsApi: {
    baseUrl: 'https://mopardocs.test',
    basePath: '/Mopardocs/MoparDocsApi/Browser',
    ibmClientId: 'ibm-id',
    ibmClientSecret: 'ibm-secret',
  },
}));
jest.mock('../authService');
jest.mock('../httpClient');

const { getBearerToken } = require('../authService');
const { httpsRequest } = require('../httpClient');
const { createJobCard, createAccessToken, getUploadDocURL, uploadedDoc } = require('../moparDocService');

describe('moparDocService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    getBearerToken.mockResolvedValue('test-bearer-token');
  });

  afterEach(() => console.log.mockRestore());

  const jobCardPayload = {
    vin: 'VF3CABHW6GT204366',
    market: 'IT',
    source: 'WOC',
    UserName: 'user1',
    dealerCode: '0062230',
    JobCard_Title: 'Title',
    TAMAccessCode: 'ACC123',
  };

  const accessTokenPayload = {
    JobCardId: 'JC1',
    UserName: 'user1',
    dealerCode: '0062230',
    market: 'IT',
    APIAccessCode: 'ACC123',
  };

  const uploadUrlPayload = {
    JobCardId: 'JC1',
    Filename: 'doc.pdf',
    ContentType: 'application/pdf',
    AccessToken: 'access-token',
    Filetype: 'pdf',
  };

  const uploadedDocPayload = {
    JobCardId: 'JC1',
    DocumentId: 'DOC1',
    Action: 'confirm',
    AccessToken: 'access-token',
  };

  describe('createJobCard', () => {
    test('throws when a required field is missing', async () => {
      await expect(createJobCard({ ...jobCardPayload, vin: undefined }))
        .rejects.toThrow('Missing required field(s): vin');
    });

    test('throws when params is undefined', async () => {
      await expect(createJobCard(undefined)).rejects.toThrow('Missing required field(s)');
    });

    test('calls job-docs connector host with Bearer + X-IBM headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { JobCardId: 'JC1' } });

      const result = await createJobCard(jobCardPayload);

      expect(result).toEqual({ JobCardId: 'JC1' });
      const [options, body] = httpsRequest.mock.calls[0];
      expect(options.hostname).toBe('jobdocs.test');
      expect(options.path).toBe('/job-docs/connector/v1/CreateJobCard');
      expect(options.headers.Authorization).toBe('Bearer test-bearer-token');
      expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
      expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
      expect(JSON.parse(body)).toEqual(jobCardPayload);
    });

    test('throws when downstream returns non-2xx', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 400, headers: {}, body: { message: 'bad' } });
      await expect(createJobCard(jobCardPayload)).rejects.toThrow('CreateJobCard failed: HTTP 400');
    });
  });

  describe('createAccessToken', () => {
    test('throws when a required field is missing', async () => {
      await expect(createAccessToken({ ...accessTokenPayload, APIAccessCode: undefined }))
        .rejects.toThrow('Missing required field(s): APIAccessCode');
    });

    test('throws when params is undefined', async () => {
      await expect(createAccessToken(undefined)).rejects.toThrow('Missing required field(s)');
    });

    test('calls job-docs connector host with ****** X-IBM headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { AccessToken: 'tok' } });

      const result = await createAccessToken(accessTokenPayload);

      expect(result).toEqual({ AccessToken: 'tok' });
      const [options, body] = httpsRequest.mock.calls[0];
      expect(options.hostname).toBe('jobdocs.test');
      expect(options.path).toBe('/job-docs/connector/v1/CreateAccessToken');
      expect(options.headers.Authorization).toBe('Bearer test-bearer-token');
      expect(options.headers['X-IBM-Client-Id']).toBe('ibm-id');
      expect(options.headers['X-IBM-Client-Secret']).toBe('ibm-secret');
      expect(JSON.parse(body)).toEqual(accessTokenPayload);
    });

    test('throws when downstream returns non-2xx', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 401, headers: {}, body: { message: 'bad' } });
      await expect(createAccessToken(accessTokenPayload)).rejects.toThrow('CreateAccessToken failed: HTTP 401');
    });
  });

  describe('getUploadDocURL', () => {
    test('throws when a required field is missing', async () => {
      await expect(getUploadDocURL({ ...uploadUrlPayload, Filename: undefined }))
        .rejects.toThrow('Missing required field(s): Filename');
    });

    test('calls moparDocsApi host with Bearer + X-IBM headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { UploadURL: 'https://x' } });

      const result = await getUploadDocURL(uploadUrlPayload);

      expect(result).toEqual({ UploadURL: 'https://x' });
      const [options, body] = httpsRequest.mock.calls[0];
      expect(options.hostname).toBe('mopardocs.test');
      expect(options.path).toBe('/Mopardocs/MoparDocsApi/Browser/getUploadDocURL');
      expect(JSON.parse(body)).toEqual(uploadUrlPayload);
    });

    test('throws when downstream returns non-2xx', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 500, headers: {}, body: {} });
      await expect(getUploadDocURL(uploadUrlPayload)).rejects.toThrow('getUploadDocURL failed: HTTP 500');
    });
  });

  describe('uploadedDoc', () => {
    test('throws when a required field is missing', async () => {
      await expect(uploadedDoc({ ...uploadedDocPayload, DocumentId: undefined }))
        .rejects.toThrow('Missing required field(s): DocumentId');
    });

    test('calls moparDocsApi host with Bearer + X-IBM headers', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { success: true } });

      const result = await uploadedDoc(uploadedDocPayload);

      expect(result).toEqual({ success: true });
      const [options, body] = httpsRequest.mock.calls[0];
      expect(options.hostname).toBe('mopardocs.test');
      expect(options.path).toBe('/Mopardocs/MoparDocsApi/Browser/UploadedDoc');
      expect(JSON.parse(body)).toEqual(uploadedDocPayload);
    });

    test('throws when downstream returns non-2xx', async () => {
      httpsRequest.mockResolvedValue({ statusCode: 403, headers: {}, body: {} });
      await expect(uploadedDoc(uploadedDocPayload)).rejects.toThrow('UploadedDoc failed: HTTP 403');
    });
  });
});
