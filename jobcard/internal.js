'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { getBearerToken } = require('./authService');
const { getJobCardDetails } = require('./jobCardService');

exports.handler = (event) => handleInternal(event, 'jobcard', {
  getJobCardDetails: async (payload) => {
    const args = requireArgs(payload);
    return getJobCardDetails(await getBearerToken(), ...args);
  },
});
