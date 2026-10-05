'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { getCachedBrand } = require('./v360Service');
const { S3ConfigRepository } = require('./s3ConfigRepository');
const repository = new S3ConfigRepository();

exports.handler = (event) => handleInternal(event, 'v360', {
  getBrand: (payload) => getCachedBrand(...requireArgs(payload)),
  getBrandOwners: () => repository.getBrandOwners(),
});
