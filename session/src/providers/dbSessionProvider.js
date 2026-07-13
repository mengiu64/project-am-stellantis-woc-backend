'use strict';

const SessionProvider = require('./sessionProvider');

/**
 * Provider "DB": legge i dati di sessione da una fonte dati reale in ambiente AWS.
 *
 * Questo modulo e' predisposto per due possibili implementazioni (scegliere in base
 * all'architettura AWS effettiva del progetto):
 *
 *  1) RDS (Postgres/MySQL) - usare il client "pg" o "mysql2" (da aggiungere come
 *     dipendenza quando si attiva questa modalita'):
 *       npm install pg
 *
 *  2) DynamoDB - usare l'SDK AWS (gia' disponibile nell'ambiente Lambda):
 *       npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
 *
 * La configurazione (host, credenziali, nome tabella, ecc.) e' letta da
 * src/config/index.js, che a sua volta legge le variabili d'ambiente.
 * In AWS Lambda queste andrebbero impostate come environment variables della
 * funzione, con le credenziali gestite preferibilmente tramite Secrets Manager
 * o IAM role (per DynamoDB) invece che in chiaro.
 *
 * NOTA: l'implementazione della query vera e propria e' volutamente lasciata
 * come TODO: qui sotto e' predisposta la struttura (connessione, query, mapping
 * riga->oggetto) da completare quando sara' disponibile lo schema/tabella reale.
 */
class DbSessionProvider extends SessionProvider {
  /**
   * @param {object} config - la sezione `db` di src/config/index.js.
   */
  constructor(config) {
    super();
    this.config = config;
  }

  /**
   * @param {object} criteria - Criteri di ricerca, es. { pdvId, sincom, codmarket }.
   *   Questi valori identificano la riga/record da cui leggere i dati di sessione.
   * @returns {Promise<object>}
   */
  async getSessionData(criteria = {}) {
    if (this.config.engine === 'dynamodb') {
      return this._getFromDynamoDb(criteria);
    }
    return this._getFromRelationalDb(criteria);
  }

  /**
   * TODO: implementare la connessione/query reale verso RDS (Postgres/MySQL)
   * quando saranno noti schema tabella e credenziali dell'ambiente AWS.
   *
   * Esempio indicativo (Postgres, richiede "pg"):
   *   const { Client } = require('pg');
   *   const client = new Client({
   *     host: this.config.host,
   *     port: this.config.port,
   *     database: this.config.database,
   *     user: this.config.user,
   *     password: this.config.password,
   *     ssl: this.config.ssl ? { rejectUnauthorized: false } : false,
   *   });
   *   await client.connect();
   *   try {
   *     const { rows } = await client.query(
   *       'SELECT * FROM session_data WHERE codmarket = $1 AND pdv_id = $2',
   *       [criteria.codmarket, criteria.pdvId]
   *     );
   *     return this._mapRowToSessionData(rows[0]);
   *   } finally {
   *     await client.end();
   *   }
   */
  async _getFromRelationalDb(criteria) {
    throw new Error(
      '[session] DbSessionProvider._getFromRelationalDb non ancora implementato. ' +
        'Configurare SESSION_DB_* e completare la query verso il DB relazionale, ' +
        'filtrando almeno per codmarket ' +
        `(criteria=${JSON.stringify(criteria)}).`
    );
  }

  /**
   * TODO: implementare la lettura da DynamoDB quando sara' nota la tabella.
   *
   * Esempio indicativo (richiede "@aws-sdk/client-dynamodb" e "@aws-sdk/lib-dynamodb"):
   *   const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
   *   const { DynamoDBDocumentClient, GetCommand } = require('@aws-sdk/lib-dynamodb');
   *   const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region: this.config.awsRegion }));
   *   const { Item } = await client.send(new GetCommand({
   *     TableName: this.config.dynamoTableName,
   *     // codmarket fa parte della chiave (partition key) per isolare i dati per mercato.
   *     Key: { codmarket: criteria.codmarket, pdvId: criteria.pdvId },
   *   }));
   *   return this._mapRowToSessionData(Item);
   */
  async _getFromDynamoDb(criteria) {
    throw new Error(
      '[session] DbSessionProvider._getFromDynamoDb non ancora implementato. ' +
        'Configurare SESSION_DYNAMO_TABLE/AWS_REGION e completare la lettura da DynamoDB, ' +
        'filtrando almeno per codmarket ' +
        `(criteria=${JSON.stringify(criteria)}).`
    );
  }

  /**
   * Converte una riga/record del DB nel formato atteso dal modulo session.
   * Da completare in base ai nomi reali delle colonne/attributi.
   * @param {object} row
   * @returns {object}
   */
  _mapRowToSessionData(row) {
    if (!row) return null;
    return {
      codmarket: row.codmarket,
      oic: row.oic,
      sincom: row.sincom,
      physicalsite: row.physical_site ?? row.physicalsite,
      pdvId: row.pdv_id ?? row.pdvId,
      sessionbrand: row.sessionbrand,
      inmandate: row.inmandate,
      language: row.language,
      isdml: row.isdml,
      dmlcustomerupdate: row.dmlcustomerupdate,
      dmldiscount: row.dmldiscount,
      brandvehic_genome: row.brandvehic_genome,
      brandvehic_reftech: row.brandvehic_reftech,
      brandvehic_fca: row.brandvehic_fca,
      pkwstouse: row.pkwstouse,
      vat: row.vat ?? 0.22,
      usertype: row.user_type ?? row.usertype,
      interiorcarwash: row.interior_car_wash ?? row.interiorcarwash,
      exteriorcarwash: row.exterior_car_wash ?? row.exteriorcarwash,
      partpref_old: row.part_pref_old ?? row.partpref_old,
      partpref_original: row.part_pref_original ?? row.partpref_original,
      partpref_returned: row.part_pref_returned ?? row.partpref_returned,
      partpref_circularec: row.part_pref_circular_economy ?? row.partpref_circularec,
      pcydealer1: row.pcy_dealer1 ?? row.pcydealer1,
      pcydealer2: row.pcy_dealer2 ?? row.pcydealer2,
      pcydealer3: row.pcy_dealer3 ?? row.pcydealer3,
      pcystellantis1: row.pcy_stellantis1 ?? row.pcystellantis1,
      pcystellantis2: row.pcy_stellantis2 ?? row.pcystellantis2,
      pcystellantis3: row.pcy_stellantis3 ?? row.pcystellantis3,
      maxdiscountperc: row.max_discount_perc ?? row.maxdiscountperc,
      maxdiscountval: row.max_discount_val ?? row.maxdiscountval,
    };
  }
}

module.exports = DbSessionProvider;
