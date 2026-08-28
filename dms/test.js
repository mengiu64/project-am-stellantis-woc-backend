'use strict';

/**
 * test.js — Script manuale per testare l'azione "inquiry" (WorkLinesLevel / MessageType WL)
 * del modulo dms, prendendo come riferimento la logica di
 * COMMON\classes\DMS\DMLManager.class.php::WorkLinesLevel() /
 * COMMON\classes\DMS\DMLManager.class.php::PartsAvailability()
 * (quest'ultima e' quella realmente usata in produzione, vedi WadManager::getPartsAvailabilityXP()).
 *
 * Costruisce a mano il payload InquiryRequest (ApplicationArea, PartsInquiryHeader, WorkLines)
 * ed effettua la chiamata reale POST /aftersales/v1/inquiry usando getBearerToken() + postDmsInquiry().
 *
 * Uso:
 *   node test.js
 *   node test.js <documentId> <customerId> <vehicleId>
 */

const { randomUUID } = require('crypto');
const { getBearerToken } = require('./authService');
const { postDmsInquiry } = require('./dmsService');
const config = require('./config');

/**
 * Costruisce ApplicationArea.Sender + CreationDateTime + BODID.
 * Corrisponde a $applicationArea = ... in DMLManager.class.php.
 */
function buildApplicationArea() {
  const s = config.sender;
  return {
    Sender: {
      ComponentID: s.componentId,
      DealerNumberID: s.dealerNumberId,
      DealerNumberIDSource: s.dealerNumberIdSource,
      DealerCountryCode: s.dealerCountryCode,
      LanguageCode: s.languageCode,
      PhysicalSiteID: s.physicalSiteId,
      ServiceID: s.serviceId,
      CurrencyID: s.currencyId,
      Brand: s.brand,
    },
    CreationDateTime: new Date().toISOString(),
    BODID: randomUUID(),
  };
}

/**
 * Costruisce PartsInquiryHeader per MessageType=WL.
 * @param {string} documentId - Repair Order number
 * @param {string} customerId - Customer ID in DMS
 * @param {string} vehicleId  - VIN
 */
function buildPartsInquiryHeader(documentId, customerId, vehicleId) {
  return {
    DocumentID: documentId,
    CustomerIdDms: customerId,
    MessageType: 'WL',
    VehicleID: vehicleId,
  };
}

/**
 * Mappa il tipo di transazione PHP (add/replace/remove) al codice numerico atteso dal gateway.
 * Corrisponde a DMLManager::mapTransactionType() lato PHP.
 */
function mapTransactionType(type) {
  const MAP = { add: 1, replace: 2, remove: 3 };
  return MAP[type] ?? 1;
}

/**
 * Costruisce una singola WorkLine con PartsItem/LaborItem.
 * Corrisponde a $workLine = [...] dentro DMLManager::PartsAvailability().
 */
function buildWorkLine(reference, { transactionType = 'add', partNumbers = [], laborIds = [] } = {}) {
  return {
    CustomerAccountDMSID: null,
    WorkLineReference: reference,
    TransactionType: mapTransactionType(transactionType),
    PartsItem: partNumbers.map((partNumber) => ({
      PartNumber: partNumber,
      PartType: 'O',
      PartStatus: 'L',
    })),
    LaborItem: laborIds.map((laborOperationId) => ({
      LaborOperationID: laborOperationId,
      LaborType: 'L',
    })),
  };
}

/**
 * Esegue la chiamata inquiry con MessageType=WL (WorkLinesLevel).
 * @param {string} documentId
 * @param {string} customerId
 * @param {string} vehicleId
 */
async function runWorkLinesInquiry(documentId, customerId, vehicleId) {
  const body = {
    ApplicationArea: buildApplicationArea(),
    PartsInquiryHeader: buildPartsInquiryHeader(documentId, customerId, vehicleId),
    WorkLines: [
      buildWorkLine('001', {
        transactionType: 'add',
        partNumbers: ['1617282980', '1646186180'],
        laborIds: ['44E19A', '44E2WA'],
      }),
      buildWorkLine('002', { transactionType: 'add' }),
    ],
  };

  console.log('\n=== DMS Inquiry test (WorkLinesLevel / WL) ===');
  console.log('[test] Payload completo:');
  console.log(JSON.stringify(body, null, 2));
  const token = await getBearerToken();
  const result = await postDmsInquiry(token, body);
  console.log('[test] Risposta ricevuta:');
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const [, , documentId = '93825368', customerId = '854265', vehicleId = 'VF3CABHW6GT204366'] =
    process.argv;

  try {
    await runWorkLinesInquiry(documentId, customerId, vehicleId);
  } catch (err) {
    console.error('\n[ERROR]', err.message);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  buildApplicationArea,
  buildPartsInquiryHeader,
  buildWorkLine,
  mapTransactionType,
  runWorkLinesInquiry,
};
