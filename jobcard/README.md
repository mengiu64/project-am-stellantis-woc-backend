# JobCard Lambda

Client Node.js per l'integrazione con le API Stellantis DGT (Digital Layer).  
Ottiene un token da **PingFederate** e lo usa per interrogare i servizi **JobCard List** e **JobCard Details**, e per inviare (**JobCard Save**) i payload di Digital Job Card costruiti dalla lambda `djc`.

---

## Struttura del progetto

```
jobcard/
├── config.js          # Credenziali e URL di tutti i servizi
├── httpClient.js      # Wrapper HTTPS (no dipendenze esterne)
├── authService.js     # Autenticazione PingFederate → Bearer token
├── jobCardService.js  # getJobCardList / getJobCardDetails / saveJobCard
├── JobcardSyncActivityRepository.js # UPSERT woc.jobcard_sync_activity (saveJobcard)
├── db.js              # Pool pg Aurora "wiadvisor" (RDS Proxy + Secrets Manager)
├── index.js           # Entry point CLI
└── package.json
```

> Dipendenze npm: SDK AWS (DynamoDB/Secrets Manager) e `pg` (solo per `saveJobcard`).

---

## Prerequisiti

- Node.js >= 14
- Accesso di rete agli endpoint:
  - `idfed-preprod.mpsa.com:443` (PingFederate)
  - `emea-aws.stage.np-api.stellantis.com` (DGT API)

---

## Flusso

```
index.js
   │
   ├─► authService.js  ──POST──► PingFederate  →  token
   │
   └─► jobCardService.js
           ├─► getJobCardList(token, dealerId)     ──GET──►  /jobCardList
           ├─► getJobCardDetails(token, jobCardId)  ──GET──►  /jobCardDetails
           └─► saveJobCard(token, payload)          ──POST──► /jobCard
```

---

## Utilizzo

### JobCard List

Restituisce la lista delle job card per un determinato dealer.

```bash
node index.js list <dealerId>
```

**Esempio:**
```bash
node index.js list 0062219
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `dealerId` | parametro di input |
| `Authorization` | `Bearer <token>` |

---

### JobCard Details

Restituisce il dettaglio di una singola job card.

```bash
node index.js details <jobCardId>
```

**Esempio:**
```bash
node index.js details 79
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `jobCardId` | parametro di input |
| `Authorization` | `Bearer <token>` |

---

### JobCard Save

Invia (POST) un payload di Digital Job Card alla Push API SRP. Il payload è
tipicamente il `json_mod` prodotto da uno dei metodi `Save*` della lambda `djc`
(`SaveRoInfo`, `SaveCustomer`, ...): questa azione ne effettua l'invio effettivo
usando lo stesso client PingFederate/DGT di `getJobCardList`/`getJobCardDetails`.

```bash
node index.js saveJobcard <payloadJsonFile>
```

**Esempio:**
```bash
node index.js saveJobcard ./payload.json
```

**Header inviati:**
| Header | Valore |
|---|---|
| `X-IBM-Client-Id` | configurato in `config.js` |
| `X-IBM-Client-Secret` | configurato in `config.js` |
| `Content-Type` | `application/json` |
| `Authorization` | `Bearer <token>` |

> **Nota**: `saveJobcard` (POST `/jobCard`) è la stessa azione esposta anche dalla
> lambda `djc` (stesso client PingFederate/DGT). **API Gateway instrada la POST
> `/api/repairorder/saveJobcard` (`/api/repairorder/{proxy+}`) verso questa
> lambda (`jobcard`)**; la versione di `djc` resta per invocazione diretta/CLI.

**Tracciamento su DB (`woc.jobcard_sync_activity`)**: prima dell'invio a DGT
(e prima del recupero del token) il payload sanitizzato viene salvato con un
UPSERT su `jobcardid` = `roInfo.jobCardSrpId` (fallback `dmsRepairOrderId`, poi
`jobCardLegacyId`): al primo inserimento `creationdate` = `now()`, ai successivi
viene aggiornato solo `payload`; `ack`/`techreason`/`businessreason`/`lastupdate`
sono popolati in un secondo momento. Bloccante: id mancante → `400`, errore DB →
`502`, e il payload non viene inviato a DGT. Da CLI il salvataggio avviene dopo la
sync NAGA (che può valorizzare `appointments[].appointmentInternalId`), così la
tabella contiene il payload effettivamente inviato. Stessa implementazione di
`djc` (v. [`djc/README.md`](../djc/README.md)); DDL in
`sql/create_table_jobcard_sync_activity.sql`.

**Payload e obbligatorietà**: il payload (`roInfo` obbligatorio, più le sezioni
opzionali `customerInfo[]`, `vehicleInfo`, `jobs[]`, ecc.) segue le stesse
regole di obbligatorietà (M/M(O)/M(C)) e le stesse regole di
creazione/aggiornamento del documento **"SRP - DL DJC Post API Specification"**,
documentate in dettaglio in [`djc/README.md`](../djc/README.md#payload-struttura-e-regole-di-obbligatorietà)
e nello schema `JobCardSaveRequest` di `swagger-woc.yaml`
(`POST /api/repairorder/{method}`, `method=save`).

**Payload minimo:**

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

---

### Arricchimento della risposta `getJobCardDetails`

Prima di essere restituita, la risposta di `getJobCardDetails` viene arricchita da `sanitizeJobCardDetails` con i seguenti campi calcolati (non presenti nella risposta originale della DGT API):

#### `jobs[].packageType` / `jobs[].packageCharge`

Aggiunti a ciascun elemento di `jobs`, posizionati **prima** di `partInfo`/`laborInfo` quando presenti (per leggibilità). Derivati da `jobType`/`packageCode` del job:

| `jobType`                              | `packageCode`            | `packageType` | `packageCharge`                                  |
|-----------------------------------------|---------------------------|----------------|---------------------------------------------------|
| `MFP`                                    | -                          | `FP`           | `CUSTOMER`                                        |
| `STD`                                    | presente (non vuoto/null) | `QE`           | `CUSTOMER`                                        |
| `LFP`                                    | -                          | `LFP`          | `CUSTOMER`                                        |
| `STD`                                    | assente/vuoto/null        | `GC`           | `CUSTOMER`                                        |
| assente/vuoto/null                       | -                          | `GC`           | `CUSTOMER`                                        |
| qualsiasi altro valore non vuoto/null   | -                          | `GC`           | `INTERNAL`                                        |

Se il job ha un campo `paymentType` valorizzato, `packageCharge` assume **sempre** quel valore (sovrascrive il risultato della tabella sopra); `packageType` resta invece sempre derivato da `jobType`/`packageCode` come sopra.

#### `roInfo.roSource`

Aggiunto subito dopo `roInfo.sourceApplication`, con lo **stesso valore** di quest'ultimo (se `roInfo`/`sourceApplication` sono assenti, `roSource` non viene aggiunto).

#### Arricchimento DML (`jobs[].partInfo[]`/`jobs[].laborInfo[]`)

Dopo `sanitizeJobCardDetails` ma **prima** di essere persistita in cache (`saveJobCardDetailsToTmp`), la risposta viene ulteriormente arricchita da `getDataFromDML` (v. `getCartPriceAndAvailability`/`applyDataFromDml`), che interroga il gateway DML (`dms/dmsService.js::postDmsInquiry`) per prezzo/disponibilità/sconto aggiornati di ricambi e manodopera. `getJobCardDetails` accetta un terzo parametro opzionale `sessionContext` (username/mainSincom/market/language/dealerCountryCode), propagato a `getDataFromDML` per costruire il Sender dinamico dell'inquiry DMS (v. `buildDmsSender`) — v. anche sezione `getCartPriceAndAvailability` nel README principale. La scrittura della cache omette i valori `undefined` durante la conversione DynamoDB, evitando che campi facoltativi non valorizzati impediscano di salvare e rileggere il dettaglio. Best-effort: eventuali problemi verso `dms` non fanno fallire la risposta di `getJobCardDetails`.

Ogni elemento di `partInfo[]`/`laborInfo[]` mantiene `dmsunknown` (solo per i ricambi: 1 se il partNumber non trova corrispondenza, 0 altrimenti). A livello di ciascun `job` viene inoltre aggiunto il flag `dmsOverride` (booleano): `true` se il prezzo cambia o viene applicato/modificato uno sconto DMS su almeno un `partInfo[]`/`laborInfo[]`; un semplice match senza variazioni di prezzo/sconto non basta. Se `dmsDiscountPercentage` del dettaglio coincide già con quello restituito dal DMS, lo sconto non viene riconciliato una seconda volta: prezzi invariati restano invariati e `dmsOverride` resta `false`, mentre un eventuale cambio di prezzo viene ricalcolato usando lo sconto già presente. Gli importi monetari ricalcolati sono arrotondati a due decimali (v. `applyDataFromDml`).

Quando `job.dmsOverride === true`, vengono inoltre ricalcolati (sommando i valori correnti di `partInfo[]`/`laborInfo[]`) i totali del job: `originalPriceExclVat`/`originalPriceWithVat`/`priceExclVatAfterDiscount`/`priceWithVatAfterDiscount`/`discountInAmountOnPriceWithVat`, `totalPartsAmountRequested`/`totalLaborAmountRequested` (somma di `originalPriceExclVat`, cioè l'importo prima dello sconto, rispettivamente di `partInfo[]`/`laborInfo[]`) e `totalLaborDurationRequested` (somma di `laborInfo[].laborDuration`) — v. `recalculateJobTotals`. Se **almeno un** job del jobCardDetail ha `dmsOverride === true`, viene ricalcolato anche `roInfo.totalPrice` sommando i totali di **tutti** i `jobs[]`: `originalPriceExclVat`/`originalPriceWithVat`/`priceExclVatAfterDiscount`/`priceWithVatAfterDiscount`, più il breakdown per modalità di pagamento `totalCustomerWithVat`/`totalInsuranceWithVat`/`totalManufacturerWithVat`/`totalInternalWithVat` (somma di `job.priceWithVatAfterDiscount` raggruppato per `job.paymentType`, o `job.packageCharge` quando `paymentType` non è valorizzato) — v. `recalculateRoInfoTotals`. Se nessun part/labor di nessun job trova match nel DML, né i job né `roInfo.totalPrice` vengono toccati (restano i totali originali, tipicamente da DGT); `recalculateRoInfoTotals` è comunque un no-op se `jobCardDetail.roInfo` è assente.

---

## Configurazione

Le credenziali vengono lette da **variabili d'ambiente**. Non inserire mai valori reali in `config.js`.

### Sviluppo locale

Copia `.env.example` in `.env` e inserisci i valori reali:

```bash
cp .env.example .env
```

```ini
# .env  (NON committare questo file — è in .gitignore)
JOBCARD_PING_CLIENT_ID=your_ping_client_id_here
JOBCARD_PING_CLIENT_SECRET=your_ping_client_secret_here
DGT_CLIENT_ID=your_dgt_client_id_here
DGT_CLIENT_SECRET=your_dgt_client_secret_here
# woc.jobcard_sync_activity (solo saveJobcard)
JOBCARD_DB_HOST=your_rds_proxy_endpoint_here
JOBCARD_DB_USER=wiadvisor_app
JOBCARD_DB_PASSWORD=your_db_password_here
```

`config.js` carica automaticamente il file `.env` se presente, senza dipendenze npm.

### Lambda / produzione

Configura le variabili d'ambiente direttamente sull'ambiente di esecuzione (es. AWS Lambda Environment Variables, CI/CD secrets):

| Variabile | Descrizione |
|---|---|
| `JOBCARD_PING_CLIENT_ID` | Client ID PingFederate (dedicato jobcard) |
| `JOBCARD_PING_CLIENT_SECRET` | Client Secret PingFederate (dedicato jobcard) |
| `DGT_CLIENT_ID` | Client ID Stellantis DGT API |
| `DGT_CLIENT_SECRET` | Client Secret Stellantis DGT API |
| `JOBCARD_DB_HOST` | Endpoint RDS Proxy Aurora "wiadvisor" (`woc.jobcard_sync_activity`, solo `saveJobcard`) |
| `JOBCARD_DB_SECRET_ID` | Secret Aurora `wiadvisor_app` (default `sm-np-bsn0027990-dev-aurora-app`); in locale in alternativa `JOBCARD_DB_USER`/`JOBCARD_DB_PASSWORD` |
| `JOBCARD_DB_PORT` / `JOBCARD_DB_NAME` / `JOBCARD_DB_SSL` | Opzionali (default dal secret / `5432` / `wiadvisor`; `JOBCARD_DB_SSL=false` solo per Postgres locale senza TLS) |

---

## Troubleshooting

| Errore | Causa | Soluzione |
|---|---|---|
| `EAI_AGAIN <hostname>` | DNS non risolve (tipico in WSL) | `echo "nameserver 8.8.8.8" \| sudo tee /etc/resolv.conf` |
| `HTTP 401` | Token scaduto o credenziali errate | Verificare `clientId` / `clientSecret` in `config.js` |
| `HTTP 403` | Scope insufficiente o IP non autorizzato | Verificare `scope` e whitelist IP |
| `Comando non valido` | Lanciato senza argomenti | Specificare `list` o `details` come primo argomento |
