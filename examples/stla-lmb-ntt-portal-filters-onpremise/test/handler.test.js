const { handler } = require('../src/handler.js');
const { getFilters } = require('../src/service.js');

jest.mock('../src/service.js');

function createAuthorizer(username, markets, role) {
  return {
    claims: {
      ntt_context: JSON.stringify({
        username: username,
        markets: markets,
        role: role
      })
    }
  };
}

describe('handler.js', () => {
  const mockEvent = {
    queryStringParameters: { type: 'dealers', codmarket: '1000', codbrand: '00', codactivity: 'IA', codnation: '39' },
    requestContext: {
      authorizer: createAuthorizer('test', ['1000'], 'ADMINISTRATOR')
    }
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return 200 and data when query parameters are valid', async () => {
    const mockData = {
      success: true,
      data: [
        {
          codmarket: '1000',
          coddealer: '00',
          codmaindealer: 'IA',
          legalentity: '39',
          codlocation: '999',
          oic: '00000000',
          status: '1',
          townname: 'townname',
          address: 'address',
          latitude: 'latitude',
          longitude: 'longitude',
          landtype: 'landtype',
          brandsales: 'brandsales',
          brandservices: 'brandservices',
          brandparts: 'brandparts',
          activitysales: 'activitysales',
          activityservices: 'activityservices',
          activityparts: 'activityparts',
          description: 'description'
        }      
      ]
    };
    getFilters.mockResolvedValueOnce(mockData);

    const response = await handler(mockEvent);
    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual(mockData);
  });

  it('should return 400 when query parameters are not provided', async () => {
    const badEvent = {
      ...mockEvent,
      queryStringParameters: null
    };

    const response = await handler(badEvent);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('BAD_REQUEST');
    expect(body.message).toBeDefined();
  });

  it('should return 400 when query parameters are invalid', async () => {
    const badEvent = {
      ...mockEvent,
      queryStringParameters: { type: 'invalid' }
    };

    const response = await handler(badEvent);

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('BAD_REQUEST');
    expect(body.message).toBeDefined();
  });

  it('should return 401 when either token, claims or claim fields are invalid', async () => {
    const invalidEvents = [
      { requestContext: {} },
      { requestContext: { authorizer: {} } },
      { requestContext: { authorizer: { claims: {} } } },
      { requestContext: { authorizer: { claims: {  ntt_context: 'invalid JSON' } } } },
      { requestContext: { authorizer: { claims: {  ntt_context: JSON.stringify({ invalid: '' }) } } } }
    ];

    for (const event of invalidEvents) {
      const response = await handler(event);
      
      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.statusCode).toBe(401);
      expect(body.error).toBe('UNAUTHORIZED');
      expect(body.message).toBeDefined();

    }
  });

  it('should return 403 when user does not have access to given market', async () => {
    const event = {
      requestContext: {
        authorizer: createAuthorizer('test', ['1000'], 'VIEWER')
      },
      queryStringParameters: { type: 'dealers', codmarket: '3109', codbrand: '00', codactivity: 'IA', codnation: '55' }
    };
    const response = await handler(event);
    expect(response.statusCode).toBe(403);
    const body = JSON.parse(response.body);
    expect(body.statusCode).toBe(403);
    expect(body.error).toBe('FORBIDDEN');
    expect(body.message).toBeDefined();
  });

  it('should return 500 when service throws unexpected error', async () => {
    getFilters.mockRejectedValueOnce(new Error('DB connection failed'));

    const response = await handler(mockEvent);

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.body);
    expect(body.error).toBe('INTERNAL_SERVER_ERROR');
    expect(body.message).toBe('Internal server error');
  });
});
