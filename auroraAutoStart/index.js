'use strict';

/**
 * Lambda entry-point — triggerata da EventBridge Schedule (vedi template.yaml,
 * risorsa AuroraAutoStartFunction, evento WeekdayMorningStart), nessun dispatch
 * per action/path: l'unico scopo di questa Lambda è riaccendere ogni mattina,
 * nei giorni lavorativi, il cluster Aurora di stage e il bastion EC2 usato per
 * accedervi.
 *
 * Contesto: un tool centralizzato Stellantis ("Stellantis startstop tool",
 * esterno a questo repository) spegne ogni sera per risparmio costi sia il
 * cluster Aurora sia il bastion EC2 di stage (tag "stla_scheduler_action" su
 * entrambi), ma NON prevede un riavvio automatico al mattino — verificato via
 * CloudTrail: tutti gli avvii precedenti a questa Lambda (StartDBCluster e
 * StartInstances) erano eseguiti manualmente da un operatore.
 * Deployata SOLO in stage (Condition: IsStage in template.yaml): l'ambiente
 * dev resta sempre acceso, l'ambiente prod non è gestito da questo scheduler.
 *
 * Usabile anche da riga di comando: node index.js
 */

require('dotenv').config();

const { startClusterIfStopped } = require('./src/services/auroraClusterService');
const { startBastionIfStopped } = require('./src/services/bastionInstanceService');

function toResult(outcome) {
  return outcome.status === 'fulfilled' ? outcome.value : { error: outcome.reason.message };
}

exports.handler = async () => {
  const dbClusterIdentifier = process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER;
  if (!dbClusterIdentifier) {
    throw new Error('Variabile AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non impostata');
  }
  const bastionName = process.env.AURORAAUTOSTART_BASTION_NAME;

  // Avvii indipendenti: un errore sul bastion non deve impedire l'avvio del
  // cluster (da cui dipendono le Lambda applicative), e viceversa.
  const [cluster, bastion] = await Promise.allSettled([
    startClusterIfStopped(dbClusterIdentifier),
    bastionName
      ? startBastionIfStopped(bastionName)
      : Promise.resolve({
          action: 'skipped',
          message: 'Variabile AURORAAUTOSTART_BASTION_NAME non impostata: avvio del bastion disabilitato',
        }),
  ]);

  const result = { cluster: toResult(cluster), bastion: toResult(bastion) };
  console.log('[auroraAutoStart]', JSON.stringify(result));

  // Esito di entrambi già loggato: propaga il primo errore, così l'invocazione
  // risulta fallita e viene ritentata da Lambda (operazioni idempotenti).
  const failure = [cluster, bastion].find((outcome) => outcome.status === 'rejected');
  if (failure) {
    throw failure.reason;
  }
  return result;
};

/* istanbul ignore if */
if (require.main === module) {
  exports.handler().then(
    (result) => {
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    },
    (err) => {
      console.error(err);
      process.exit(1);
    }
  );
}
