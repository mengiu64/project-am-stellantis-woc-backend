'use strict';

jest.mock('../src/repositories/s3SessionRepository');
jest.mock('../src/repositories/myPeopleDmsSessionRepository');

const { buildRepository, buildMyPeopleDmsRepository } = require('../src/repositoryFactory');
const { S3SessionRepository } = require('../src/repositories/s3SessionRepository');
const { MyPeopleDmsSessionRepository } = require('../src/repositories/myPeopleDmsSessionRepository');

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

  test('buildMyPeopleDmsRepository ritorna un\'istanza di MyPeopleDmsSessionRepository', () => {
    buildMyPeopleDmsRepository();
    expect(MyPeopleDmsSessionRepository).toHaveBeenCalledTimes(1);
  });

  test('buildMyPeopleDmsRepository inoltra gli overrides a MyPeopleDmsSessionRepository', () => {
    const overrides = { readUserProfilesFn: jest.fn() };
    buildMyPeopleDmsRepository(overrides);
    expect(MyPeopleDmsSessionRepository).toHaveBeenCalledWith(overrides);
  });
});
