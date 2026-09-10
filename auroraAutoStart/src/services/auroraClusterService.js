'use strict';

const { RDSClient, DescribeDBClustersCommand, StartDBClusterCommand } = require('@aws-sdk/client-rds');

/**
 * Avvia il cluster Aurora indicato SOLO se il suo stato corrente è "stopped".
 *
 * Se il cluster è già "available", oppure si trova in uno stato transitorio
 * (es. "starting", "backing-up", "stopping"...), non viene effettuata alcuna
 * azione: l'API RDS accetta StartDBCluster solo da stato "stopped" e
 * risponderebbe con InvalidDBClusterStateFault in tutti gli altri casi. Questo
 * rende la funzione idempotente e sicura da rieseguire (es. retry EventBridge,
 * o cluster già riavviato manualmente prima dello scheduling).
 *
 * @param {string} dbClusterIdentifier
 * @param {{ rdsClient?: RDSClient }} [deps] - dipendenze iniettabili per i test
 * @returns {Promise<{clusterIdentifier: string, previousStatus: string, action: 'started'|'skipped', message: string}>}
 */
async function startClusterIfStopped(dbClusterIdentifier, deps = {}) {
  const rdsClient = deps.rdsClient || new RDSClient({});

  const { DBClusters } = await rdsClient.send(
    new DescribeDBClustersCommand({ DBClusterIdentifier: dbClusterIdentifier })
  );
  const cluster = DBClusters && DBClusters[0];
  if (!cluster) {
    throw new Error(`Cluster Aurora "${dbClusterIdentifier}" non trovato`);
  }

  const previousStatus = cluster.Status;

  if (previousStatus !== 'stopped') {
    return {
      clusterIdentifier: dbClusterIdentifier,
      previousStatus,
      action: 'skipped',
      message: `Nessuna azione: stato corrente "${previousStatus}" (avvio consentito solo da stato "stopped")`,
    };
  }

  await rdsClient.send(new StartDBClusterCommand({ DBClusterIdentifier: dbClusterIdentifier }));

  return {
    clusterIdentifier: dbClusterIdentifier,
    previousStatus,
    action: 'started',
    message: `Comando di avvio inviato con successo (stato precedente: "${previousStatus}")`,
  };
}

module.exports = { startClusterIfStopped };
