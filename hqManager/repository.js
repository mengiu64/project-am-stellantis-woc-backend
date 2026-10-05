'use strict';

const OPERATIONS = [
  'getEnablingConfiguration', 'setEnablingConfiguration',
  'getVehicleInspection', 'setVehicleInspectionVisible', 'deletetVehicleInspection',
  'insertVehicleInspection', 'setPkMarketEnable', 'setPkMarketDisable',
  'insertDomain', 'setDomain', 'deleteDomain', 'setDomainVisible',
  'insertPackage', 'setPackage', 'deletePackage', 'setPackageVisible',
  'getPackageListHQ', 'getPackageListSM', 'clonePk', 'cloneVeicInspection', 'insertAudit', 'searchAudit',
  'getAnagSection', 'getAnagAllocation',
  'checkIsPkMarketEnabled', 'deleteOicPkHierarchy',
];

// Nessun pool locale: ogni operazione conserva nome e ordine degli argomenti
// della repository remota, escluso il pool posseduto dal receiver.
module.exports = Object.fromEntries(OPERATIONS.map((operation) => [
  operation,
  async (...args) => {
    const { callService } = require('../serviceClient');
    return callService('dbmanager', operation, { args });
  },
]));
