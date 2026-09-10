'use strict';

/**
 * Lambda entry-point — triggerata da EventBridge Schedule (vedi template.yaml,
 * risorsa AuroraAutoStartFunction, evento WeekdayMorningStart), nessun dispatch
 * per action/path: l'unico scopo di questa Lambda è avviare il cluster Aurora
 * di stage ogni mattina nei giorni lavorativi.
 *
 * Contesto: un tool centralizzato Stellantis ("Stellantis startstop tool",
 * esterno a questo repository) spegne il cluster Aurora di stage ogni sera per
 * risparmio costi (tag "stla_scheduler_action" sul cluster), ma NON prevede
 * un riavvio automatico al mattino — verificato via CloudTrail: tutti gli
 * avvii precedenti a questa Lambda erano eseguiti manualmente da un operatore.
 * Deployata SOLO in stage (Condition: IsStage in template.yaml): l'ambiente
 * dev resta sempre acceso, l'ambiente prod non è gestito da questo scheduler.
 *
 * Usabile anche da riga di comando: node index.js
 */

require('dotenv').config();

const { startClusterIfStopped } = require('./src/services/auroraClusterService');

exports.handler = async () => {
  const dbClusterIdentifier = process.env.AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER;
  if (!dbClusterIdentifier) {
    throw new Error('Variabile AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER non impostata');
  }

  const result = await startClusterIfStopped(dbClusterIdentifier);
  console.log('[auroraAutoStart]', JSON.stringify(result));
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
