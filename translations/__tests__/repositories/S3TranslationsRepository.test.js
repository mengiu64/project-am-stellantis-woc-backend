'use strict';

const { Readable } = require('stream');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

const { S3TranslationsRepository } = require('../../src/repositories/S3TranslationsRepository');
const { TranslationNotFoundError } = require('../../src/errors');

function bodyStream(str) {
  return Readable.from([Buffer.from(str, 'utf-8')]);
}

describe('S3TranslationsRepository', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, TRANSLATIONS_BUCKET_NAME: 'my-bucket' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('builds the key as locales/{lang}/translation.json by default', () => {
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    expect(repo.buildKey('en')).toBe('locales/en/translation.json');
  });

  test('allows overriding the key prefix', () => {
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend }, keyPrefix: 'i18n' });
    expect(repo.buildKey('en')).toBe('i18n/en/translation.json');
  });

  test('reads bucket name from TRANSLATIONS_BUCKET_NAME env var by default', () => {
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    expect(repo.bucketName).toBe('my-bucket');
  });

  test('allows overriding the bucket name explicitly', () => {
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend }, bucketName: 'other-bucket' });
    expect(repo.bucketName).toBe('other-bucket');
  });

  test('reads the key prefix from TRANSLATIONS_KEY_PREFIX env var when not overridden', () => {
    process.env.TRANSLATIONS_KEY_PREFIX = 'i18n-env';
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    expect(repo.buildKey('en')).toBe('i18n-env/en/translation.json');
  });

  test('creates a default S3Client when none is provided', () => {
    const repo = new S3TranslationsRepository();
    expect(repo.s3Client).toBeDefined();
  });

  test('fetches and parses the JSON translation file', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify({ common: { welcome: 'Welcome' } })) });
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    const result = await repo.getTranslations('en');
    expect(result).toEqual({ common: { welcome: 'Welcome' } });
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: { Bucket: 'my-bucket', Key: 'locales/en/translation.json' },
    }));
  });

  test('throws TranslationNotFoundError when S3 returns NoSuchKey', async () => {
    const err = new Error('not found');
    err.name = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('xx')).rejects.toThrow(TranslationNotFoundError);
  });

  test('throws TranslationNotFoundError when S3 returns 404 metadata', async () => {
    const err = new Error('not found');
    err.$metadata = { httpStatusCode: 404 };
    mockSend.mockRejectedValue(err);
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('xx')).rejects.toThrow(TranslationNotFoundError);
  });

  test('throws TranslationNotFoundError when S3 returns Code NoSuchKey', async () => {
    const err = new Error('not found');
    err.Code = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('xx')).rejects.toThrow(TranslationNotFoundError);
  });

  test('rethrows generic S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('en')).rejects.toThrow('AccessDenied');
  });

  test('throws a descriptive error when the S3 content is not valid JSON', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream('not-json') });
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('en')).rejects.toThrow(/Contenuto non valido/);
  });

  test('throws when TRANSLATIONS_BUCKET_NAME is not configured', async () => {
    delete process.env.TRANSLATIONS_BUCKET_NAME;
    const repo = new S3TranslationsRepository({ s3Client: { send: mockSend } });
    await expect(repo.getTranslations('en')).rejects.toThrow('TRANSLATIONS_BUCKET_NAME non configurato');
  });
});
