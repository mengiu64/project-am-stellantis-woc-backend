const { getSecret } = require('../src/secrets.js');
const { getProfileByUsername } = require('../src//auth.js');

jest.mock('../src/secrets.js');
jest.mock('../src/auth.js');

describe('Lambda handler', () => {
  
  let mockEvent;
  let handler;

  const mockSecret = {
    domain: 'https://example.com',
    pfx: 'MIIJ...',
    passphrase: 'pass123',
    identifier: 'secret-id'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PROFILES = 'PROFILE1,PROFILE2';
    process.env.APPLICATION = 'APP1';
    process.env.MYPEOPLE = 'my-secret';
    ({ handler } = require('../src/handler.js'));
    mockEvent = {
      request: {
        userAttributes: {
          name: 'jdoe',
          email: 'jdoe@example.com',
          'custom:firstname': 'John',
          'custom:lastname': 'Doe',
          'custom:country': 'US',
          'custom:groups': 'admin'
        }
      },
      response: {}
    };
  });

  it('should add claims when user has a valid application', async () => {
    getSecret.mockResolvedValue(mockSecret);
    getProfileByUsername.mockResolvedValue({
      Applications: [
        {
          APPLICATION: 'APP1',
          PROFILE: 'PROFILE1',
          HQATTRIBUTES: {
            MARKETS: ['US', 'EU']
          }
        }
      ]
    });

    const result = await handler(mockEvent);

    expect(getSecret).toHaveBeenCalledWith(process.env.MYPEOPLE);
    expect(getProfileByUsername).toHaveBeenCalledWith(
      mockSecret.domain,
      mockSecret.pfx,
      mockSecret.passphrase,
      mockSecret.identifier,
      'jdoe'
    );

    const claims = result.response.claimsAndScopeOverrideDetails.idTokenGeneration.claimsToAddOrOverride.ntt_context;
    expect(claims.username).toBe('jdoe');
    expect(claims.email).toBe('jdoe@example.com');
    expect(claims.firstName).toBe('John');
    expect(claims.lastName).toBe('Doe');
    expect(claims.country).toBe('US');
    expect(claims.groups).toBe('admin');
    expect(claims.markets).toEqual(['US', 'EU']);
    expect(claims.role).toEqual('PROFILE1');
  });

  it('should not add claims if user has no valid application', async () => {
    getSecret.mockResolvedValue(mockSecret);
    getProfileByUsername.mockResolvedValue({
      Applications: [
        { APPLICATION: 'APP2', PROFILE: 'PROFILE3', HQATTRIBUTES: { MARKETS: ['US'] } }
      ]
    });
    const result = await handler(mockEvent);

    expect(result.response).not.toHaveProperty('claimsAndScopeOverrideDetails');  
  });

  it('should enforce role when it is defined and user has a valid application', async () => {
    process.env.ENFORCE_ROLE = 'PROFILE2';
    getSecret.mockResolvedValue(mockSecret);
    getProfileByUsername.mockResolvedValue({
      Applications: [
        {
          APPLICATION: 'APP1',
          PROFILE: 'PROFILE1',
          HQATTRIBUTES: {
            MARKETS: ['US', 'EU']
          }
        }
      ]
    });

    const result = await handler(mockEvent);

    expect(getSecret).toHaveBeenCalledWith(process.env.MYPEOPLE);
    expect(getProfileByUsername).toHaveBeenCalledWith(
      mockSecret.domain,
      mockSecret.pfx,
      mockSecret.passphrase,
      mockSecret.identifier,
      'jdoe'
    );

    const claims = result.response.claimsAndScopeOverrideDetails.idTokenGeneration.claimsToAddOrOverride.ntt_context;
    expect(claims.role).toEqual('PROFILE2');
  });
});