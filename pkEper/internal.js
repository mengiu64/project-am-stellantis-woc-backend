'use strict';

const { handleInternal } = require('../serviceClient');
const { WsIQPckEper } = require('./WsIQPckEper');

const operations = Object.fromEntries(['getCompletePkEperList', 'getPackageDetailsPR'].map((name) => [
  name, (payload) => new WsIQPckEper({
    coddealer: payload.config?.coddealer, codmarket: payload.config?.codmarket,
  })[name](payload.params),
]));
exports.handler = (event) => handleInternal(event, 'pkeper', operations);
