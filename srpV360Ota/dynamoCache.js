'use strict';

/**
 * dynamoCache.js — Wrapper minimale su DynamoDB (tabella TmpCacheTable, v.
 * template.yaml, nome da env DYNAMO_CACHE_TABLE_NAME) usato come sostituto
 * delle cache basate su file /tmp: quelle erano locali all'istanza Lambda
 * "warm" (perse ad ogni cold start/riciclo del container) e MAI condivise
 * tra funzioni Lambda diverse (es. jobcard/djc, due funzioni distinte che
 * NON possono condividere /tmp tra loro).
 *
 * Ogni item ha chiave `cacheKey` (stringa, namespaced per modulo/dato, es.
 * "v360:getdetails:<vin>") e un attributo `expiresAt` (epoch seconds) usato
 * sia come TTL nativo DynamoDB (pulizia asincrona lato AWS, non immediata)
 * sia come controllo esplicito in lettura: getCacheItem ignora un item già
 * scaduto anche se DynamoDB non lo ha ancora fisicamente rimosso (il TTL
 * nativo NON garantisce la cancellazione istantanea allo scadere del tempo).
 *
 * Se DYNAMO_CACHE_TABLE_NAME non è configurato, get/set diventano no-op:
 * interamente best-effort, mai un'eccezione che blocchi il chiamante (stesso
 * criterio già applicato alle precedenti cache su file /tmp).
 */

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');

let docClient;
function getDocClient() {
  if (!docClient) {
    docClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  }
  return docClient;
}

/**
 * @param {string} cacheKey
 * @returns {Promise<*|null>} il valore cachato (già deserializzato), o null se assente/scaduto/errore
 */
async function getCacheItem(cacheKey) {
  const tableName = process.env.DYNAMO_CACHE_TABLE_NAME;
  if (!tableName) return null;

  try {
    const { Item } = await getDocClient().send(new GetCommand({ TableName: tableName, Key: { cacheKey } }));
    if (!Item) return null;
    if (typeof Item.expiresAt === 'number' && Item.expiresAt <= Math.floor(Date.now() / 1000)) {
      return null; // scaduto: il TTL nativo DynamoDB non garantisce la rimozione istantanea
    }
    return Item.value ?? null;
  } catch (err) {
    console.warn(`[dynamoCache] impossibile leggere "${cacheKey}": ${err.message}`);
    return null;
  }
}

/**
 * @param {string} cacheKey
 * @param {*} value           - valore da cachare (serializzabile in JSON)
 * @param {number} ttlSeconds - durata della cache in secondi
 * @returns {Promise<*>} value (sempre restituito, anche in caso di errore di scrittura)
 */
async function setCacheItem(cacheKey, value, ttlSeconds) {
  const tableName = process.env.DYNAMO_CACHE_TABLE_NAME;
  if (!tableName) return value;

  try {
    const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;
    await getDocClient().send(new PutCommand({ TableName: tableName, Item: { cacheKey, value, expiresAt } }));
  } catch (err) {
    console.warn(`[dynamoCache] impossibile scrivere "${cacheKey}": ${err.message}`);
  }
  return value;
}

module.exports = { getCacheItem, setCacheItem };
