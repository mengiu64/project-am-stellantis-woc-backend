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
  deletetVehicleInspection: jest.fn(),
  insertVehicleInspection: jest.fn(),
  setMarketEnable: jest.fn(),
  setMarketDisable: jest.fn(),
  setOicEnable: jest.fn(),
  insertDomain: jest.fn(),
  setDomain: jest.fn(),
  deleteDomain: jest.fn(),
  setDomainVisible: jest.fn(),
  insertPackage: jest.fn(),
  setPackage: jest.fn(),
  deletePackage: jest.fn(),
  setPackageVisible: jest.fn(),
  getPackageList: jest.fn(),
  insertAudit: jest.fn(),
  searchAudit: jest.fn(),
  getAnagSection: jest.fn(),
  getAnagAllocation: jest.fn(),
}));

const { getPool } = require('../../dbManager/db');
const {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspection,
  insertVehicleInspection,
  setMarketEnable,
  setMarketDisable,
  setOicEnable,
  insertDomain,
  setDomain,
  deleteDomain,
  setDomainVisible,
  insertPackage,
  setPackage,
  deletePackage,
  setPackageVisible,
  getPackageList,
  insertAudit,
  searchAudit,
  getAnagSection,
  getAnagAllocation,
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
    it('throws when configurations is missing/empty', async () => {
      await expect(manager.setEnablingConfiguration(undefined)).rejects.toThrow('"configurations" is required');
      await expect(manager.setEnablingConfiguration([])).rejects.toThrow('"configurations" is required');
      expect(getPool).not.toHaveBeenCalled();
    });

    it('resolves the pool once and delegates to HqRepository.setEnablingConfiguration for each element, with insertAudit and username from event.requestContext.authorizer.sub', async () => {
      setEnablingConfiguration.mockResolvedValue(undefined);
      insertAudit.mockResolvedValue(undefined);

      await manager.setEnablingConfiguration([
        { codmarket: '1000', oic: '00000989', enableWOC: 1, enableSignature: 1 },
        { codmarket: '1000', oic: '00010925', enableWOC: 1, enableSignature: 0 },
      ], { requestContext: { authorizer: { sub: 'mario.rossi' } } });

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setEnablingConfiguration).toHaveBeenCalledTimes(2);
      expect(setEnablingConfiguration).toHaveBeenNthCalledWith(1, fakePool, '1000', '00000989', 1, 1);
      expect(setEnablingConfiguration).toHaveBeenNthCalledWith(2, fakePool, '1000', '00010925', 1, 0);
      expect(insertAudit).toHaveBeenCalledTimes(2);
      expect(insertAudit).toHaveBeenNthCalledWith(1, fakePool, 'mario.rossi', 'enablingConfiguration', '1000', 'update', 'enableWOC: 1 enableSignature:1');
      expect(insertAudit).toHaveBeenNthCalledWith(2, fakePool, 'mario.rossi', 'enablingConfiguration', '1000', 'update', 'enableWOC: 1 enableSignature:0');
    });

    it('uses username=null when the event has no requestContext.authorizer.sub (e.g. CLI/direct invocation)', async () => {
      setEnablingConfiguration.mockResolvedValue(undefined);
      insertAudit.mockResolvedValue(undefined);

      await manager.setEnablingConfiguration([
        { codmarket: '1000', oic: '00000989', enableWOC: 1, enableSignature: 1 },
      ]);

      expect(insertAudit).toHaveBeenCalledWith(fakePool, null, 'enablingConfiguration', '1000', 'update', 'enableWOC: 1 enableSignature:1');
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
    it('throws when the payload has none of the known array keys', async () => {
      await expect(manager.setVehicleInspectionVisible({})).rejects.toThrow(
        '"payload" must contain an array in one of: conditions, equipment, damagearea, receptions, vehicleconfiguration',
      );
      expect(getPool).not.toHaveBeenCalled();
    });

    it('resolves the pool once and delegates to HqRepository.setVehicleInspectionVisible for each element of "conditions"', async () => {
      setVehicleInspectionVisible.mockResolvedValue(undefined);

      await manager.setVehicleInspectionVisible({
        conditions: [{ id: 7, value: 0 }, { id: 8, value: 1 }],
      });

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setVehicleInspectionVisible).toHaveBeenCalledTimes(2);
      expect(setVehicleInspectionVisible).toHaveBeenNthCalledWith(1, fakePool, 7, 0);
      expect(setVehicleInspectionVisible).toHaveBeenNthCalledWith(2, fakePool, 8, 1);
    });

    it.each(['equipment', 'damagearea', 'receptions', 'vehicleconfiguration'])(
      'also accepts the "%s" array key',
      async (key) => {
        setVehicleInspectionVisible.mockResolvedValue(undefined);

        await manager.setVehicleInspectionVisible({ [key]: [{ id: 1, value: 1 }] });

        expect(setVehicleInspectionVisible).toHaveBeenCalledWith(fakePool, 1, 1);
      },
    );
  });

  describe('deletetVehicleInspection', () => {
    it('resolves the pool and delegates to HqRepository.deletetVehicleInspection', async () => {
      deletetVehicleInspection.mockResolvedValue(undefined);

      await manager.deletetVehicleInspection(1, 1);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(deletetVehicleInspection).toHaveBeenCalledWith(fakePool, 1, 1);
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

  describe('setDomainVisible', () => {
    it('throws when payload.domain is missing/empty', async () => {
      await expect(manager.setDomainVisible({})).rejects.toThrow('"domain" is required');
      await expect(manager.setDomainVisible({ domain: [] })).rejects.toThrow('"domain" is required');
      expect(getPool).not.toHaveBeenCalled();
    });

    it('resolves the pool once and delegates to HqRepository.setDomainVisible for each element', async () => {
      setDomainVisible.mockResolvedValue(undefined);

      await manager.setDomainVisible({
        domain: [{ iddomain: 7, value: 0 }, { iddomain: 8, value: 1 }],
      });

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setDomainVisible).toHaveBeenCalledTimes(2);
      expect(setDomainVisible).toHaveBeenNthCalledWith(1, fakePool, 7, 0);
      expect(setDomainVisible).toHaveBeenNthCalledWith(2, fakePool, 8, 1);
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

  describe('deletePackage', () => {
    it('resolves the pool and delegates to HqRepository.deletePackage', async () => {
      deletePackage.mockResolvedValue(undefined);

      await manager.deletePackage(7);

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(deletePackage).toHaveBeenCalledWith(fakePool, 7);
    });
  });

  describe('setPackageVisible', () => {
    it('throws when payload.package is missing/empty', async () => {
      await expect(manager.setPackageVisible({})).rejects.toThrow('"package" is required');
      await expect(manager.setPackageVisible({ package: [] })).rejects.toThrow('"package" is required');
      expect(getPool).not.toHaveBeenCalled();
    });

    it('resolves the pool once and delegates to HqRepository.setPackageVisible for each element', async () => {
      setPackageVisible.mockResolvedValue(undefined);

      await manager.setPackageVisible({
        package: [{ idpackage: 7, value: 0 }, { idpackage: 8, value: 1 }],
      });

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(setPackageVisible).toHaveBeenCalledTimes(2);
      expect(setPackageVisible).toHaveBeenNthCalledWith(1, fakePool, 7, 0);
      expect(setPackageVisible).toHaveBeenNthCalledWith(2, fakePool, 8, 1);
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

  describe('insertAudit', () => {
    it('resolves the pool and delegates to HqRepository.insertAudit', async () => {
      insertAudit.mockResolvedValue(undefined);

      await manager.insertAudit('mario.rossi', 'domain', '1000', 'create', 'Nuovo dominio');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(insertAudit).toHaveBeenCalledWith(fakePool, 'mario.rossi', 'domain', '1000', 'create', 'Nuovo dominio');
    });
  });

  describe('searchAudit', () => {
    it('resolves the pool and delegates to HqRepository.searchAudit', async () => {
      const audits = [{
        id: 1, username: 'mario.rossi', creationdate: '2024-01-01', section: 'domain', market: '1000', actiontype: 'create', descr: 'Nuovo dominio',
      }];
      searchAudit.mockResolvedValue(audits);

      const result = await manager.searchAudit('1000', 'domain', '2024-01-01', '2024-12-31', 'create');

      expect(getPool).toHaveBeenCalledTimes(1);
      expect(searchAudit).toHaveBeenCalledWith(fakePool, '1000', 'domain', '2024-01-01', '2024-12-31', 'create');
      expect(result).toBe(audits);
    });
  });

  describe('getAnagSection', () => {
    it('delegates to HqRepository.getAnagSection without resolving a pool', async () => {
      const sections = [{ section: 'domain' }, { section: 'conditions' }];
      getAnagSection.mockResolvedValue(sections);

      const result = await manager.getAnagSection();

      expect(getPool).not.toHaveBeenCalled();
      expect(getAnagSection).toHaveBeenCalledWith();
      expect(result).toBe(sections);
    });
  });

  describe('getAnagAllocation', () => {
    it('delegates to HqRepository.getAnagAllocation without resolving a pool', async () => {
      const allocations = [{ type: 'create' }, { type: 'update' }];
      getAnagAllocation.mockResolvedValue(allocations);

      const result = await manager.getAnagAllocation();

      expect(getPool).not.toHaveBeenCalled();
      expect(getAnagAllocation).toHaveBeenCalledWith();
      expect(result).toBe(allocations);
    });
  });
});
