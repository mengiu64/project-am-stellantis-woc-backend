'use strict';

const { handleInternal } = require('../serviceClient');
const { MenuPricingSoapClient } = require('./MenuPricingSoapClient');

const operations = Object.fromEntries(['getCompletePkMpList', 'getJobDetails'].map((name) => [
  name, (payload) => new MenuPricingSoapClient()[name](payload.params),
]));
exports.handler = (event) => handleInternal(event, 'pkmenupricing', operations);
