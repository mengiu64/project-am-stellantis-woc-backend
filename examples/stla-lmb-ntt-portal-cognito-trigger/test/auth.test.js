const { getProfileByUsername } = require('../src/auth.js');
const { makeHttpsRequest } = require('../src/https-request.js');

jest.mock('../src/https-request.js');

describe('getProfileByUsername', () => {
  const domain = 'https://example.com';
  const pfx = Buffer.from('dummy-cert').toString('base64');
  const passphrase = 'pass123';
  const identifier = 'secret-id';
  const username = 'jdoe';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return user object when response contains User', async () => {
    const mockUser = { Applications: [{ APPLICATION: 'APP1' }] };
    makeHttpsRequest.mockResolvedValue({
      Response: {
        User: mockUser
      }
    });

    const user = await getProfileByUsername(domain, pfx, passphrase, identifier, username);

    expect(user).toEqual(mockUser);
    expect(makeHttpsRequest).toHaveBeenCalledTimes(1);

    const expectedUrl = `${domain}/URSma.svc/readUserProfiles/?identifier=${identifier}&username=${encodeURIComponent(username)}`;
    expect(makeHttpsRequest).toHaveBeenCalledWith(
      expectedUrl,
      expect.any(Buffer),
      passphrase
    );
  });

  it('should return null if response has no User', async () => {
    makeHttpsRequest.mockResolvedValue({
      Response: {}
    });

    const user = await getProfileByUsername(domain, pfx, passphrase, identifier, username);

    expect(user).toBeNull();
  });

  it('should log error and return null on exception', async () => {
    const error = new Error('Network failed');
    makeHttpsRequest.mockRejectedValue(error);


    const user = await getProfileByUsername(domain, pfx, passphrase, identifier, username);
    expect(user).toBeNull();
  });

  it('should convert pfx from base64 to buffer', async () => {
    const mockUser = { Applications: [] };
    makeHttpsRequest.mockResolvedValue({ Response: { User: mockUser } });

    await getProfileByUsername(domain, pfx, passphrase, identifier, username);

    const calledBuffer = makeHttpsRequest.mock.calls[0][1];
    expect(Buffer.isBuffer(calledBuffer)).toBe(true);
    expect(calledBuffer.toString()).toBe('dummy-cert');
  });
});