# djc — Node.js Digital Job Card (Push API SRP)

Modulo Node.js autoconsistente che costruisce i payload da inviare alla **Push API SRP**
(Digital Job Card) a partire dal contenuto di riferimento (`json_orig`), letto da
`/tmp/<jobCardId>.json` — il jobCardDetails salvato lì dalla lambda `jobcard`
(`jobCardService.js::getJobCardDetails`), così da evitare una nuova chiamata a DGT.
Se non è disponibile un `jobCardId` (uso locale/CLI senza una jobcard reale), si ricade
su `get.json`, un'istantanea statica di riferimento usata anche nei test.

## Struttura

```
djc/
├── index.js            ← CLI entry-point + Lambda handler (dispatcher per metodo)
├── DjcManager.js        ← classe orchestratore
├── get.json             ← fallback statico (usato solo quando jobCardId è assente)
├── __tests__/
│   └── DjcManager.test.js ← test automatici (Jest)
├── package.json
└── .env                 ← configurazione (non committare)
```

## Setup

```bash
cd djc
npm install
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

## Test automatici

```bash
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```
