'use strict';

const { Readable } = require('stream');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

const { S3SessionRepository } = require('../../src/repositories/s3SessionRepository');
const { SessionNotFoundError } = require('../../src/errors');

function bodyStream(str) {
  return Readable.from([Buffer.from(str, 'utf-8')]);
}

const SAMPLE_DATA = {
  1000: {
    codmarket: '1000',
    oic: '000123456',
    sincom: '0073741',
  },
  3109: {
    codmarket: '3109',
    oic: '000223456',
    sincom: 'SIN00223',
  },
};

describe('S3SessionRepository', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...OLD_ENV, SESSION_BUCKET_NAME: 'my-session-bucket' };
    delete process.env.SESSION_DATA_KEY;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('usa session/session_data.json come chiave di default', () => {
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    expect(repo.dataKey).toBe('session/session_data.json');
  });

  test('consente di sovrascrivere la chiave (dataKey)', () => {
    const repo = new S3SessionRepository({ s3Client: { send: mockSend }, dataKey: 'custom/path.json' });
    expect(repo.dataKey).toBe('custom/path.json');
  });

  test('legge il nome del bucket da SESSION_BUCKET_NAME di default', () => {
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    expect(repo.bucketName).toBe('my-session-bucket');
  });

  test('consente di sovrascrivere esplicitamente il nome del bucket', () => {
    const repo = new S3SessionRepository({ s3Client: { send: mockSend }, bucketName: 'other-bucket' });
    expect(repo.bucketName).toBe('other-bucket');
  });

  test('legge la chiave da SESSION_DATA_KEY quando non sovrascritta', () => {
    process.env.SESSION_DATA_KEY = 'session/custom_data.json';
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    expect(repo.dataKey).toBe('session/custom_data.json');
  });

  test('crea un S3Client di default quando non fornito', () => {
    const repo = new S3SessionRepository();
    expect(repo.s3Client).toBeDefined();
  });

  test('recupera e restituisce solo la sezione del mercato richiesto', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify(SAMPLE_DATA)) });
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    const result = await repo.getSessionData('1000');
    expect(result).toEqual(SAMPLE_DATA['1000']);
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({
      input: { Bucket: 'my-session-bucket', Key: 'session/session_data.json' },
    }));
  });

  test('normalizza il codmarket richiesto in maiuscolo', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify({ '3109': SAMPLE_DATA['3109'] })) });
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    const result = await repo.getSessionData('3109');
    expect(result).toEqual(SAMPLE_DATA['3109']);
  });

  test('lancia SessionNotFoundError quando il mercato non e\' presente nel JSON', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream(JSON.stringify(SAMPLE_DATA)) });
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('9999')).rejects.toThrow(SessionNotFoundError);
  });

  test('lancia un errore descrittivo quando il file non esiste su S3 (NoSuchKey)', async () => {
    const err = new Error('not found');
    err.name = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow(/non trovato nel bucket/);
  });

  test('lancia un errore descrittivo quando S3 restituisce metadata 404', async () => {
    const err = new Error('not found');
    err.$metadata = { httpStatusCode: 404 };
    mockSend.mockRejectedValue(err);
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow(/non trovato nel bucket/);
  });

  test('lancia un errore descrittivo quando S3 restituisce Code NoSuchKey', async () => {
    const err = new Error('not found');
    err.Code = 'NoSuchKey';
    mockSend.mockRejectedValue(err);
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow(/non trovato nel bucket/);
  });

  test('rilancia errori S3 generici', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow('AccessDenied');
  });

  test('lancia un errore descrittivo quando il contenuto non e\' JSON valido', async () => {
    mockSend.mockResolvedValue({ Body: bodyStream('not-json') });
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow(/Contenuto non valido/);
  });

  test('lancia un errore quando SESSION_BUCKET_NAME non e\' configurato', async () => {
    delete process.env.SESSION_BUCKET_NAME;
    const repo = new S3SessionRepository({ s3Client: { send: mockSend } });
    await expect(repo.getSessionData('1000')).rejects.toThrow('SESSION_BUCKET_NAME non configurato');
  });
});
