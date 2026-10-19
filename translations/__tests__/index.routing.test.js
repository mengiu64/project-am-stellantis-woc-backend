'use strict';

// Routing dell'entry point: evento S3 vs azioni REST (i nuovi handler sono mockati)
jest.mock('../src/handlers/importFromS3', () => ({ handler: jest.fn().mockResolvedValue({ success: true }) }));
jest.mock('../src/handlers/getByLanguage', () => ({ handler: jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' }) }));
jest.mock('../src/handlers/search', () => ({ handler: jest.fn().mockResolvedValue({ statusCode: 200, body: '{}' }) }));

const importFromS3 = require('../src/handlers/importFromS3');
const getByLanguage = require('../src/handlers/getByLanguage');
const search = require('../src/handlers/search');
const { handler, _isS3Event } = require('../index');
const { buildDbRepository, buildFileReader } = require('../src/repositoryFactory');

const s3Event = { Records: [{ eventSource: 'aws:s3', eventName: 'ObjectCreated:Put' }] };

beforeEach(() => jest.clearAllMocks());

describe('routing evento S3', () => {
  test('evento S3 nativo -> import', async () => {
    expect(await handler(s3Event, { ctx: 1 })).toEqual({ success: true });
    expect(importFromS3.handler).toHaveBeenCalledWith(s3Event, { ctx: 1 });
  });

  test('l\'import non e\' raggiungibile da HTTP, azione o body', async () => {
    const forged = { ...s3Event, httpMethod: 'POST', body: '{}' };
    const res = await handler({ ...forged, requestContext: {}, path: '/api/translations/search' });
    expect(importFromS3.handler).not.toHaveBeenCalled();
    expect(search.handler).toHaveBeenCalled();
    expect((await handler({ ...s3Event, action: 'importFromS3' })).statusCode).toBe(400);
    expect(res.statusCode).toBe(200);
  });

  test('_isS3Event', () => {
    expect(_isS3Event(s3Event)).toBe(true);
    expect(_isS3Event(null)).toBe(false);
    expect(_isS3Event({ Records: [] })).toBe(false);
    expect(_isS3Event({ Records: [{ eventSource: 'aws:sqs' }] })).toBe(false);
    expect(_isS3Event({ Records: [null] })).toBe(false);
    expect(_isS3Event({ ...s3Event, httpMethod: 'GET' })).toBe(false);
  });
});

describe('routing REST', () => {
  test('per path /by-language e /search', async () => {
    await handler({ path: '/api/translations/by-language', queryStringParameters: { language: 'en' } }, {});
    expect(getByLanguage.handler).toHaveBeenCalled();
    await handler({ rawPath: '/api/translations/search' }, {});
    expect(search.handler).toHaveBeenCalled();
  });

  test('per event.action', async () => {
    await handler({ action: 'by-language', params: { language: 'en' } }, {});
    expect(getByLanguage.handler).toHaveBeenCalledTimes(1);
  });
});

describe('repositoryFactory (DB e lettore S3)', () => {
  test('costruisce le istanze', () => {
    expect(buildDbRepository({ pool: 'p' }).pool).toBe('p');
    expect(buildFileReader({ s3Client: 's' }).s3Client).toBe('s');
  });
});
