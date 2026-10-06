'use strict';

const { handleInternal, requireArgs } = require('../serviceClient');
const { getPool } = require('./db');
const snowflakes = require('./AnagSnowflakesRepository');
const hq = require('./HqRepository');
const { getPkwstouse } = require('./PkConfigRepository');
const { getConfigPackages } = require('./ConfigPackagesRepository');

const poolOperations = {
  getPkwstouse, getConfigPackages,
  getCountryIsoCode: snowflakes.getCountryIsoCode,
  getPhysicalSiteAndSincom: snowflakes.getPhysicalSiteAndSincom,
  getPhysicalSiteAndPdvId: snowflakes.getPhysicalSiteAndPdvId,
  getBrandsByOics: snowflakes.getBrandsByOics,
  getMarkets: snowflakes.getMarkets,
  getEnablingConfiguration: hq.getEnablingConfiguration,
  setEnablingConfiguration: hq.setEnablingConfiguration,
  importAppConfiguration: hq.importAppConfiguration,
  getAppConfigurationList: hq.getAppConfigurationList,
  getVehicleInspection: hq.getVehicleInspection,
  setVehicleInspectionVisible: hq.setVehicleInspectionVisible,
  deletetVehicleInspection: hq.deletetVehicleInspection,
  insertVehicleInspection: hq.insertVehicleInspection,
  cloneVeicInspection: hq.cloneVeicInspection,
  getDisabledOics: hq.getDisabledOics,
  getEnableSignatureByOics: hq.getEnableSignatureByOics,
  getAddressByOics: hq.getAddressByOics,
  setPkMarketEnable: hq.setPkMarketEnable,
  setPkMarketDisable: hq.setPkMarketDisable,
  checkIsPkMarketEnabled: hq.checkIsPkMarketEnabled,
  insertDomain: hq.insertDomain,
  deleteOicPkHierarchy: hq.deleteOicPkHierarchy,
  setDomain: hq.setDomain,
  deleteDomain: hq.deleteDomain,
  setDomainVisible: hq.setDomainVisible,
  insertPackage: hq.insertPackage,
  setPackage: hq.setPackage,
  deletePackage: hq.deletePackage,
  setPackageVisible: hq.setPackageVisible,
  getPackageListHQ: hq.getPackageListHQ,
  getPackageListSM: hq.getPackageListSM,
  clonePk: hq.clonePk,
  insertAudit: hq.insertAudit,
  searchAudit: hq.searchAudit,
};
const operations = Object.fromEntries(Object.entries(poolOperations).map(([name, fn]) => [
  name, async (payload) => {
    const args = requireArgs(payload);
    const result = await fn(await getPool(), ...args);
    return result instanceof Map || result instanceof Set ? [...result] : result;
  },
]));
operations.getAnagSection = () => hq.getAnagSection();
operations.getAnagAllocation = () => hq.getAnagAllocation();
operations.getBrandLogos = async (payload) => {
  const [params] = requireArgs(payload);
  const codes = params?.codes;
  if (!Array.isArray(codes)) {
    const error = new Error('"codes" is required (array)');
    error.statusCode = 400;
    throw error;
  }
  if (codes.length === 0) return {};
  const pool = await getPool();
  const { rows } = await pool.query({
    text: 'SELECT codbrand, logo_s3_key FROM woc.anag_brand WHERE codbrand = ANY($1::varchar[])',
    values: [codes], statement_timeout: 5000,
  });
  return Object.fromEntries(rows.filter((row) => row.logo_s3_key && String(row.logo_s3_key).trim())
    .map((row) => [row.codbrand, row.logo_s3_key]));
};
exports.handler = (event) => handleInternal(event, 'dbmanager', operations);
