'use strict';

const { handleInternal } = require('../serviceClient');
const { getBearerToken } = require('./authService');
const {
  getDmsSettings, getCompanyTypes, getCustomerTitles, postDmsInquiry, resolveDynamicSenderFields,
} = require('./dmsService');

const upstream = {
  settings: getDmsSettings, 'company-types': getCompanyTypes,
  'customer-titles': getCustomerTitles, inquiry: postDmsInquiry,
};
const operations = Object.fromEntries(Object.entries(upstream).map(([name, fn]) => [
  name, async (payload) => fn(await getBearerToken(), payload),
]));
operations.resolveSender = (payload) => resolveDynamicSenderFields(payload.context, payload.overrides);
exports.handler = (event) => handleInternal(event, 'dms', operations);
