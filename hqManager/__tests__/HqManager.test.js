'use strict';

// HqManager.js richiede dbManager/db e dbManager/HqRepository dinamicamente con
// path.resolve(__dirname, '../dbManager/...'), che risolve allo stesso file
// assoluto raggiunto da qui con '../../dbManager/...' — stesso pattern di mock
// gia' usato in pkManager/__tests__/PkManager.test.js.
jest.mock('../../dbManager/db', () => ({ getPool: jest.fn() }));
jest.mock('../../dbManager/HqRepository', () => ({
  getEnablingConfiguration: jest.fn(),
  setEnablingConfiguration: jest.fn(),
}));

const { getPool } = require('../../dbManager/db');
const { getEnablingConfiguration, setEnablingConfiguration } = require('../../dbManager/HqRepository');
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
});
