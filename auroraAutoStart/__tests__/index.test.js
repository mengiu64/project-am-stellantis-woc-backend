'use strict';

jest.mock('../src/services/auroraClusterService');
jest.mock('../src/services/bastionInstanceService');

const { startClusterIfStopped } = require('../src/services/auroraClusterService');
const { startBastionIfStopped } = require('../src/services/bastionInstanceService');
const { handler } = require('../index');

const CLUSTER = 'rds-np-bsn0027990-stage-aurora';
const BASTION = 'ec2-np-bsn0027990-stage-bastion';

const clusterStarted = {
  clusterIdentifier: CLUSTER,
  previousStatus: 'stopped',
  action: 'started',
  message: 'ok',
};
const bastionStarted = {
  instanceName: BASTION,
  instances: [{ instanceId: 'i-0123456789abcdef0', previousStatus: 'stopped', action: 'started', message: 'ok' }],
};

describe('auroraAutoStart handler', () => {
  const ORIGINAL_ENV = process.env;
  let logSpy;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER: CLUSTER,
      AURORAAUTOSTART_BASTION_NAME: BASTION,
    };
    startClusterIfStopped.mockReset();
    startBastionIfStopped.mockReset();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('avvia cluster e bastion con gli identificativi da env var', async () => {
    startClusterIfStopped.mockResolvedValue(clusterStarted);
    startBastionIfStopped.mockResolvedValue(bastionStarted);

    const result = await handler();

    expect(startClusterIfStopped).toHaveBeenCalledWith(CLUSTER);
    expect(startBastionIfStopped).toHaveBeenCalledWith(BASTION);
    expect(result).toEqual({ cluster: clusterStarted, bastion: bastionStarted });
    expect(logSpy).toHaveBeenCalledWith('[auroraAutoStart]', JSON.stringify(result));
  });

  test('lancia un errore se AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non è impostata', async () => {
    delete process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER;

    await expect(handler()).rejects.toThrow('AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non impostata');
    expect(startClusterIfStopped).not.toHaveBeenCalled();
    expect(startBastionIfStopped).not.toHaveBeenCalled();
  });

  test('salta il bastion (senza errore) se AURORAAUTOSTART_BASTION_NAME non è impostata', async () => {
    delete process.env.AURORAAUTOSTART_BASTION_NAME;
    startClusterIfStopped.mockResolvedValue(clusterStarted);

    const result = await handler();

    expect(startBastionIfStopped).not.toHaveBeenCalled();
    expect(result).toEqual({
      cluster: clusterStarted,
      bastion: {
        action: 'skipped',
        message: expect.stringContaining('AURORAAUTOSTART_BASTION_NAME non impostata'),
      },
    });
  });

  test('se il cluster fallisce avvia comunque il bastion, logga entrambi gli esiti e propaga l\'errore', async () => {
    startClusterIfStopped.mockRejectedValue(new Error('boom cluster'));
    startBastionIfStopped.mockResolvedValue(bastionStarted);

    await expect(handler()).rejects.toThrow('boom cluster');

    expect(startBastionIfStopped).toHaveBeenCalledWith(BASTION);
    expect(logSpy).toHaveBeenCalledWith(
      '[auroraAutoStart]',
      JSON.stringify({ cluster: { error: 'boom cluster' }, bastion: bastionStarted })
    );
  });

  test('se il bastion fallisce avvia comunque il cluster, logga entrambi gli esiti e propaga l\'errore', async () => {
    startClusterIfStopped.mockResolvedValue(clusterStarted);
    startBastionIfStopped.mockRejectedValue(new Error('boom bastion'));

    await expect(handler()).rejects.toThrow('boom bastion');

    expect(startClusterIfStopped).toHaveBeenCalledWith(CLUSTER);
    expect(logSpy).toHaveBeenCalledWith(
      '[auroraAutoStart]',
      JSON.stringify({ cluster: clusterStarted, bastion: { error: 'boom bastion' } })
    );
  });
});
