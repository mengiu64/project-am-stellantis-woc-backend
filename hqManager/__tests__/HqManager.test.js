'use strict';

jest.mock('../../serviceClient', () => ({ callService: jest.fn() }), { virtual: true });

const { callService } = require('../../serviceClient');
const { HqManager } = require('../HqManager');
const repository = require('../repository');

describe('HqManager — consumer REST', () => {
  let manager;
  let errorSpy;
  const event = { requestContext: { authorizer: { sub: 'mario.rossi' } } };

  beforeEach(() => {
    callService.mockReset().mockResolvedValue(undefined);
    manager = new HqManager();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => errorSpy.mockRestore());

  test.each([
    ['getEnablingConfiguration', ['1000'], 'getEnablingConfiguration'],
    ['getVehicleInspection', ['1000', 'EXTERIOR'], 'getVehicleInspection'],
    ['setMarketEnable', ['1000'], 'setPkMarketEnable'],
    ['setMarketDisable', ['1000'], 'setPkMarketDisable'],
    ['checkIsPkMarketEnabled', ['1000'], 'checkIsPkMarketEnabled'],
    ['insertDomain', ['1000', 'Meccanica'], 'insertDomain'],
    ['setDomain', ['1000', 42, 'Meccanica'], 'setDomain'],
    ['deleteDomain', ['1000', 42], 'deleteDomain'],
    ['insertPackage', ['1000', '00006821', 42, 'Tagliando', 60, 100.5], 'insertPackage'],
    ['setPackage', [7, 42, 'Tagliando', 60, 100.5], 'setPackage'],
    ['deletePackage', [7], 'deletePackage'],
    ['getPackageListHQ', ['1000'], 'getPackageListHQ'],
    ['getPackageListSM', ['1000', '00006821'], 'getPackageListSM'],
    ['searchAudit', ['1000', 'domain', '2024-01-01', '2024-12-31', 'create', 'mario.rossi'], 'searchAudit'],
    ['getAnagSection', [], 'getAnagSection'],
    ['getAnagAllocation', [], 'getAnagAllocation'],
  ])('%s restituisce il valore dominio senza pool o wrapper', async (method, args, operation) => {
    const rawValue = [{ id: 7 }];
    callService.mockResolvedValue(rawValue);
    expect(await manager[method](...args)).toBe(rawValue);
    expect(callService.mock.calls).toEqual([['dbmanager', operation, { args }]]);
  });

  test.each(Object.keys(repository))('%s propaga errori HTTP/trasporto', async (operation) => {
    const error = new Error('HTTP 503');
    callService.mockRejectedValue(error);
    await expect(repository[operation]('1000', null)).rejects.toBe(error);
    expect(callService).toHaveBeenCalledWith('dbmanager', operation, { args: ['1000', null] });
  });

  test('configurazioni e audit restano sequenziali, con identita autenticata', async () => {
    callService.mockImplementation(async (service) => service === 'session'
      ? { firstname: 'Mario', lastname: 'Rossi' }
      : undefined);
    await manager.setEnablingConfiguration([
      { codmarket: '1000', oic: 'a', enableWOC: 1, enableSignature: 0 },
      { codmarket: '1000', oic: 'b', enableWOC: 0, enableSignature: 1 },
    ], event);
    expect(callService.mock.calls).toEqual([
      ['session', 'getData', { args: ['mario.rossi'] }],
      ['dbmanager', 'setEnablingConfiguration', { args: ['1000', 'a', 1, 0] }],
      ['dbmanager', 'insertAudit', { args: ['Mario Rossi', 'enablingConfiguration', '1000', 'update', 'oic: a enabled: 1 enableSignature:0'] }],
      ['dbmanager', 'setEnablingConfiguration', { args: ['1000', 'b', 0, 1] }],
      ['dbmanager', 'insertAudit', { args: ['Mario Rossi', 'enablingConfiguration', '1000', 'update', 'oic: b enabled: 0 enableSignature:1'] }],
    ]);
  });

  test('un errore di scrittura interrompe il loop prima dell audit e degli elementi successivi', async () => {
    callService.mockRejectedValue(new Error('HTTP 500'));
    await expect(manager.setEnablingConfiguration([
      { codmarket: '1000', oic: 'a', enableWOC: 1, enableSignature: 0 },
      { codmarket: '1000', oic: 'b', enableWOC: 0, enableSignature: 1 },
    ])).rejects.toThrow('HTTP 500');
    expect(callService.mock.calls).toEqual([
      ['dbmanager', 'setEnablingConfiguration', { args: ['1000', 'a', 1, 0] }],
    ]);
  });

  test.each(HqManager.VEHICLE_INSPECTION_ARRAY_KEYS)('gestisce il loop %s', async (key) => {
    await manager.setVehicleInspectionVisible({ [key]: [{ id: 7, value: 0 }, { id: 8, value: 1 }] });
    expect(callService.mock.calls).toEqual([
      ['dbmanager', 'setVehicleInspectionVisible', { args: [7, 0, null, ''] }],
      ['dbmanager', 'setVehicleInspectionVisible', { args: [8, 1, null, ''] }],
    ]);
  });

  test.each([
    [{}, { username: 'cli' }, 'cli'],
    [{ requestContext: {} }, { username: 'cli' }, 'cli'],
    [{ requestContext: { authorizer: {} } }, { username: 'spoofed' }, null],
    [{ requestContext: { authorizer: { sub: '' } } }, { username: 'spoofed' }, null],
    [event, { username: 'spoofed' }, 'mario.rossi'],
  ])('risolve identita senza fallback client se authorizer e presente', async (evt, body, username) => {
    callService.mockImplementation(async (service) => service === 'session'
      ? { firstname: 'Mario', lastname: 'Rossi', codmarket: '1000' }
      : undefined);
    await manager.setVehicleInspectionVisible({ ...body, conditions: [{ id: 7, value: 1 }] }, evt);
    const sessionCalls = callService.mock.calls.filter(([service]) => service === 'session');
    expect(sessionCalls).toEqual(username ? [
      ['session', 'getData', { args: [username] }],
      ['session', 'getData', { args: [username] }],
    ] : []);
    expect(callService).toHaveBeenLastCalledWith('dbmanager', 'setVehicleInspectionVisible', {
      args: [7, 1, username ? 'Mario Rossi' : null, username ? '1000' : ''],
    });
  });

  test.each([null, {}, { firstname: 'Mario' }, { lastname: 'Rossi' }])('usa nome disponibile e default mercato', async (session) => {
    callService.mockImplementation(async (service) => service === 'session' ? session : undefined);
    await manager.deletetVehicleInspection(1, 1, event);
    const name = session && [session.firstname, session.lastname].filter(Boolean).join(' ');
    expect(callService).toHaveBeenLastCalledWith('dbmanager', 'deletetVehicleInspection', {
      args: [1, 1, name || 'mario.rossi', ''],
    });
  });

  test('errori REST di sessione sono esplicitamente loggati e best-effort', async () => {
    callService.mockImplementation(async (service) => {
      if (service === 'session') throw new Error('HTTP 502');
    });
    await manager.insertVehicleInspection('1000', 'EXTERIOR', 'Controllo', event);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('HTTP 502'));
    expect(callService).toHaveBeenLastCalledWith('dbmanager', 'insertVehicleInspection', {
      args: ['1000', 'EXTERIOR', 'Controllo', 'mario.rossi', ''],
    });
  });

  test('insertAudit restituisce lo username risolto', async () => {
    callService.mockImplementation(async (service) => service === 'session'
      ? { firstname: 'Mario', lastname: 'Rossi' } : undefined);
    expect(await manager.insertAudit(event, 'domain', '1000', 'create', 'Nuovo dominio')).toBe('Mario Rossi');
    expect(callService).toHaveBeenLastCalledWith('dbmanager', 'insertAudit', {
      args: ['Mario Rossi', 'domain', '1000', 'create', 'Nuovo dominio'],
    });
  });

  test('insertAudit senza identita conserva null', async () => {
    expect(await manager.insertAudit({}, 'domain', '1000', 'create', 'Nuovo dominio')).toBeNull();
    expect(callService.mock.calls).toEqual([
      ['dbmanager', 'insertAudit', { args: [null, 'domain', '1000', 'create', 'Nuovo dominio'] }],
    ]);
  });

  test.each([
    ['setDomainVisible', 'domain', 'iddomain'],
    ['setPackageVisible', 'package', 'idpackage'],
  ])('%s invoca una REST per elemento', async (method, key, idKey) => {
    await manager[method]({ [key]: [{ [idKey]: 7, value: 0 }, { [idKey]: 8, value: 1 }] });
    expect(callService.mock.calls).toEqual([
      ['dbmanager', method, { args: [7, 0] }],
      ['dbmanager', method, { args: [8, 1] }],
    ]);
  });

  test.each([
    ['clonePk', ['2000', '1000']],
    ['cloneVeicInspection', ['2000', null, 'EXTERIOR']],
  ])('%s conserva ritorno void', async (method, args) => {
    callService.mockResolvedValue({ success: true });
    expect(await manager[method](...args)).toBeUndefined();
    expect(callService.mock.calls).toEqual([['dbmanager', method, { args }]]);
  });

  test.each([
    ['setEnablingConfiguration', undefined], ['setEnablingConfiguration', []],
    ['setDomainVisible', undefined], ['setDomainVisible', {}], ['setDomainVisible', { domain: [] }],
    ['setPackageVisible', undefined], ['setPackageVisible', {}], ['setPackageVisible', { package: [] }],
    ['setVehicleInspectionVisible', undefined], ['setVehicleInspectionVisible', {}],
  ])('%s valida prima di usare REST', async (method, payload) => {
    await expect(manager[method](payload)).rejects.toThrow();
    expect(callService).not.toHaveBeenCalled();
  });
});
