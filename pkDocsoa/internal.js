'use strict';

const { handleInternal } = require('../serviceClient');
const { DocSOARestClient } = require('./DocSOARestClient');

const operations = Object.fromEntries([
  'getCompletePkSOAList', 'ibxDetailForfaitService', 'ibxDetailtpService',
].map((name) => [name, (payload) => new DocSOARestClient()[name](payload.params)]));
exports.handler = (event) => handleInternal(event, 'pkdocsoa', operations);
