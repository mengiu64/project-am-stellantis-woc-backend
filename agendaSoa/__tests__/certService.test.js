'use strict';

const { Readable } = require('stream');

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: mockSend })),
    GetObjectCommand: jest.fn().mockImplementation((input) => ({ input })),
  };
});

const { getHttpsAgent, _resetCache } = require('../src/certService');

function bodyStream(str) {
  return Readable.from([Buffer.from(str, 'utf-8')]);
}

describe('certService (agendaSoa)', () => {
  const OLD_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetCache();
    process.env = { ...OLD_ENV };
    delete process.env.AGENDA_SOA_CERT_BUCKET;
    delete process.env.AGENDA_SOA_CERT;
    delete process.env.AGENDA_SOA_KEY;
    delete process.env.AGENDA_SOA_KEY_PASSPHRASE;
  });

  afterAll(() => {
    process.env = OLD_ENV;
  });

  test('returns undefined when AGENDA_SOA_CERT_BUCKET is not configured', async () => {
    const agent = await getHttpsAgent({ s3Client: { send: mockSend } });
    expect(agent).toBeUndefined();
    expect(mockSend).not.toHaveBeenCalled();
  });

  test('returns undefined when cert/key keys are not configured', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    const agent = await getHttpsAgent({ s3Client: { send: mockSend } });
    expect(agent).toBeUndefined();
  });

  test('fetches cert and key from S3 and builds an https.Agent', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    process.env.AGENDA_SOA_CERT = 'certs/mwpaga0a.cer';
    process.env.AGENDA_SOA_KEY = 'certs/mwpaga0a.key';

    mockSend.mockImplementation((cmd) => {
      if (cmd.input.Key === 'certs/mwpaga0a.cer') {
        return Promise.resolve({ Body: bodyStream('CERT-CONTENT') });
      }
      return Promise.resolve({ Body: bodyStream('KEY-CONTENT') });
    });

    const agent = await getHttpsAgent({ s3Client: { send: mockSend } });

    expect(agent).toBeDefined();
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'certs/mwpaga0a.cer' } })
    );
    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ input: { Bucket: 'my-bucket', Key: 'certs/mwpaga0a.key' } })
    );
  });

  test('applies AGENDA_SOA_KEY_PASSPHRASE when configured', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    process.env.AGENDA_SOA_CERT = 'certs/mwpaga0a.cer';
    process.env.AGENDA_SOA_KEY = 'certs/mwpaga0a.key';
    process.env.AGENDA_SOA_KEY_PASSPHRASE = 'secret';

    mockSend.mockResolvedValue({ Body: bodyStream('X') });

    const agent = await getHttpsAgent({ s3Client: { send: mockSend } });
    expect(agent.options.passphrase).toBe('secret');
  });

  test('caches the agent so S3 is only called once across multiple invocations', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    process.env.AGENDA_SOA_CERT = 'certs/mwpaga0a.cer';
    process.env.AGENDA_SOA_KEY = 'certs/mwpaga0a.key';
    mockSend.mockResolvedValue({ Body: bodyStream('X') });

    const agent1 = await getHttpsAgent({ s3Client: { send: mockSend } });
    const agent2 = await getHttpsAgent({ s3Client: { send: mockSend } });

    expect(agent1).toBe(agent2);
    expect(mockSend).toHaveBeenCalledTimes(2); // 1 cert + 1 key, not called again for 2nd invocation
  });

  test('clears the cache and allows retry when S3 fails', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    process.env.AGENDA_SOA_CERT = 'certs/mwpaga0a.cer';
    process.env.AGENDA_SOA_KEY = 'certs/mwpaga0a.key';
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    await expect(getHttpsAgent({ s3Client: { send: mockSend } })).rejects.toThrow('AccessDenied');

    mockSend.mockReset();
    mockSend.mockResolvedValue({ Body: bodyStream('X') });
    const agent = await getHttpsAgent({ s3Client: { send: mockSend } });
    expect(agent).toBeDefined();
  });

  test('creates a default S3Client when none is provided', async () => {
    process.env.AGENDA_SOA_CERT_BUCKET = 'my-bucket';
    process.env.AGENDA_SOA_CERT = 'certs/mwpaga0a.cer';
    process.env.AGENDA_SOA_KEY = 'certs/mwpaga0a.key';
    const { S3Client } = require('@aws-sdk/client-s3');
    mockSend.mockResolvedValue({ Body: bodyStream('X') });

    const agent = await getHttpsAgent();
    expect(S3Client).toHaveBeenCalled();
    expect(agent).toBeDefined();
  });
});
