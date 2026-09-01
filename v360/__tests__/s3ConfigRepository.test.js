'use strict';

const { Readable } = require('stream');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

const { S3ConfigRepository } = require('../s3ConfigRepository');

function bodyStream(str) {
  return Readable.from([Buffer.from(str, 'utf-8')]);
}

describe('S3ConfigRepository', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, CONFIG_BUCKET_NAME: 'my-bucket' };
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('builds the key as config/{file} by default', () => {
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    expect(repo.buildKey('brandowner.json')).toBe('config/brandowner.json');
  });

  test('allows overriding the key prefix', () => {
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend }, keyPrefix: 'anagrafiche' });
    expect(repo.buildKey('brandowner.json')).toBe('anagrafiche/brandowner.json');
  });

  test('reads bucket name from CONFIG_BUCKET_NAME env var by default', () => {
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    expect(repo.bucketName).toBe('my-bucket');
  });

  test('allows overriding the bucket name explicitly', () => {
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend }, bucketName: 'other-bucket' });
    expect(repo.bucketName).toBe('other-bucket');
  });

  test('reads the key prefix from CONFIG_KEY_PREFIX env var when not overridden', () => {
    process.env.CONFIG_KEY_PREFIX = 'anagrafiche-env';
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    expect(repo.buildKey('brandowner.json')).toBe('anagrafiche-env/brandowner.json');
  });

  test('creates a default S3Client when none is provided', () => {
    const repo = new S3ConfigRepository();
    expect(repo.s3Client).toBeDefined();
  });

  test('fetches and parses brandowner.json from config/brandowner.json', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify([{ codbrand: 'AC', owner: 'XP' }])) });
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    const result = await repo.getBrandOwners();
    expect(result).toEqual([{ codbrand: 'AC', owner: 'XP' }]);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: { Bucket: 'my-bucket', Key: 'config/brandowner.json' },
    }));
  });

  test('fetches and parses energytype.json from config/energytype.json', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify([{ descr: 'diesel', cod: 'DCD06CD' }])) });
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    const result = await repo.getEnergyTypes();
    expect(result).toEqual([{ descr: 'diesel', cod: 'DCD06CD' }]);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: { Bucket: 'my-bucket', Key: 'config/energytype.json' },
    }));
  });

  test('caches the result in memory and does not call S3 again for the same file', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify([{ codbrand: 'AC', owner: 'XP' }])) });
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await repo.getBrandOwners();
    await repo.getBrandOwners();
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  test('throws a not-found error when S3 returns NoSuchKey', async () => {
    const err = new Error('not found');
    err.name = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getBrandOwners()).rejects.toThrow('non trovato nel bucket');
  });

  test('throws a not-found error when S3 returns 404 metadata', async () => {
    const err = new Error('not found');
    err.$metadata = { httpStatusCode: 404 };
    mockSend.mockRejectedValue(err);
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getEnergyTypes()).rejects.toThrow('non trovato nel bucket');
  });

  test('throws a not-found error when S3 returns Code NoSuchKey', async () => {
    const err = new Error('not found');
    err.Code = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getBrandOwners()).rejects.toThrow('non trovato nel bucket');
  });

  test('rethrows generic S3 errors', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getBrandOwners()).rejects.toThrow('AccessDenied');
  });

  test('throws a descriptive error when the S3 content is not valid JSON', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream('not-json') });
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getBrandOwners()).rejects.toThrow(/Contenuto non valido/);
  });

  test('throws when CONFIG_BUCKET_NAME is not configured', async () => {
    delete process.env.CONFIG_BUCKET_NAME;
    const repo = new S3ConfigRepository({ s3Client: { send: mockSend } });
    await expect(repo.getBrandOwners()).rejects.toThrow('CONFIG_BUCKET_NAME non configurato');
  });
});
