# JobCard Lambda

Client Node.js per l'integrazione con le API Stellantis DGT (Digital Layer).  
Ottiene un token da **PingFederate** e lo usa per interrogare i servizi **JobCard List** e **JobCard Details**, e per inviare (**JobCard Save**) i payload di Digital Job Card costruiti dalla lambda `djc`. Rilegge inoltre dal DB l'ultimo payload inviato (**JobCard Last Payload**), per recuperarlo quando l'aggiornamento verso DJC/DGT fallisce.

---

## Struttura del progetto

```
jobcard/
├── config.js          # Credenziali e URL di tutti i servizi
├── httpClient.js      # Wrapper HTTPS (no dipendenze esterne)
├── authService.js     # Autenticazione PingFederate → Bearer token
├── jobCardService.js  # getJobCardList / getJobCardDetails / saveJobCard
├── JobcardSyncActivityRepository.js # woc.jobcard_sync_activity: UPSERT (saveJobcard), lettura esito ack/techReason/businessReason (details/saveJobcard) e ultimo payload (lastPayload)
├── db.js              # Pool pg Aurora "wiadvisor" (RDS Proxy + Secrets Manager)
├── index.js           # Entry point CLI
└── package.json
```

> Dipendenze npm: SDK AWS (DynamoDB/Secrets Manager) e `pg` (solo per `woc.jobcard_sync_activity`: `saveJobcard`, `details` e `lastPayload`).

---

## Prerequisiti

- Node.js >= 14
- Accesso di rete agli endpoint:
  - `idfed-preprod.mpsa.com:443` (PingFederate)
  - `emea-aws.stage.np-api.stellantis.com` (DGT API)
  - endpoint REST privati dei servizi `dms`, `session` e `agendasoanaga`

### Chiamate tra servizi

Le chiamate interne usano `../serviceClient` con autenticazione **AWS_IAM /
SigV4**, non importano sorgenti di altre Lambda e non richiedono le relative
credenziali PingFederate nel consumer:

Configurare `WOC_INTERNAL_API_URL` (endpoint privato, stage `/wia`) e
`WOC_INTERNAL_TIMEOUT_MS=25000`, come in `.env.example`. Le credenziali
PingFederate/DGT e DB presenti nell'esempio sono solo quelle proprie di jobcard.

| Servizio / operazione | Payload |
|---|---|
| `dms / resolveSender` | `{ context: { username, vin }, overrides }` |
| `dms / inquiry` | corpo di dominio `{ PartsInquiryHeader, WorkLines, sender }` |
| `session / getData` | `{ args: [username] }` |
| `agendasoanaga / createnaga` | corpo di dominio originale di creazione |
| `agendasoanaga / updatenaga` | corpo di dominio originale di aggiornamento, incluso `apptId` |

Il client restituisce il risultato di dominio già separato dal wrapper HTTP.
Il dispatcher riconosce prima gli eventi REST interni con `isInternalRequest`
e li inoltra a `internal.js`, senza modificarne il payload né passare dal
dispatcher delle azioni pubbliche.
La cache della sessione e i token DMS restano nei servizi proprietari; la cache
del dettaglio jobcard e i token DGT locali restano invariati.
La sessione viene letta una sola volta per sincronizzazione e non viene letta
senza username. Quando `requestContext.authorizer` è presente, solo `sub` è
attendibile: il body è accettato soltanto in assenza di authorizer.

Errori di trasporto/non-2xx sulla sessione o sulla risoluzione Sender sono
loggati e gestiti best-effort (campi vuoti/override espliciti). Gli errori inquiry
mantengono l'arricchimento best-effort e `dmsAvailable: false`. Errori NAGA sono
loggati senza alterare la risposta pubblica di salvataggio; una creazione senza
`rdvId` mantiene il warning e salta il relativo aggiornamento.

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

**Esito della sincronizzazione (`woc.jobcard_sync_activity`)**: dopo la lettura
del dettaglio, alla risposta vengono aggiunti `ack`, `techReason` e
`businessReason`, letti dalle colonne `ack`/`techreason`/`businessreason` della
riga con `jobcardid` = `jobCardId` richiesto (popolate da `synch-status` con
l'esito della sincronizzazione DMS), subito prima di `jobCardDetail`.
L'aggiunta riguarda solo la risposta dell'azione `details` (handler e CLI): la
cache DynamoDB, l'azione `dml` e l'operazione interna `getJobCardDetails` usata
da `synch-status` restano invariate. Best-effort: riga assente, valori `NULL`,
errore DB o attesa oltre 5 s → stringa vuota (l'errore viene solo loggato e non
fa fallire la risposta).

**Risposta di successo (200, estratto):**

```json
{
  "dmsAvailable": true,
  "statusCode": 200,
  "success": true,
  "message": "Job card retrieved successfully",
  "ack": "OK",
  "techReason": "",
  "businessReason": "",
  "jobCardDetail": {
    "roInfo": {
      "dmsRepairOrderId": "DMS-20260928-002",
      "jobCardSrpId": "JCID-84506",
      "status": "CREATED"
    },
    "customerInfo": [],
    "vehicleInfo": {},
    "jobs": []
  }
}
```

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

**Esito nella risposta**: dopo l'invio a DGT (e la sync NAGA), in coda alla
risposta vengono aggiunti `ack`, `techReason` e `businessReason`, letti dalla
stessa riga di `woc.jobcard_sync_activity` (`jobcardid` restituito dall'UPSERT).
Le colonne sono aggiornate da `synch-status` in modo asincrono, quindi i valori
riflettono l'ultimo esito registrato al momento della risposta: vuoti per una
jobcard nuova, l'esito della sincronizzazione precedente per una già presente.
Best-effort come in `details`: riga assente, valori `NULL`, errore DB o attesa
oltre 5 s → stringa vuota, senza far fallire la risposta (il payload è già stato
inviato a DGT).

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
  "statusCode": 200,
  "success": true,
  "message": "Job Card Transaction Successful",
  "jobCardId": "JCID-84521",
  "ack": "OK",
  "techReason": "",
  "businessReason": ""
}
```

---

### JobCard Last Payload

Restituisce (GET) l'ultimo payload `saveJobcard` inviato a DGT per una job card,
letto dalla colonna `payload` di `woc.jobcard_sync_activity` (`jobcardid` =
`jobCardId` richiesto). Serve a recuperare le modifiche inviate in delta quando
l'aggiornamento verso DJC/DGT fallisce: il payload viene registrato **prima**
dell'invio (v. "Tracciamento su DB" sopra), quindi è disponibile anche se la
POST `/jobCard` non è andata a buon fine. È il payload sanitizzato
effettivamente inviato (senza gli arricchimenti di sola UI, v.
`sanitizeJobCardPayload`), sovrascritto ad ogni `saveJobcard`: può essere
reinviato così com'è con `saveJobcard`.

```bash
node index.js lastPayload <jobCardId>
```

**Esempio:**
```bash
node index.js lastPayload JCID-84521
```

**Endpoint:** `GET /api/repairorder/lastPayload?jobCardId=JCID-84521` (accettato
anche `id`). Legge solo dal DB: nessuna chiamata DGT né token PingFederate.

**Risposta di successo (200):**

```json
{
  "statusCode": 200,
  "success": true,
  "message": "Job card payload retrieved successfully",
  "jobCardId": "JCID-84521",
  "payload": {
    "roInfo": {
      "jobCardSrpId": "JCID-84521",
      "dealerId": "DE87630",
      "updateDateTime": "2026-10-02T09:19:31Z"
    },
    "jobs": []
  }
}
```

**Errori** (body `{ "success": false, "message": "..." }`):

| Status | Caso |
|---|---|
| `400` | `jobCardId` mancante (`[jobCard] jobCardId is required`) |
| `404` | nessun payload registrato per la job card (`[jobCard] payload not found for jobCardId <id>`) |
| `502` | errore DB |

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

Dopo `sanitizeJobCardDetails` ma **prima** di essere persistita in cache (`saveJobCardDetailsToTmp`), la risposta viene ulteriormente arricchita da `getDataFromDML` (v. `getCartPriceAndAvailability`/`applyDataFromDml`), che chiama `callService('dms', 'inquiry', domainBody)` per prezzo/disponibilità/sconto aggiornati di ricambi e manodopera. `getJobCardDetails` accetta un terzo parametro opzionale `sessionContext` (username/mainSincom/market/language/dealerCountryCode), propagato a `getDataFromDML` per costruire il Sender dinamico dell'inquiry DMS tramite `dms / resolveSender` (v. `buildDmsSender`). La scrittura della cache omette i valori `undefined` durante la conversione DynamoDB, evitando che campi facoltativi non valorizzati impediscano di salvare e rileggere il dettaglio. Best-effort: eventuali problemi verso `dms` non fanno fallire la risposta di `getJobCardDetails`.

Ogni elemento di `partInfo[]`/`laborInfo[]` mantiene `dmsunknown` (solo per i ricambi: 1 se il partNumber non trova corrispondenza, 0 altrimenti). A livello di ciascun `job` viene inoltre aggiunto il flag `dmsOverride` (booleano): `true` se il prezzo cambia o viene applicato/modificato uno sconto DMS su almeno un `partInfo[]`/`laborInfo[]`; un semplice match senza variazioni di prezzo/sconto non basta. Se `dmsDiscountPercentage` del dettaglio coincide già con quello restituito dal DMS, lo sconto non viene riconciliato una seconda volta: prezzi invariati restano invariati e `dmsOverride` resta `false`, mentre un eventuale cambio di prezzo viene ricalcolato usando lo sconto già presente. Gli importi monetari ricalcolati sono arrotondati a due decimali (v. `applyDataFromDml`).

Quando `job.dmsOverride === true`, vengono inoltre ricalcolati (sommando i valori correnti di `partInfo[]`/`laborInfo[]`) i totali del job: `originalPriceExclVat`/`originalPriceWithVat`/`priceExclVatAfterDiscount`/`priceWithVatAfterDiscount`/`discountInAmountOnPriceWithVat`, `totalPartsAmountRequested`/`totalLaborAmountRequested` (somma di `originalPriceExclVat`, cioè l'importo prima dello sconto, rispettivamente di `partInfo[]`/`laborInfo[]`) e `totalLaborDurationRequested` (somma di `laborInfo[].laborDuration`) — v. `recalculateJobTotals`. Con sconto di workline (`job.discountInPercentage`) il prezzo scontato del job è la somma dei prezzi originali dei figli × (1 − sconto workline). I job a prezzo fisso **FP/LFP** (`packageType`, o `jobType` `MFP`/`LFP`) non vengono ricalcolati: il prezzo sta solo a livello di workline (regola confermata dall'analista). Se **almeno un** job del jobCardDetail ha `dmsOverride === true`, viene ricalcolato anche `roInfo.totalPrice` (v. `recalculateRoInfoTotals`), con le regole concordate con l'analista (le stesse del FE):
- nei totali complessivi contano **solo i job CUSTOMER** (`job.paymentType`, o `job.packageCharge` quando `paymentType` non è valorizzato): `originalPriceExclVat`/`originalPriceWithVat` = somma dei prezzi originali dei job CUSTOMER (fallback sul prezzo scontato se l'originale manca);
- lo sconto generale `roInfo.discounts.discountInPercentage` **non è mai dentro i singoli job** e si applica solo alla fine: `priceExclVatAfterDiscount`/`priceWithVatAfterDiscount` = somma netta dei job CUSTOMER × (1 − sconto generale); `totalCustomerWithVat` = `priceWithVatAfterDiscount`;
- `totalInsuranceWithVat`/`totalManufacturerWithVat`/`totalInternalWithVat` = somma di `job.priceWithVatAfterDiscount` dei rispettivi job, **senza** sconto generale (solo informativi);
- se `roInfo.discounts` è presente (non viene creato), `discountInAmountOnPriceWithVat` = (originale CUSTOMER − netto CUSTOMER) + netto CUSTOMER × sconto generale; `discountInPercentage` resta invariato.

Se nessun part/labor di nessun job trova match nel DML, né i job né `roInfo.totalPrice` vengono toccati (restano i totali originali, tipicamente da DGT); `recalculateRoInfoTotals` è comunque un no-op se `jobCardDetail.roInfo` è assente.

Normalizzazione sconti dei figli (`checkDiscount`, in `sanitizeJobCardDetails`): su `partInfo[]`/`laborInfo[]` i campi `appDiscountPercentage`/`dmsDiscountPercentage` mancanti vengono aggiunti a `0`. `dmsDiscountPercentage` non viene **mai** modificato: se il job ha uno sconto di workline (`discountInPercentage` valorizzato) i figli vanno a prezzo pieno con `appDiscountPercentage = -dmsDiscountPercentage`.

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
# woc.jobcard_sync_activity (saveJobcard, details e lastPayload)
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
| `JOBCARD_DB_HOST` | Endpoint RDS Proxy Aurora "wiadvisor" (`woc.jobcard_sync_activity`, solo `saveJobcard`, `details` e `lastPayload`) |
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
