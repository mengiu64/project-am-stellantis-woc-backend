'use strict';

jest.mock('../HqManager', () => ({
  HqManager: jest.fn(),
}));

const { HqManager } = require('../HqManager');
const {
  handler,
  runGetEnablingConfiguration,
  runSetEnablingConfiguration,
  runGetVehicleInspection,
  runSetVehicleInspectionVisible,
  runDeletetVehicleInspectionVisible,
  runInsertVehicleInspection,
  main,
} = require('../index');

function makeManagerInstance(overrides = {}) {
  const instance = {
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
    insertPackage: jest.fn(),
    setPackage: jest.fn(),
    deletePackage: jest.fn(),
    getPackageList: jest.fn(),
    insertAudit: jest.fn(),
    searchAudit: jest.fn(),
    getAnagSection: jest.fn(),
    getAnagAllocation: jest.fn(),
    ...overrides,
  };
  HqManager.mockImplementation(() => instance);
  return instance;
}

describe('hqManager/index.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  describe('handler', () => {
    it('returns 400 when action is missing/unknown', async () => {
      const res = await handler({ action: 'unknownAction', body: {} });
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).success).toBe(false);
    });

    it('dispatches getEnablingConfiguration (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([{ oic: '00006821' }]),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: { codmarket: '1000' } });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, codmarket: '1000', configurations: [{ oic: '00006821' }] });
    });

    it('dispatches setEnablingConfiguration (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });
      const configurations = [{ codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 }];
      const event = { action: 'setEnablingConfiguration', body: { configurations } };

      const res = await handler(event);

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith(configurations, event);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, configurations });
    });

    it('dispatches setEnablingConfiguration passing through requestContext.authorizer for username resolution', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });
      const configurations = [{ codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 }];
      const event = {
        action: 'setEnablingConfiguration',
        body: { configurations },
        requestContext: { authorizer: { sub: 'mario.rossi' } },
      };

      await handler(event);

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith(configurations, event);
    });

    it('dispatches getVehicleInspection (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        getVehicleInspection: jest.fn().mockResolvedValue([{ id: 1 }]),
      });

      const res = await handler({ action: 'getVehicleInspection', body: { market: '1000', type: 'EXTERIOR' } });

      expect(instance.getVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '1000', type: 'EXTERIOR', vehicleInspections: [{ id: 1 }] });
    });

    it('dispatches setVehicleInspectionVisible (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setVehicleInspectionVisible: jest.fn().mockResolvedValue(undefined),
      });
      const conditions = [{ id: 1, value: 1 }];

      const res = await handler({ action: 'setVehicleInspectionVisible', body: { conditions } });

      expect(instance.setVehicleInspectionVisible).toHaveBeenCalledWith({ conditions });
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, conditions });
    });

    it('dispatches deletetVehicleInspection (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        deletetVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({ action: 'deletetVehicleInspection', body: { id: 1, value: 1 } });

      expect(instance.deletetVehicleInspection).toHaveBeenCalledWith(1, 1);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, id: 1, value: 1 });
    });

    it('dispatches insertVehicleInspection (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        insertVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'insertVehicleInspection',
        body: { market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria' },
      });

      expect(instance.insertVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR', 'Controllo carrozzeria');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria' });
    });

    it('dispatches setMarketEnable (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setMarketEnable: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({ action: 'setMarketEnable', body: { market: '3110' } });

      expect(instance.setMarketEnable).toHaveBeenCalledWith('3110');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '3110' });
    });

    it('dispatches setMarketDisable (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setMarketDisable: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({ action: 'setMarketDisable', body: { market: '3110' } });

      expect(instance.setMarketDisable).toHaveBeenCalledWith('3110');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '3110' });
    });

    it('dispatches setOicEnable (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setOicEnable: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({ action: 'setOicEnable', body: { market: '3110', oic: '00006821' } });

      expect(instance.setOicEnable).toHaveBeenCalledWith('3110', '00006821');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '3110', oic: '00006821' });
    });

    it('dispatches insertDomain (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        insertDomain: jest.fn().mockResolvedValue(42),
      });

      const res = await handler({
        action: 'insertDomain',
        body: { market: '3110', oic: '00006821', descr: 'Meccanica' },
      });

      expect(instance.insertDomain).toHaveBeenCalledWith('3110', '00006821', 'Meccanica');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true, market: '3110', oic: '00006821', descr: 'Meccanica', iddomain: 42,
      });
    });

    it('dispatches setDomain (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setDomain: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'setDomain',
        body: { market: '3110', iddomain: 42, descr: 'Meccanica' },
      });

      expect(instance.setDomain).toHaveBeenCalledWith('3110', 42, 'Meccanica');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '3110', iddomain: 42, descr: 'Meccanica' });
    });

    it('dispatches deleteDomain (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        deleteDomain: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'deleteDomain',
        body: { market: '3110', iddomain: 42 },
      });

      expect(instance.deleteDomain).toHaveBeenCalledWith('3110', 42);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '3110', iddomain: 42 });
    });

    it('dispatches insertPackage (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        insertPackage: jest.fn().mockResolvedValue(7),
      });

      const res = await handler({
        action: 'insertPackage',
        body: {
          market: '3110', oic: '00006821', iddomain: 42, descr: 'Tagliando', timeop: 60, pricewithvat: 100.5,
        },
      });

      expect(instance.insertPackage).toHaveBeenCalledWith('3110', '00006821', 42, 'Tagliando', 60, 100.5);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true, market: '3110', oic: '00006821', iddomain: 42, descr: 'Tagliando', timeop: 60, pricewithvat: 100.5, idpackage: 7,
      });
    });

    it('dispatches setPackage (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        setPackage: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'setPackage',
        body: {
          idpackage: 7, iddomain: 42, descr: 'Tagliando', timeop: 60, pricewithvat: 100.5,
        },
      });

      expect(instance.setPackage).toHaveBeenCalledWith(7, 42, 'Tagliando', 60, 100.5);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true, idpackage: 7, iddomain: 42, descr: 'Tagliando', timeop: 60, pricewithvat: 100.5,
      });
    });

    it('dispatches deletePackage (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        deletePackage: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({ action: 'deletePackage', body: { idpackage: 7 } });

      expect(instance.deletePackage).toHaveBeenCalledWith(7);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, idpackage: 7 });
    });

    it('dispatches getPackageList with a specific oic (direct invocation payload)', async () => {
      const packages = [{
        market: '1000', oic: '00006821', domainDescr: 'Meccanica', idpackage: 7, packageDescr: 'Tagliando', timeop: 60, pricewithvat: 100.5,
      }];
      const instance = makeManagerInstance({
        getPackageList: jest.fn().mockResolvedValue(packages),
      });

      const res = await handler({ action: 'getPackageList', body: { market: '1000', oic: '00006821' } });

      expect(instance.getPackageList).toHaveBeenCalledWith('1000', '00006821');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '1000', oic: '00006821', packages });
    });

    it('dispatches getPackageList without oic (market-level configuration)', async () => {
      const instance = makeManagerInstance({
        getPackageList: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({ action: 'getPackageList', body: { market: '1000' } });

      expect(instance.getPackageList).toHaveBeenCalledWith('1000', undefined);
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, market: '1000', oic: null, packages: [] });
    });

    it('dispatches insertAudit (direct invocation payload)', async () => {
      const instance = makeManagerInstance({
        insertAudit: jest.fn().mockResolvedValue(undefined),
      });

      const res = await handler({
        action: 'insertAudit',
        body: {
          username: 'mario.rossi', section: 'domain', market: '1000', actiontype: 'create', descr: 'Nuovo dominio',
        },
      });

      expect(instance.insertAudit).toHaveBeenCalledWith('mario.rossi', 'domain', '1000', 'create', 'Nuovo dominio');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true, username: 'mario.rossi', section: 'domain', market: '1000', actiontype: 'create', descr: 'Nuovo dominio',
      });
    });

    it('dispatches searchAudit (direct invocation payload)', async () => {
      const audits = [{
        id: 1, username: 'mario.rossi', creationdate: '2024-01-01', section: 'domain', market: '1000', actiontype: 'create', descr: 'Nuovo dominio',
      }];
      const instance = makeManagerInstance({
        searchAudit: jest.fn().mockResolvedValue(audits),
      });

      const res = await handler({
        action: 'searchAudit',
        body: {
          market: '1000', section: 'domain', datefrom: '2024-01-01', dateto: '2024-12-31', actiontype: 'create',
        },
      });

      expect(instance.searchAudit).toHaveBeenCalledWith('1000', 'domain', '2024-01-01', '2024-12-31', 'create');
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({
        success: true, market: '1000', section: 'domain', datefrom: '2024-01-01', dateto: '2024-12-31', actiontype: 'create', audits,
      });
    });

    it('dispatches getAnagSection (direct invocation payload)', async () => {
      const sections = [{ section: 'domain' }, { section: 'conditions' }];
      const instance = makeManagerInstance({
        getAnagSection: jest.fn().mockResolvedValue(sections),
      });

      const res = await handler({ action: 'getAnagSection', body: {} });

      expect(instance.getAnagSection).toHaveBeenCalledWith();
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, sections });
    });

    it('dispatches getAnagAllocation (direct invocation payload)', async () => {
      const allocations = [{ type: 'create' }, { type: 'update' }];
      const instance = makeManagerInstance({
        getAnagAllocation: jest.fn().mockResolvedValue(allocations),
      });

      const res = await handler({ action: 'getAnagAllocation', body: {} });

      expect(instance.getAnagAllocation).toHaveBeenCalledWith();
      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ success: true, allocations });
    });

    it('ignores an unparseable JSON body (parseBody catch branch) and falls back to path-derived action', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/getEnablingConfiguration',
        queryStringParameters: { codmarket: '1000' },
        body: '{not-valid-json',
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('dispatches via API Gateway proxy event (action from path + query string)', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/getEnablingConfiguration',
        queryStringParameters: { codmarket: '1000' },
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('resolves the action from event.path when rawPath is absent', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({ path: '/hqManager/getEnablingConfiguration', queryStringParameters: { codmarket: '1000' } });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('resolves the action from event.pathParameters.proxy when rawPath/path are absent', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        pathParameters: { proxy: 'hqManager/getEnablingConfiguration' },
        queryStringParameters: { codmarket: '1000' },
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('prefers action from the parsed body over the path-derived one', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });

      const res = await handler({
        rawPath: '/hqManager/setEnablingConfiguration',
        body: JSON.stringify({ action: 'getEnablingConfiguration', codmarket: '1000' }),
      });

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(res.statusCode).toBe(200);
    });

    it('returns 400 when no action can be resolved at all (no path, no body action)', async () => {
      const res = await handler({});
      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body).success).toBe(false);
    });

    it('returns 400 when the manager throws a validation error ("is required")', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('"codmarket" is required')),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: {} });

      expect(res.statusCode).toBe(400);
      expect(JSON.parse(res.body)).toEqual({ success: false, message: '"codmarket" is required' });
    });

    it('returns 502 when the manager throws any other error', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('connection lost')),
      });

      const res = await handler({ action: 'getEnablingConfiguration', body: { codmarket: '1000' } });

      expect(res.statusCode).toBe(502);
      expect(JSON.parse(res.body)).toEqual({ success: false, message: 'connection lost' });
    });
  });

  describe('runGetEnablingConfiguration / runSetEnablingConfiguration (CLI helpers)', () => {
    it('runGetEnablingConfiguration delegates to HqManager and returns the result', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([{ oic: '00006821' }]),
      });

      const result = await runGetEnablingConfiguration('1000');

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(result).toEqual([{ oic: '00006821' }]);
    });

    it('runSetEnablingConfiguration delegates to HqManager and returns a summary', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });

      const result = await runSetEnablingConfiguration('1000', '00006821', 1, 0);

      const configurations = [{ codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 }];
      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith(configurations);
      expect(result).toEqual({ success: true, configurations });
    });

    it('runGetVehicleInspection delegates to HqManager and returns the result', async () => {
      const instance = makeManagerInstance({
        getVehicleInspection: jest.fn().mockResolvedValue([{ id: 1 }]),
      });

      const result = await runGetVehicleInspection('1000', 'EXTERIOR');

      expect(instance.getVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR');
      expect(result).toEqual([{ id: 1 }]);
    });

    it('runSetVehicleInspectionVisible delegates to HqManager and returns a summary', async () => {
      const instance = makeManagerInstance({
        setVehicleInspectionVisible: jest.fn().mockResolvedValue(undefined),
      });

      const result = await runSetVehicleInspectionVisible(1, 1);

      const conditions = [{ id: 1, value: 1 }];
      expect(instance.setVehicleInspectionVisible).toHaveBeenCalledWith({ conditions });
      expect(result).toEqual({ success: true, conditions });
    });

    it('runDeletetVehicleInspectionVisible delegates to HqManager and returns a summary', async () => {
      const instance = makeManagerInstance({
        deletetVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });

      const result = await runDeletetVehicleInspectionVisible(1, 1);

      expect(instance.deletetVehicleInspection).toHaveBeenCalledWith(1, 1);
      expect(result).toEqual({ success: true, id: 1, value: 1 });
    });

    it('runInsertVehicleInspection delegates to HqManager and returns a summary', async () => {
      const instance = makeManagerInstance({
        insertVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });

      const result = await runInsertVehicleInspection('1000', 'EXTERIOR', 'Controllo carrozzeria');

      expect(instance.insertVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR', 'Controllo carrozzeria');
      expect(result).toEqual({ success: true, market: '1000', type: 'EXTERIOR', descr: 'Controllo carrozzeria' });
    });
  });

  describe('main (CLI dispatcher)', () => {
    const ORIGINAL_ARGV = process.argv;
    let exitSpy;

    beforeEach(() => {
      exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
    });

    afterEach(() => {
      process.argv = ORIGINAL_ARGV;
    });

    it('prints usage and exits 0 when no command is given', async () => {
      process.argv = ['node', 'index.js'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(0);
    });

    it('prints usage and exits 1 when command is unknown', async () => {
      process.argv = ['node', 'index.js', 'notACommand'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when getEnablingConfiguration is called without codmarket', async () => {
      process.argv = ['node', 'index.js', 'getEnablingConfiguration'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs getEnablingConfiguration via CLI', async () => {
      const instance = makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockResolvedValue([]),
      });
      process.argv = ['node', 'index.js', 'getEnablingConfiguration', '1000'];

      await main();

      expect(instance.getEnablingConfiguration).toHaveBeenCalledWith('1000');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when setEnablingConfiguration is called with missing args', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when setEnablingConfiguration is called with no args at all', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('exits 1 when setEnablingConfiguration is missing enableWOC/enableSignature', async () => {
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000', '00006821'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs setEnablingConfiguration via CLI', async () => {
      const instance = makeManagerInstance({
        setEnablingConfiguration: jest.fn().mockResolvedValue(undefined),
      });
      process.argv = ['node', 'index.js', 'setEnablingConfiguration', '1000', '00006821', '1', '0'];

      await main();

      expect(instance.setEnablingConfiguration).toHaveBeenCalledWith([
        { codmarket: '1000', oic: '00006821', enableWOC: 1, enableSignature: 0 },
      ]);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when getVehicleInspection is called without market/type', async () => {
      process.argv = ['node', 'index.js', 'getVehicleInspection', '1000'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs getVehicleInspection via CLI', async () => {
      const instance = makeManagerInstance({
        getVehicleInspection: jest.fn().mockResolvedValue([]),
      });
      process.argv = ['node', 'index.js', 'getVehicleInspection', '1000', 'EXTERIOR'];

      await main();

      expect(instance.getVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when setVehicleInspectionVisible is called with missing args', async () => {
      process.argv = ['node', 'index.js', 'setVehicleInspectionVisible', '1'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs setVehicleInspectionVisible via CLI', async () => {
      const instance = makeManagerInstance({
        setVehicleInspectionVisible: jest.fn().mockResolvedValue(undefined),
      });
      process.argv = ['node', 'index.js', 'setVehicleInspectionVisible', '1', '1'];

      await main();

      expect(instance.setVehicleInspectionVisible).toHaveBeenCalledWith({ conditions: [{ id: 1, value: 1 }] });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when deletetVehicleInspection is called with missing args', async () => {
      process.argv = ['node', 'index.js', 'deletetVehicleInspection', '1'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs deletetVehicleInspection via CLI', async () => {
      const instance = makeManagerInstance({
        deletetVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });
      process.argv = ['node', 'index.js', 'deletetVehicleInspection', '1', '1'];

      await main();

      expect(instance.deletetVehicleInspection).toHaveBeenCalledWith(1, 1);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('exits 1 when insertVehicleInspection is called with missing args', async () => {
      process.argv = ['node', 'index.js', 'insertVehicleInspection', '1000', 'EXTERIOR'];
      await main();
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('runs insertVehicleInspection via CLI', async () => {
      const instance = makeManagerInstance({
        insertVehicleInspection: jest.fn().mockResolvedValue(undefined),
      });
      process.argv = ['node', 'index.js', 'insertVehicleInspection', '1000', 'EXTERIOR', 'Controllo carrozzeria'];

      await main();

      expect(instance.insertVehicleInspection).toHaveBeenCalledWith('1000', 'EXTERIOR', 'Controllo carrozzeria');
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('logs error and exits 1 when the CLI action throws', async () => {
      makeManagerInstance({
        getEnablingConfiguration: jest.fn().mockRejectedValue(new Error('boom')),
      });
      process.argv = ['node', 'index.js', 'getEnablingConfiguration', '1000'];

      await main();

      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
