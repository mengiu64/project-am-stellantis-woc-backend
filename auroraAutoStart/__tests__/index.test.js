'use strict';

jest.mock('../src/services/auroraClusterService');

const { startClusterIfStopped } = require('../src/services/auroraClusterService');
const { handler } = require('../index');

describe('auroraAutoStart handler', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    startClusterIfStopped.mockReset();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('invoca startClusterIfStopped con il cluster identifier da env var', async () => {
    process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER = 'rds-np-bsn0027990-stage-aurora';
    startClusterIfStopped.mockResolvedValue({
      clusterIdentifier: 'rds-np-bsn0027990-stage-aurora',
      previousStatus: 'stopped',
      action: 'started',
      message: 'ok',
    });

    const result = await handler();

    expect(startClusterIfStopped).toHaveBeenCalledWith('rds-np-bsn0027990-stage-aurora');
    expect(result.action).toBe('started');
  });

  test('lancia un errore se AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non è impostata', async () => {
    delete process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER;

    await expect(handler()).rejects.toThrow('AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non impostata');
    expect(startClusterIfStopped).not.toHaveBeenCalled();
  });

  test('propaga l\'errore se startClusterIfStopped fallisce', async () => {
    process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER = 'rds-np-bsn0027990-stage-aurora';
    startClusterIfStopped.mockRejectedValue(new Error('boom'));

    await expect(handler()).rejects.toThrow('boom');
  });
});
