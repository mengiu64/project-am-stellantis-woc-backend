'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { readUserProfiles } = require('./myPeopleService');

exports.handler = (event) => handleInternal(event, 'mypeople', {
  readUserProfiles: (payload) => readUserProfiles(...requireArgs(payload)),
});
