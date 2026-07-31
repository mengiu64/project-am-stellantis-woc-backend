'use strict';

jest.mock('../../src/repositoryFactory');

const { handler } = require('../../src/handlers/translations');
const { buildRepository } = require('../../src/repositoryFactory');

describe('translations handler', () => {
  let mockRepository;

  beforeEach(() => {
    mockRepository = { getTranslations: jest.fn() };
    buildRepository.mockReturnValue(mockRepository);
  });

  afterEach(() => jest.clearAllMocks());

  test('returns 200 with translations for lang in queryStringParameters', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: { welcome: 'Welcome' } });
    const event = { queryStringParameters: { lang: 'en' } };
    const res = await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('en');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ common: { welcome: 'Welcome' } });
  });

  test('defaults to "en" when lang is not provided', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const res = await handler({ queryStringParameters: {} });
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('en');
    expect(res.statusCode).toBe(200);
  });

  test('reads lang from JSON body', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const event = { body: JSON.stringify({ lang: 'it' }) };
    await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('it');
  });

  test('reads lang from event.params (CLI invocation)', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const event = { params: { lang: 'it' } };
    await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('it');
  });

  test('merges queryStringParameters, body and params (params wins)', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const event = {
      queryStringParameters: { lang: 'en' },
      body: JSON.stringify({ lang: 'fr' }),
      params: { lang: 'it' },
    };
    await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('it');
  });

  test('returns 404 when repository throws TranslationNotFoundError for both requested and fallback lang', async () => {
    const err = new Error('Traduzioni non trovate per la lingua "xx"');
    err.code = 'TRANSLATION_NOT_FOUND';
    mockRepository.getTranslations.mockRejectedValue(err);
    const event = { queryStringParameters: { lang: 'xx' } };
    const res = await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenNthCalledWith(1, 'xx');
    expect(mockRepository.getTranslations).toHaveBeenNthCalledWith(2, 'en');
    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body).success).toBe(false);
    expect(JSON.parse(res.body).message).toBe('Traduzioni non trovate per la lingua "xx"');
  });

  test('falls back to default lang ("en") when the requested lang file is not found', async () => {
    const notFoundErr = new Error('Traduzioni non trovate per la lingua "fr"');
    notFoundErr.code = 'TRANSLATION_NOT_FOUND';
    mockRepository.getTranslations
      .mockRejectedValueOnce(notFoundErr)
      .mockResolvedValueOnce({ common: { welcome: 'Welcome' } });
    const event = { queryStringParameters: { lang: 'fr' } };
    const res = await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenNthCalledWith(1, 'fr');
    expect(mockRepository.getTranslations).toHaveBeenNthCalledWith(2, 'en');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ common: { welcome: 'Welcome' } });
  });

  test('does not retry when the requested lang is already the default lang', async () => {
    const err = new Error('Traduzioni non trovate per la lingua "en"');
    err.code = 'TRANSLATION_NOT_FOUND';
    mockRepository.getTranslations.mockRejectedValue(err);
    const event = { queryStringParameters: { lang: 'en' } };
    const res = await handler(event);
    expect(mockRepository.getTranslations).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(404);
  });

  test('returns 502 on generic repository error', async () => {
    mockRepository.getTranslations.mockRejectedValue(new Error('S3 unreachable'));
    const event = { queryStringParameters: { lang: 'en' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('S3 unreachable');
  });

  test('returns 502 with stringified error when it has no message', async () => {
    mockRepository.getTranslations.mockRejectedValue('boom');
    const event = { queryStringParameters: { lang: 'en' } };
    const res = await handler(event);
    expect(res.statusCode).toBe(502);
    expect(JSON.parse(res.body).message).toBe('boom');
  });

  test('handles event with no queryStringParameters, body, or params', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const res = await handler({});
    expect(res.statusCode).toBe(200);
    expect(mockRepository.getTranslations).toHaveBeenCalledWith('en');
  });

  test('response has Content-Type: application/json header', async () => {
    mockRepository.getTranslations.mockResolvedValue({ common: {} });
    const res = await handler({});
    expect(res.headers['Content-Type']).toBe('application/json');
  });
});
