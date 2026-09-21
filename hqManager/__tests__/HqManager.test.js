'use strict';

// HqManager.js richiede dbManager/db e dbManager/HqRepository dinamicamente con
// path.resolve(__dirname, '../dbManager/...'), che risolve allo stesso file
// assoluto raggiunto da qui con '../../dbManager/...' — stesso pattern di mock
// gia' usato in pkManager/__tests__/PkManager.test.js.
jest.mock('../../dbManager/db', () => ({ getPool: jest.fn() }));
jest.mock('../../dbManager/HqRepository', () => ({
  getEnablingConfiguration: jest.fn(),
  setEnablingConfiguration: jest.fn(),
  getVehicleInspection: jest.fn(),
  setVehicleInspectionVisible: jest.fn(),
  deletetVehicleInspectionVisible: jest.fn(),
  insertVehicleInspection: jest.fn(),
  setMarketEnable: jest.fn(),
  setMarketDisable: jest.fn(),
  setOicEnable: jest.fn(),
  insertDomain: jest.fn(),
  setDomain: jest.fn(),
  deleteDomain: jest.fn(),
  insertPackage: jest.fn(),
  setPackage: jest.fn(),
  getPackageList: jest.fn(),
}));

const { getPool } = require('../../dbManager/db');
const {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspectionVisible,
  insertVehicleInspection,
  setMarketEnable,
  setMarketDisable,
  setOicEnable,
  insertDomain,
  setDomain,
  deleteDomain,
  insertPackage,
  setPackage,
  getPackageList,
} = require('../../dbManager/HqRepository');
const { HqManager } = require('../HqManager');

describe('HqManager', () => {
  let manager;
  const fakePool = { query: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    getPool.mockResolvedValue(fakePool);
    manager = new HqManager();
  });

  describe('getEnablingConfiguration', () => {
    it('resolves the pool and delegates to HqRepository.getEnablingConfiguration', async () => {
      const rows = [
        { siteName: 'BRANDINI S.P.A.', oic: '00006821', address: 'VIA COPERNICO 123', legalEntity: '0073741', enableWOC: 1, enableSignature: 0 },
      ];
      getEnablingConfiguration.mockResolvedValue(rows);

      const result = await manager.getEnablingConfiguration('1000');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(getEnablingConfiguration).toHaveBeenCalledWith(fakePool, '1000');
      expect(result).toBe(rows);
    });
  });

  describe('setEnablingConfiguration', () => {
    it('resolves the pool and delegates to HqRepository.setEnablingConfiguration', async () => {
      setEnablingConfiguration.mockResolvedValue(undefined);

      await manager.setEnablingConfiguration('1000', '00006821', 1, 0);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setEnablingConfiguration).toHaveBeenCalledWith(fakePool, '1000', '00006821', 1, 0);
    });
  });

  describe('getVehicleInspection', () => {
    it('resolves the pool and delegates to HqRepository.getVehicleInspection', async () => {
      const rows = [{ id: 1, market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria', visible: 1, deleted: 0 }];
      getVehicleInspection.mockResolvedValue(rows);

      const result = await manager.getVehicleInspection('1000', 'EXTERIOR');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(getVehicleInspection).toHaveBeenCalledWith(fakePool, '1000', 'EXTERIOR');
      expect(result).toBe(rows);
    });
  });

  describe('setVehicleInspectionVisible', () => {
    it('resolves the pool and delegates to HqRepository.setVehicleInspectionVisible', async () => {
      setVehicleInspectionVisible.mockResolvedValue(undefined);

      await manager.setVehicleInspectionVisible(1, 1);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setVehicleInspectionVisible).toHaveBeenCalledWith(fakePool, 1, 1);
    });
  });

  describe('deletetVehicleInspectionVisible', () => {
    it('resolves the pool and delegates to HqRepository.deletetVehicleInspectionVisible', async () => {
      deletetVehicleInspectionVisible.mockResolvedValue(undefined);

      await manager.deletetVehicleInspectionVisible(1, 1);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(deletetVehicleInspectionVisible).toHaveBeenCalledWith(fakePool, 1, 1);
    });
  });

  describe('insertVehicleInspection', () => {
    it('resolves the pool and delegates to HqRepository.insertVehicleInspection', async () => {
      insertVehicleInspection.mockResolvedValue(undefined);

      await manager.insertVehicleInspection('1000', 'EXTERIOR', 'Controllo carrozzeria');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(insertVehicleInspection).toHaveBeenCalledWith(fakePool, '1000', 'EXTERIOR', 'Controllo carrozzeria');
    });
  });

  describe('setMarketEnable', () => {
    it('resolves the pool and delegates to HqRepository.setMarketEnable', async () => {
      setMarketEnable.mockResolvedValue(undefined);

      await manager.setMarketEnable('1000');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setMarketEnable).toHaveBeenCalledWith(fakePool, '1000');
    });
  });

  describe('setMarketDisable', () => {
    it('resolves the pool and delegates to HqRepository.setMarketDisable', async () => {
      setMarketDisable.mockResolvedValue(undefined);

      await manager.setMarketDisable('1000');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setMarketDisable).toHaveBeenCalledWith(fakePool, '1000');
    });
  });

  describe('setOicEnable', () => {
    it('resolves the pool, delegates to HqRepository.setOicEnable and cascades a setMarketDisable', async () => {
      setOicEnable.mockResolvedValue(undefined);
      setMarketDisable.mockResolvedValue(undefined);

      await manager.setOicEnable('1000', '00006821');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setOicEnable).toHaveBeenCalledWith(fakePool, '1000', '00006821');
      expect(setMarketDisable).toHaveBeenCalledWith(fakePool, '1000');
    });
  });

  describe('insertDomain', () => {
    it('resolves the pool and delegates to HqRepository.insertDomain', async () => {
      insertDomain.mockResolvedValue(42);

      const result = await manager.insertDomain('1000', '00006821', 'Meccanica');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(insertDomain).toHaveBeenCalledWith(fakePool, '1000', '00006821', 'Meccanica');
      expect(result).toBe(42);
    });
  });

  describe('setDomain', () => {
    it('resolves the pool and delegates to HqRepository.setDomain', async () => {
      setDomain.mockResolvedValue(undefined);

      await manager.setDomain('1000', 42, 'Meccanica');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setDomain).toHaveBeenCalledWith(fakePool, '1000', 42, 'Meccanica');
    });
  });

  describe('deleteDomain', () => {
    it('resolves the pool and delegates to HqRepository.deleteDomain', async () => {
      deleteDomain.mockResolvedValue(undefined);

      await manager.deleteDomain('1000', 42);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(deleteDomain).toHaveBeenCalledWith(fakePool, '1000', 42);
    });
  });

  describe('insertPackage', () => {
    it('resolves the pool and delegates to HqRepository.insertPackage', async () => {
      insertPackage.mockResolvedValue(7);

      const result = await manager.insertPackage('1000', '00006821', 42, 'Tagliando', 60, 100.5);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(insertPackage).toHaveBeenCalledWith(fakePool, '1000', '00006821', 42, 'Tagliando', 60, 100.5);
      expect(result).toBe(7);
    });
  });

  describe('setPackage', () => {
    it('resolves the pool and delegates to HqRepository.setPackage', async () => {
      setPackage.mockResolvedValue(undefined);

      await manager.setPackage(7, 42, 'Tagliando', 60, 100.5);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setPackage).toHaveBeenCalledWith(fakePool, 7, 42, 'Tagliando', 60, 100.5);
    });
  });

  describe('getPackageList', () => {
    it('resolves the pool and delegates to HqRepository.getPackageList', async () => {
      const packages = [{
        market: '1000', oic: '00006821', domainDescr: 'Meccanica', idpackage: 7, packageDescr: 'Tagliando', timeop: 60, pricewithvat: 100.5,
      }];
      getPackageList.mockResolvedValue(packages);

      const result = await manager.getPackageList('1000', '00006821');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(getPackageList).toHaveBeenCalledWith(fakePool, '1000', '00006821');
      expect(result).toBe(packages);
    });
  });
});
