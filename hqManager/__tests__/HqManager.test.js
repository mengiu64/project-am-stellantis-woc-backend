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
}));

const { getPool } = require('../../dbManager/db');
const {
  getEnablingConfiguration,
  setEnablingConfiguration,
  getVehicleInspection,
  setVehicleInspectionVisible,
  deletetVehicleInspectionVisible,
  insertVehicleInspection,
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
});
