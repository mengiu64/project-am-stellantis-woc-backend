const { getValidToken, invalidateToken } = require('./auth.js');
const { httpsPost } = require('./http.js');
const { logger } = require('./logger.js');
const {
  NTTError,
  NTTInternalServerError,
  ERROR_CODE
} = require('./responseHelper.js');
const { getSecretConfig, getURLParameter } = require('./secrets.js');

const INPUT_TYPE = {
  dealers: 'getDealers',
  dealer_locations: 'getDealerLocations'
};

const newSiteCode = {
  codmarket: '',
  coddealer: '',
  codmaindealer: '',
  legalentity: '',
  codlocation: '999',
  oic: '00000000',
  status: '',
  townname: '',
  address: '',
  latitude: '',
  longitude: '',
  landtype: '',
  brandsales: null,
  brandservices: '',
  brandparts: null,
  activitysales: null,
  activityservices: '',
  activityparts: null,
  description: 'NEW SITE CODE'
};

function mapDealers(data, startrecord, maxrecord) {
  const totalrows = data.length > 0 ? parseInt(data[0].totalrow, 10) : 0;
  const items = data.map(({ totalrow: _totalrow, ...rest }) => rest);
  return { items, pagination: { startrecord, maxrecord, totalrows } };
}

function mapDealerLocations(data, comtype) {
  const items = data.map((l) => ({
    ...l,
    description: `${l.oic} - ${l.townname} - ${l.address}`
  }));

  if (comtype === 'AP') {
    items.unshift({ ...newSiteCode });
  }

  return { items };
}

async function callService(onPremiseConfig, accessToken, body, authConfig) {
  try {
    const { url, client_id, client_secret } = onPremiseConfig;
    const payload = JSON.stringify(body);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'x-ibm-client-id': client_id,
      'x-ibm-client-secret': client_secret
    };

    logger.info('Calling on-prem service..');
    let response = await httpsPost(url, { headers }, payload);


    // Retry once on 401 — token was valid locally but rejected upstream
    if (response.status === 401) {
      logger.warn('Token rejected (401). Forcing refresh and retrying...');
      invalidateToken();
      const newToken = await getValidToken(authConfig);
      response = await httpsPost(
        url,
        { headers: { ...headers, Authorization: `Bearer ${newToken}` } },
        payload
      );
    }

    if (response.status !== 200) {
      throw new NTTError(ERROR_CODE.CLIENT_ERROR, response.status, response.data);
    }

    return response.data;
  } catch (error) {
    if (error instanceof NTTError) {
      throw error;
    }

    if (error.name === 'TimeoutError') {
      logger.error('Upstream service timeout', error);
      throw new NTTInternalServerError('Upstream service timeout');
    }

    logger.error('Unexpected error while calling on-prem service', error);
    throw new NTTInternalServerError('Internal server error');
  }
}

async function getFilters(queryParams) {
  const { SECRET_CREDENTIALS, APIC_URL_PARAMETER } = process.env;

  if (!SECRET_CREDENTIALS) {
    logger.error('Missing SECRET_CREDENTIALS env variable');
    throw new NTTInternalServerError('Internal server error');
  }

  if (!APIC_URL_PARAMETER) {
    logger.error('Missing APIC_URL_PARAMETER env variable');
    throw new NTTInternalServerError('Internal server error');
  }

  const secrets = await getSecretConfig(SECRET_CREDENTIALS);
  const apicUrl = await getURLParameter(APIC_URL_PARAMETER);

  const authConfig = { url: secrets.url, client_id: secrets.pingfederate_client_id, client_secret: secrets.pingfederate_client_secret, scope: secrets.scope };
  const onPremiseConfig = { url: apicUrl, client_id: secrets.apic_client_id, client_secret: secrets.apic_client_secret };

  const accessToken = await getValidToken(authConfig);

  const { type, comtype, ...rest } = queryParams;
  const body = { action: INPUT_TYPE[type], inputData: { ...rest, ...(process.env.DB_DEBUG ? { DB_DEBUG: process.env.DB_DEBUG } : {}) } };

  const result = await callService(onPremiseConfig, accessToken, body, authConfig);

  const mappedData = type === 'dealer_locations' ? mapDealerLocations(result.data, comtype) : mapDealers(result.data, rest.startrecord, rest.maxrecord);

  return {
    success: result.success,
    data: mappedData.items,
    ...(mappedData.pagination && { pagination: mappedData.pagination }),
    ...(result.message !== null && { message: result.message })
  };
}


module.exports = { getFilters };