# djc — Node.js Digital Job Card (Push API SRP)

Modulo Node.js autoconsistente che costruisce i payload da inviare alla **Push API SRP**
(Digital Job Card) a partire dal contenuto di riferimento (`json_orig`), letto da
`/tmp/<jobCardId>.json` — il jobCardDetails salvato lì dalla lambda `jobcard`
(`jobCardService.js::getJobCardDetails`), così da evitare una nuova chiamata a DGT.
Se non è disponibile un `jobCardId` (uso locale/CLI senza una jobcard reale), si ricade
su `get.json`, un'istantanea statica di riferimento usata anche nei test.

Oltre ai metodi `Save*` (che costruiscono solo i payload `json_orig`/`json_mod` in
locale), `djc` espone anche **`saveJobcard`**: l'azione che invia effettivamente
il payload alla Push API SRP tramite `POST /jobCard`, usando **lo stesso client
PingFederate/DGT della lambda `jobcard`** (`config.js`/`authService.js`/`httpClient.js`,
copie sincronizzate con quelle di `jobcard`, che usa le stesse per le `GET
/jobCardList` e `/jobCardDetails`). `saveJobcard` è replicata identica anche in
`jobcard` (stesso `jobCardService.js::saveJobCard`), ma **API Gateway instrada le
richieste POST verso la lambda `djc`**, non verso `jobcard`.

## Struttura

```
djc/
├── index.js             ← CLI entry-point + Lambda handler (dispatcher per metodo)
├── DjcManager.js         ← classe orchestratore (payload json_orig/json_mod)
├── jobCardService.js     ← saveJobCard (POST /jobCard) — client condiviso con jobcard
├── authService.js        ← autenticazione PingFederate → ****** (copia di jobcard/authService.js)
├── httpClient.js         ← wrapper HTTPS (copia di jobcard/httpClient.js)
├── config.js              ← credenziali/URL DGT (copia di jobcard/config.js)
├── get.json               ← fallback statico (usato solo quando jobCardId è assente)
├── __tests__/
│   ├── DjcManager.test.js    ← test automatici (Jest)
│   ├── jobCardService.test.js
│   ├── authService.test.js
│   └── httpClient.test.js
├── package.json
├── .env.example           ← template variabili d'ambiente
└── .env                    ← configurazione locale (non committare)
```

> `config.js`/`authService.js`/`httpClient.js` sono mantenuti **in sync** con gli
> omonimi file di `jobcard`: qualsiasi modifica al client PingFederate/DGT va
> replicata in entrambe le lambda.

## Setup

```bash
cd djc
npm install
cp .env.example .env   # solo se si usa saveJobcard — non serve per i metodi Save*
```

## Classe `DjcManager`

```js
const { DjcManager } = require('./DjcManager');

const manager = new DjcManager(undefined, '84564621');
// manager.djcJson contiene il JSON parsato di /tmp/84564621.json
```

Il costruttore è `DjcManager(djcJson, jobCardId)`:
- `djcJson` esplicito (utile nei test) ha sempre la precedenza;
- altrimenti, se è presente `jobCardId`, legge e parsa `/tmp/<jobCardId>.json`;
- se `jobCardId` è assente, ricade su `get.json` (fallback locale/di test).

Se il file `/tmp/<jobCardId>.json` non esiste (o non è leggibile), il costruttore
lancia un errore esplicito (`[djc] impossibile leggere /tmp/<jobCardId>.json: ...`).

> **Lambda handler**: `jobCardId` è un parametro obbligatorio del body (`{ "jobCardId": "84564621", ... }`);
> la richiesta viene rigettata con `400` se assente, prima di istanziare `DjcManager`.
>
> **CLI**: `jobCardId` è opzionale, passato come flag globale `--jobCardId <id>` prima del
> comando, es. `node index.js --jobCardId 84564621 SaveDmsSync SYNCED`. Se omesso, il CLI
> usa `get.json` come in precedenza.

### Metodi disponibili

| Metodo               | Stato                | Descrizione                                                                 |
|-----------------------|-----------------------|------------------------------------------------------------------------------|
| `SaveRoInfo`          | ✅ implementato       | `json_orig`/`json_mod` per `jobCardDetail.roInfo` (sottoinsieme esteso)      |
| `SaveDmsSync`         | ✅ implementato       | `json_orig`/`json_mod` per `jobCardDetail.roInfo` (sottoinsieme base)       |
| `SaveCustomer`        | ✅ implementato       | `json_orig`/`json_mod` per roInfo (base) + `customerInfo[0].personalInfo.contactInfo` |

| `SaveVehicle`         | ✅ implementato       | `json_orig`/`json_mod` per roInfo (base) + `vehicleInfo.{identification,state}` |
| `SaveJobs`            | ✅ implementato       | `json_orig`/`json_mod` per roInfo (base) + copia di `jobCardDetail.jobs`    |
| `SaveConsents`        | ✅ implementato       | `json_orig`/`json_mod` per roInfo (base) + `consents[0].{repairer,stellantis}` |
| `SaveAppointments`    | ✅ implementato       | `json_orig`/`json_mod` per roInfo (base) + `appointments[0].{reception,delivery}` |

I metodi non ancora specificati lanciano un `Error` esplicito (`"<Metodo> non ancora
implementato"`) finché non verranno definiti.

Tutti i metodi implementati condividono un sottoinsieme "base" di `roInfo`
(`jobCardSrpId`, `jobCardLegacyId`, `sourceApplication`, `dealerId`, `stellantisBrand`,
`status`, `updateDateTime`, `dmsSynchroStatus`), a cui `SaveRoInfo` aggiunge i campi
specifici (`interiorCarWash`, `exteriorCarWash`, `partPreferences`, `obfcm`,
`waitOnSite`, `vehicleIdentificationTagNumber`, `loanerFlag`).

### `SaveRoInfo`

```js
const { json_orig, json_mod } = manager.SaveRoInfo(
  interiorCarWash,
  exteriorCarWash,
  old,
  original,
  returned,
  circularEconomy,
  obfcm,
  waitOnSite,
  vehicleIdentificationTagNumber,
  loanerFlag,
);
```

- **`json_orig`**: `{ roInfo: {...} }` con il sottoinsieme di campi previsto dal payload
  SaveRoInfo (`jobCardSrpId`, `jobCardLegacyId`, `sourceApplication`, `dealerId`,
  `stellantisBrand`, `status`, `updateDateTime`, `dmsSynchroStatus`, `interiorCarWash`,
  `exteriorCarWash`, `partPreferences`, `obfcm`, `waitOnSite`,
  `vehicleIdentificationTagNumber`, `loanerFlag`), letto da
  `djcJson.jobCardDetail.roInfo` e non alterato.
- **`json_mod`**: stessa struttura di `json_orig`, con i seguenti campi sovrascritti
  con i valori passati come argomento:
  - `interiorCarWash`, `exteriorCarWash`, `obfcm`, `waitOnSite`,
    `vehicleIdentificationTagNumber`, `loanerFlag` — assegnati direttamente a `roInfo`.
  - `old`, `original`, `returned`, `circularEconomy` — assegnati a
    `roInfo.partPreferences[0]` (creato se assente o vuoto).

  Tutti gli altri campi del sottoinsieme (`jobCardSrpId`, `status`, `dmsSynchroStatus`,
  ecc.) restano invariati rispetto a `json_orig`.

### `SaveDmsSync`

```js
const { json_orig, json_mod } = manager.SaveDmsSync(dmsSynchroStatus);
```

- **`json_orig`**: `{ roInfo: {...} }` con il sottoinsieme base di
  `djcJson.jobCardDetail.roInfo`, non alterato.
- **`json_mod`**: stessa struttura, con `dmsSynchroStatus` sovrascritto dal valore
  ricevuto come argomento.

### `SaveCustomer`

```js
const { json_orig, json_mod } = manager.SaveCustomer(
  phone, mobile, email, address, additionalAddress,
);
```

- **`json_orig`**: `{ roInfo: {...}, customerInfo: [{ personalInfo: { contactInfo: {...} } }] }`,
  con il sottoinsieme base di `roInfo` e i dati di contatto correnti letti da
  `djcJson.jobCardDetail.customerInfo[0].personalInfo.contactInfo`, non alterati.
- **`json_mod`**: stessa struttura, con `customerInfo[0].personalInfo.contactInfo`
  sovrascritto con i valori ricevuti come argomento (`phone`, `mobile`, `email`,
  `address`, `additionalAddress`).

### `SaveVehicle`

```js
const { json_orig, json_mod } = manager.SaveVehicle(
  licensePlate, odometerOut, mileageUnits, fuelReserveLevel, batteryReserveLevel,
);
```

- **`json_orig`**: `{ roInfo: {...}, vehicleInfo: { identification: { licensePlate }, state: {...} } }`,
  con il sottoinsieme base di `roInfo` e i dati veicolo correnti letti da
  `djcJson.jobCardDetail.vehicleInfo`, non alterati.
- **`json_mod`**: stessa struttura, con `vehicleInfo.identification.licensePlate` e
  `vehicleInfo.state.{odometerOut,mileageUnits,fuelReserveLevel,batteryReserveLevel}`
  sovrascritti con i valori ricevuti come argomento.

### `SaveJobs`

```js
const { json_orig, json_mod } = manager.SaveJobs();
```

- **`json_orig`**: `{ roInfo: {...}, jobs: [...] }`, con il sottoinsieme base di
  `roInfo` e una copia di `djcJson.jobCardDetail.jobs`.
- **`json_mod`**: identico a `json_orig` (il metodo non riceve argomenti da
  sovrascrivere).

### `SaveConsents`

```js
const { json_orig, json_mod } = manager.SaveConsents(
  channelCode1, channelCode2, channelCode3, channelCode4, channelCode5, channelCode6,
);
```

- **`json_orig`**: `{ roInfo: {...}, consents: [{ repairer: [...], stellantis: [...] }] }`,
  con il sottoinsieme base di `roInfo` e i consensi correnti letti da
  `djcJson.jobCardDetail.consents[0]`, non alterati.
- **`json_mod`**: stessa struttura, con `privacyIndicator` di ciascuna voce
  aggiornato al valore ricevuto come argomento: `channelCode1..3` →
  `repairer[0..2].privacyIndicator`, `channelCode4..6` →
  `stellantis[0..2].privacyIndicator`. Il campo `channelCode` di ciascuna voce
  non viene alterato.

### `SaveAppointments`

```js
const { json_orig, json_mod } = manager.SaveAppointments(
  estimatedReceptionDateTime, receptionDateTime, receptionServiceAdvisorId, receptionServiceAdvisorName,
  estimatedDeliveryDateTime, deliveryDateTime, deliveryServiceAdvisorId, deliveryServiceAdvisorName,
);
```

- **`json_orig`**: `{ roInfo: {...}, appointments: [{ reception: {...}, delivery: {...} }] }`,
  con il sottoinsieme base di `roInfo` e l'appuntamento corrente letto da
  `djcJson.jobCardDetail.appointments[0]`, non alterato.
- **`json_mod`**: stessa struttura, con `reception.{estimatedReceptionDateTime,
  receptionDateTime, receptionServiceAdvisorId, receptionServiceAdvisorName}` e
  `delivery.{estimatedDeliveryDateTime, deliveryDateTime, deliveryServiceAdvisorId,
  deliveryServiceAdvisorName}` sovrascritti con i valori ricevuti come argomento.

## Uso da CLI (`index.js`)

```bash
node index.js SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>
node index.js SaveDmsSync <dmsSynchroStatus>
node index.js SaveCustomer <phone> <mobile> <email> <address> <additionalAddress>
node index.js SaveVehicle <licensePlate> <odometerOut> <mileageUnits> <fuelReserveLevel> <batteryReserveLevel>
node index.js SaveJobs
node index.js SaveConsents <channelCode1> <channelCode2> <channelCode3> <channelCode4> <channelCode5> <channelCode6>
node index.js SaveAppointments <estimatedReceptionDateTime> <receptionDateTime> <receptionServiceAdvisorId> <receptionServiceAdvisorName> <estimatedDeliveryDateTime> <deliveryDateTime> <deliveryServiceAdvisorId> <deliveryServiceAdvisorName>
```

Esempi:

```bash
node index.js SaveRoInfo "2/2" "2/2" yes yes false false true false TAG-999 Y
node index.js SaveDmsSync SYNCED
node index.js SaveCustomer "+39-06-1111111" "+39-333-2222222" test@example.com "Via Roma 1" "Interno 2"
node index.js SaveVehicle "EH-436-DG" 12345 km 3 85
node index.js SaveJobs
node index.js SaveConsents true false true false true false
node index.js SaveAppointments "2026-01-01T09:00:00Z" "2026-01-01T09:10:00Z" SA-1 Mario "2026-01-01T17:00:00Z" "2026-01-01T17:10:00Z" SA-2 Luigi
```

### `saveJobcard`

```bash
node index.js saveJobcard <payloadJsonFile>
```

Legge il payload JSON da inviare (tipicamente il `json_mod` prodotto da uno dei
metodi `Save*`) da `<payloadJsonFile>` e lo invia con `POST /jobCard` usando lo
stesso client PingFederate/DGT di `jobcard`. Richiede le variabili d'ambiente
`JOBCARD_PING_CLIENT_ID`, `JOBCARD_PING_CLIENT_SECRET`, `DGT_CLIENT_ID`,
`DGT_CLIENT_SECRET` (vedi `.env.example`); a differenza degli altri metodi, non
richiede `--jobCardId`.

```bash
node index.js saveJobcard ./payload.json
```

## Uso come Lambda

Il file `index.js` espone `exports.handler`, che instrada l'evento in base al campo
`action` (o all'ultimo segmento del path, in caso di integrazione proxy API Gateway):

```json
{
  "action": "SaveRoInfo",
  "body": {
    "interiorCarWash": "2/2",
    "exteriorCarWash": "2/2",
    "old": "yes",
    "original": "yes",
    "returned": false,
    "circularEconomy": false,
    "obfcm": true,
    "waitOnSite": false,
    "vehicleIdentificationTagNumber": "TAG-999",
    "loanerFlag": "Y"
  }
}
```

### `saveJobcard` (POST `/jobCard`)

```json
{
  "action": "saveJobcard",
  "body": {
    "roInfo": { "jobCardSrpId": "JCID-1", "...": "..." }
  }
}
```

`body` è inviato tal quale come payload della `POST /jobCard` (oppure, se presente,
`body.payload`). **API Gateway instrada le richieste POST verso la lambda `djc`**
per questa azione; la lambda `jobcard` espone la stessa azione (`jobCardService.js::
saveJobCard`) per chiamata diretta/CLI, ma non è il target dell'integrazione POST.

#### Payload: struttura e regole di obbligatorietà

Riferimento: documento **"SRP - DL DJC Post API Specification"**. Lo swagger
`swagger-woc.yaml` (path `/api/repairorder/{method}`, `POST`, `method=save`)
riporta lo schema completo (`JobCardSaveRequest` e schemi `JobCardSave*`) con
esempi minimo e completo.

Il payload rispecchia la struttura di `jobCardDetail` (stesse sezioni:
`roInfo`, `customerInfo[]`, `vehicleInfo`, `contractCoverage`, `estimatesLinks[]`,
`recallCampaigns[]`, `vor`, `vehicleReporting[]`, `jobs[]`, `consents[]`,
`futureWorks[]`, `prepaymentInfo[]`, `appointments[]`, `mobility[]`,
`workShopActivities[]`, `attachmentLinks`, `partOrderLinks[]`, `repairOrderDoc`,
`communication`).

**Creazione vs. aggiornamento** — il server verifica, in ordine, se esiste già
una Job Card che soddisfa una di queste condizioni (altrimenti ne crea una nuova):

1. `roInfo.jobCardSrpId` corrisponde ad una Job Card esistente;
2. `roInfo.jobCardLegacyId` + `roInfo.dealerId` corrispondono ad una Job Card esistente;
3. `roInfo.dmsRepairOrderId` + `roInfo.dealerId` corrispondono ad una Job Card esistente.

**Campi obbligatori:**

| Tipo | Campo | Note |
|---|---|---|
| M | `roInfo.sourceApplication` | sempre obbligatorio |
| M | `roInfo.dealerId` | sempre obbligatorio |
| M | `roInfo.updateDateTime` | sempre obbligatorio |
| M(C) | `roInfo.dmsRepairOrderId` **o** `roInfo.jobCardSrpId` **o** `roInfo.jobCardLegacyId` | almeno uno dei tre deve essere presente |
| M(O) | vedi tabella sotto | obbligatorio **solo se** la relativa sezione/array è incluso nel payload |

Per i campi **M(O)**: se una sezione (array) è presente, **ogni elemento**
dell'array deve riportare il proprio campo identificativo; in caso contrario
l'intera richiesta viene rigettata (nessuna sezione viene aggiornata). Il
server usa l'identificativo per decidere se creare un nuovo elemento
dell'array oppure aggiornare quello esistente (id noto → update dei soli campi
inviati; id non noto → create):

| Sezione (array) | Campo identificativo M(O) |
|---|---|
| `customerInfo[]` | `customerId` |
| `estimatesLinks[]` | `internalEstimateId` |
| `recallCampaigns[]` | `campaignCode` |
| `contractCoverage.contractInfo[]` | `contractCode` |
| `jobs[]` | `jobInternalId` |
| `jobs[].contract[]` | `contractCode` |
| `jobs[].partInfo[]` | `partId` |
| `jobs[].laborInfo[]` | `laborOperationId` |
| `jobs[].externalJobLabor[]` | `externalJobId` |
| `jobs[].freeText[]` | `textId` |
| `jobs[].fees[]` | `feeId` |
| `appointments[]` | `appointmentInternalId` |

**Altre regole funzionali:**

- **Rimozione di un elemento**: impostare `removalAction: true` sull'elemento
  (in aggiunta al proprio campo identificativo M(O)) invece di rimuoverlo dal
  payload. Supportato su `customerInfo[]`, `jobs[]`, `jobs[].partInfo[]`,
  `jobs[].laborInfo[]`, `jobs[].externalJobLabor[]`, `jobs[].freeText[]`,
  `jobs[].fees[]`. Rimuovere un `job` rimuove anche tutti i suoi sotto-elementi.
- **Aggiornamento parziale**: per ogni elemento di un array, inviare solo i
  campi da modificare; i campi assenti mantengono il valore attualmente
  salvato in DJC.
- **Azzeramento di un valore**: per nullificare un valore, inviare l'attributo
  con valore vuoto/`null`; se un attributo non è presente nella push, il suo
  valore in DJC non viene modificato.
- Per il source `"PANIER"` (ServiceBox) è prevista una soluzione temporanea:
  l'intera Job Card viene inviata ad ogni push, e DJC ricava le differenze
  rispetto al contenuto già salvato.
- `jobs[].freeText` è un **array** di `{ textId, textContent, removalAction }`
  (non un singolo oggetto).

**Payload minimo** (solo i campi M + M(C)):

```json
{
  "roInfo": {
    "dmsRepairOrderId": "DMS-PNR-100403",
    "sourceApplication": "DMS",
    "dealerId": "RRDI/SINCOM/OIC",
    "brand": "0P",
    "stellantisBrand": "AP",
    "updateDateTime": "2026-04-10T11:55:00Z"
  }
}
```

**Payload completo** (esempio "Full push Request to Create a new Job card"
tratto dal documento di specifica): vedi l'esempio `full` nello swagger
`swagger-woc.yaml` (`requestBody.content.application/json.examples.full`).

**Risposta di successo (200):**

```json
{
  "response": {
    "statuscode": "200",
    "success": true,
    "jobCardId": "JCID-609",
    "message": "Job card Transaction Successful"
  }
}
```

**Risposta di errore (400/401/404/500):**

```json
{
  "response": {
    "status": "fail",
    "message": "Validation error",
    "code": "ValidationError",
    "errors": [
      { "message": "\"roInfo.dealerId\" is required", "path": "roInfo.dealerId" }
    ]
  }
}
```

## Test automatici

```bash
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```
