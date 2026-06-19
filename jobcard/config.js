'use strict';

module.exports = {
  // PingFederate token endpoint
  auth: {
    url: 'https://idfed-preprod.mpsa.com:443/as/token.oauth2',
    grantType: 'client_credentials',
    scope: 'prd:dgt',
    clientId: '***REMOVED***',
    clientSecret: '***REMOVED***',
  },

  // Stellantis DGT API
  dgt: {
    baseUrl: 'https://emea-aws.stage.np-api.stellantis.com',
    basePath: '/ps-stage/extra/srp/digital-layer/v1',
    clientId: '***REMOVED***',
    clientSecret: '***REMOVED***',
  },
};
