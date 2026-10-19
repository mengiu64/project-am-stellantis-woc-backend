'use strict';

const { Readable } = require('stream');
const { S3TranslationFileReader } = require('../../src/repositories/S3TranslationFileReader');

const body = (text) => Readable.from([Buffer.from(text), 'extra'.slice(0, 0)]);

describe('S3TranslationFileReader', () => {
  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  test('legge e parsa il JSON con VersionId, ignorando il BOM', async () => {
    const send = jest.fn().mockResolvedValue({ Body: body('\uFEFF{"a":{"b":"c"}}') });
    const out = await new S3TranslationFileReader({ s3Client: { send } }).readJson({ bucket: 'b', key: 'k', versionId: 'v1' });
    expect(out).toEqual({ a: { b: 'c' } });
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'b', Key: 'k', VersionId: 'v1' });
  });

  test('senza versionId non lo invia; accetta chunk stringa', async () => {
    const send = jest.fn().mockResolvedValue({ Body: Readable.from(['{"a":', '1}']) });
    await new S3TranslationFileReader({ s3Client: { send } }).readJson({ bucket: 'b', key: 'k' });
    expect(send.mock.calls[0][0].input).toEqual({ Bucket: 'b', Key: 'k' });
  });

  test('propaga gli errori S3', async () => {
    const send = jest.fn().mockRejectedValue(new Error('AccessDenied'));
    await expect(new S3TranslationFileReader({ s3Client: { send } }).readJson({ bucket: 'b', key: 'k' })).rejects.toThrow('AccessDenied');
  });

  test('JSON non valido -> errore', async () => {
    const send = jest.fn().mockResolvedValue({ Body: body('{oops') });
    await expect(new S3TranslationFileReader({ s3Client: { send } }).readJson({ bucket: 'b', key: 'k' })).rejects.toThrow(/non valido/);
  });

  test('crea un S3Client di default', () => {
    expect(new S3TranslationFileReader().s3Client).toBeDefined();
  });
});
