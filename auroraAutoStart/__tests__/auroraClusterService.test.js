'use strict';

const { RDSClient, DescribeDBClustersCommand, StartDBClusterCommand } = require('@aws-sdk/client-rds');
const { startClusterIfStopped } = require('../src/services/auroraClusterService');

describe('auroraClusterService.startClusterIfStopped', () => {
  function makeFakeClient(describeResult) {
    const send = jest.fn().mockImplementation((command) => {
      if (command instanceof DescribeDBClustersCommand) {
        return Promise.resolve(describeResult);
      }
      if (command instanceof StartDBClusterCommand) {
        return Promise.resolve({});
      }
      return Promise.reject(new Error('Unexpected command'));
    });
    return { send };
  }

  test('avvia il cluster quando lo stato è "stopped"', async () => {
    const rdsClient = makeFakeClient({ DBClusters: [{ Status: 'stopped' }] });

    const result = await startClusterIfStopped('rds-np-bsn0027990-stage-aurora', { rdsClient });

    expect(rdsClient.send).toHaveBeenCalledTimes(2);
    expect(rdsClient.send.mock.calls[1][0]).toBeInstanceOf(StartDBClusterCommand);
    expect(result).toEqual({
      clusterIdentifier: 'rds-np-bsn0027990-stage-aurora',
      previousStatus: 'stopped',
      action: 'started',
      message: expect.stringContaining('Comando di avvio inviato con successo'),
    });
  });

  test('non fa nulla se il cluster è già "available"', async () => {
    const rdsClient = makeFakeClient({ DBClusters: [{ Status: 'available' }] });

    const result = await startClusterIfStopped('rds-np-bsn0027990-stage-aurora', { rdsClient });

    expect(rdsClient.send).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      clusterIdentifier: 'rds-np-bsn0027990-stage-aurora',
      previousStatus: 'available',
      action: 'skipped',
      message: expect.stringContaining('Nessuna azione'),
    });
  });

  test('non fa nulla se il cluster è in uno stato transitorio (es. "starting")', async () => {
    const rdsClient = makeFakeClient({ DBClusters: [{ Status: 'starting' }] });

    const result = await startClusterIfStopped('rds-np-bsn0027990-stage-aurora', { rdsClient });

    expect(rdsClient.send).toHaveBeenCalledTimes(1);
    expect(result.action).toBe('skipped');
  });

  test('lancia un errore se il cluster non viene trovato', async () => {
    const rdsClient = makeFakeClient({ DBClusters: [] });

    await expect(startClusterIfStopped('cluster-inesistente', { rdsClient })).rejects.toThrow(
      'Cluster Aurora "cluster-inesistente" non trovato'
    );
  });

  test('usa un RDSClient reale (istanziato internamente) quando non viene iniettato', async () => {
    // Copre il ramo di default "deps.rdsClient || new RDSClient({})": mockiamo
    // RDSClient.prototype.send per evitare qualunque chiamata reale ad AWS.
    const sendSpy = jest
      .spyOn(RDSClient.prototype, 'send')
      .mockImplementation((command) => {
        if (command instanceof DescribeDBClustersCommand) {
          return Promise.resolve({ DBClusters: [{ Status: 'available' }] });
        }
        return Promise.resolve({});
      });

    const result = await startClusterIfStopped('rds-np-bsn0027990-stage-aurora');

    expect(result.action).toBe('skipped');
    sendSpy.mockRestore();
  });
});
