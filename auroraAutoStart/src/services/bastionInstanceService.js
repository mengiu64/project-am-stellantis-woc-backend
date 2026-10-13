'use strict';

const { EC2Client, DescribeInstancesCommand, StartInstancesCommand } = require('@aws-sdk/client-ec2');

// Escluse "terminated"/"shutting-down": non più avviabili, ma restano visibili
// per circa un'ora (es. dopo una ricreazione del bastion via Terraform).
const NON_TERMINATED_STATES = ['pending', 'running', 'stopping', 'stopped'];

/**
 * Avvia l'istanza EC2 bastion di accesso ad Aurora, individuata tramite il tag
 * "Name" (non tramite instance ID: il bastion è gestito da Terraform e l'ID
 * cambia se l'istanza viene ricreata), SOLO se il suo stato corrente è "stopped".
 *
 * Stessa logica idempotente di startClusterIfStopped: in qualunque altro stato
 * ("running", "pending", "stopping"...) non viene effettuata alcuna azione,
 * perché EC2 accetta StartInstances solo da "stopped" (IncorrectInstanceState
 * negli altri casi). Se più istanze attive condividono lo stesso tag Name
 * vengono avviate tutte quelle spente.
 *
 * @param {string} instanceName - valore del tag "Name" dell'istanza
 * @param {{ ec2Client?: EC2Client }} [deps] - dipendenze iniettabili per i test
 * @returns {Promise<{instanceName: string, instances: Array<{instanceId: string, previousStatus: string, action: 'started'|'skipped', message: string}>}>}
 */
async function startBastionIfStopped(instanceName, deps = {}) {
  const ec2Client = deps.ec2Client || new EC2Client({});

  const { Reservations } = await ec2Client.send(
    new DescribeInstancesCommand({
      Filters: [
        { Name: 'tag:Name', Values: [instanceName] },
        { Name: 'instance-state-name', Values: NON_TERMINATED_STATES },
      ],
    })
  );
  const instances = (Reservations || []).flatMap((reservation) => reservation.Instances);
  if (instances.length === 0) {
    throw new Error(`Istanza EC2 con tag Name "${instanceName}" non trovata`);
  }

  const instanceIdsToStart = instances
    .filter((instance) => instance.State.Name === 'stopped')
    .map((instance) => instance.InstanceId);

  if (instanceIdsToStart.length > 0) {
    await ec2Client.send(new StartInstancesCommand({ InstanceIds: instanceIdsToStart }));
  }

  return {
    instanceName,
    instances: instances.map(({ InstanceId, State }) => {
      const started = instanceIdsToStart.includes(InstanceId);
      return {
        instanceId: InstanceId,
        previousStatus: State.Name,
        action: started ? 'started' : 'skipped',
        message: started
          ? `Comando di avvio inviato con successo (stato precedente: "${State.Name}")`
          : `Nessuna azione: stato corrente "${State.Name}" (avvio consentito solo da stato "stopped")`,
      };
    }),
  };
}

module.exports = { startBastionIfStopped };
