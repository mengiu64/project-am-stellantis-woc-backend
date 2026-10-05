'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { getCachedSessionData, getCachedSessionContext } = require('./src/sessionContextCache');

exports.handler = (event) => handleInternal(event, 'session', {
  getData: (payload) => getCachedSessionData(...requireArgs(payload)),
  getContext: (payload) => getCachedSessionContext(...requireArgs(payload)),
});
