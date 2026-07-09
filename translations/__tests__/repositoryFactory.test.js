'use strict';

jest.mock('../src/repositories/S3TranslationsRepository');

const { buildRepository } = require('../src/repositoryFactory');
const { S3TranslationsRepository } = require('../src/repositories/S3TranslationsRepository');

describe('repositoryFactory', () => {
  afterEach(() => jest.clearAllMocks());

  test('buildRepository returns an S3TranslationsRepository instance', () => {
    buildRepository();
    expect(S3TranslationsRepository).toHaveBeenCalledTimes(1);
  });

  test('buildRepository forwards overrides to S3TranslationsRepository', () => {
    const overrides = { bucketName: 'custom-bucket' };
    buildRepository(overrides);
    expect(S3TranslationsRepository).toHaveBeenCalledWith(overrides);
  });
});
