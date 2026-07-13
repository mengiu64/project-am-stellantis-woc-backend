'use strict';

jest.mock('../src/repositories/s3SessionRepository');

const { buildRepository } = require('../src/repositoryFactory');
const { S3SessionRepository } = require('../src/repositories/s3SessionRepository');

describe('repositoryFactory', () => {
  afterEach(() => jest.clearAllMocks());

  test('buildRepository ritorna un\'istanza di S3SessionRepository', () => {
    buildRepository();
    expect(S3SessionRepository).toHaveBeenCalledTimes(1);
  });

  test('buildRepository inoltra gli overrides a S3SessionRepository', () => {
    const overrides = { bucketName: 'custom-bucket' };
    buildRepository(overrides);
    expect(S3SessionRepository).toHaveBeenCalledWith(overrides);
  });
});
