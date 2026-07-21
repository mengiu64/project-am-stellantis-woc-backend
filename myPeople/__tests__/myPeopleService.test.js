'use strict';

jest.mock('../config', () => ({
  myPeople: {
    host: 'https://api.test',
    basePath: '/applications/mypeople/iursma/v1',
    ibmClientId: 'test-client-id',
    username: 'mwppnr16',
    password: 'FntP0P31',
  },
  secrets: {
    certSecretId: 'apicCert',
    keySecretId: 'apicKey',
    extensionPort: 2773,
  },
}));
jest.mock('../httpClient');
jest.mock('../certService');

const { httpsRequest } = require('../httpClient');
const { getHttpsAgent } = require('../certService');
const { readUserProfiles } = require('../myPeopleService');

describe('myPeopleService', () => {
  const fakeAgent = { fake: 'agent' };

  beforeEach(() => {
    jest.clearAllMocks();
    getHttpsAgent.mockResolvedValue(fakeAgent);
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    console.log.mockRestore();
  });

  test('throws if username is missing', async () => {
    await expect(readUserProfiles({ identifier: 'ID-1' })).rejects.toThrow('[myPeople] username is required');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('throws if identifier is missing', async () => {
    await expect(readUserProfiles({ username: 'user1' })).rejects.toThrow('[myPeople] identifier is required');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('throws if both username and identifier are missing', async () => {
    await expect(readUserProfiles({})).rejects.toThrow('[myPeople] username is required');
  });

  test('calls httpsRequest with correct hostname, path and method', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: { success: true } });

    await readUserProfiles({ username: '0073741.d235', identifier: 'B1FD759A-B3E8' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.method).toBe('GET');
    expect(options.hostname).toBe('api.test');
    expect(options.path).toContain('/applications/mypeople/iursma/v1/readUserProfiles');
    expect(options.path).toContain('username=0073741.d235');
    expect(options.path).toContain('identifier=B1FD759A-B3E8');
  });

  test('sends X-IBM-Client-Id and Authorization Basic headers', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await readUserProfiles({ username: 'user1', identifier: 'id1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.headers['X-IBM-Client-Id']).toBe('test-client-id');
    expect(options.headers.Authorization).toBe(
      'Basic ' + Buffer.from('mwppnr16:FntP0P31').toString('base64')
    );
  });

  test('attaches the mTLS https.Agent from certService', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await readUserProfiles({ username: 'user1', identifier: 'id1' });

    expect(getHttpsAgent).toHaveBeenCalledTimes(1);
    const [options] = httpsRequest.mock.calls[0];
    expect(options.agent).toBe(fakeAgent);
  });

  test('returns response body on success', async () => {
    const body = { profiles: [{ username: 'user1' }] };
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body });

    const result = await readUserProfiles({ username: 'user1', identifier: 'id1' });
    expect(result).toEqual(body);
  });

  test('throws on non-200 HTTP response', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 404, headers: {}, body: { message: 'not found' } });

    await expect(readUserProfiles({ username: 'user1', identifier: 'id1' }))
      .rejects.toThrow('[myPeople] readUserProfiles failed: HTTP 404');
  });

  test('propagates errors thrown while retrieving the mTLS agent', async () => {
    getHttpsAgent.mockRejectedValue(new Error('secret fetch failed'));

    await expect(readUserProfiles({ username: 'user1', identifier: 'id1' }))
      .rejects.toThrow('secret fetch failed');
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  test('URL-encodes special characters in username/identifier', async () => {
    httpsRequest.mockResolvedValue({ statusCode: 200, headers: {}, body: {} });

    await readUserProfiles({ username: 'user name/1', identifier: 'id#1' });

    const [options] = httpsRequest.mock.calls[0];
    expect(options.path).toContain(encodeURIComponent('user name/1').replace(/%20/g, '+'));
  });
});
