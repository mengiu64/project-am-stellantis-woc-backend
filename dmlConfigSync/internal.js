'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { getPool } = require('./db');
const { getDmlConfiguration } = require('./DmlConfigRepository');
const { getDmsSettings, registerDealer } = require('./DmsSettingsRepository');

const operations = Object.fromEntries(Object.entries({
  getDmlConfiguration, getDmsSettings, registerDealer,
}).map(([name, fn]) => [name, async (payload) => {
  const args = requireArgs(payload);
  return fn(await getPool(), ...args);
}]));
exports.handler = (event) => handleInternal(event, 'dmlconfigsync', operations);
