# project-am-stellantis-woc-backend

> 🇮🇹 Italiano &nbsp;|&nbsp; 🇬🇧 [Read in English](README.en.md)

Stellantis – WOC BackEnd: raccolta di Lambda Node.js per l'integrazione con i servizi Stellantis (AgendaSOA, NAGA, DMS, JobCard, DJC, V360, pkEper, pkDocsoa, pkMenupricing, pkManager, translations, session, myPeople, pkFavorite, moparDoc, isStellantisBrand, synch-status, dmlConfigSync).

![Unit Tests](https://github.com/stla-wrt00/project-am-stellantis-woc-backend/actions/workflows/unit-tests.yml/badge.svg)

---

## Indice

1. [Struttura del progetto](#struttura-del-progetto)
2. [Moduli](#moduli)
   - [agendaSoa](#agendasoa)
   - [agendaSoaNaga](#agendasoaNaga)
   - [dms](#dms)
   - [jobcard](#jobcard)
   - [djc](#djc)
   - [v360](#v360)
   - [pkEper](#pkeper)
   - [pkDocsoa](#pkdocsoa)
   - [pkMenupricing](#pkmenupricing)
   - [pkManager](#pkmanager)
   - [translations](#translations)
   - [session](#session)
   - [myPeople](#mypeople)
   - [pkFavorite](#pkfavorite)
   - [moparDoc](#mopardoc)
   - [isStellantisBrand](#isstellantisbrand)   
   - [synch-status](#synch-status)
   - [dmlConfigSync](#dmlconfigsync)
   - [auroraAutoStart](#auroraautostart)
3. [Installazione](#installazione)
4. [Variabili d'ambiente](#variabili-dambiente)
5. [Unit Test & Coverage](#unit-test--coverage)
6. [Security Scan](#security-scan)
7. [Report di copertura](#report-di-copertura)

---

## Struttura del progetto

```
project-am-stellantis-woc-backend/
├── agendaSoa/          # Lambda – pianificazione appuntamenti (AgendaSOA REST)
├── agendaSoaNaga/      # Lambda – creazione/aggiornamento appuntamenti NAGA
├── dms/                # Lambda – DMS Settings (Stellantis DML API)
├── jobcard/            # Lambda – JobCard list/details/save (Stellantis DGT API)
├── djc/                # Lambda – Digital Job Card: costruzione payload Save* e saveJobcard (POST)
├── v360/               # Lambda – OTA Compatibility & Vehicle Details (ASV360 API)
├── pkEper/             # Lambda – Pacchetti ePer (Stellantis FCA/Fiat SOAP)
├── pkDocsoa/           # Lambda – Pacchetti DocSOA (Stellantis PSA REST)
├── pkMenupricing/      # Lambda – Pacchetti MenuPricing (Opel/Vauxhall SOAP)
├── pkManager/          # Lambda – Orchestratore multi-WS pacchetti (ePer/DocSOA/MenuPricing)
├── translations/       # Lambda – Recupero traduzioni da S3
├── session/            # Lambda – Dati di sessione (codmarket, oic, sincom, ...)
├── myPeople/           # Lambda – Profili utente PSA IURSMA (mTLS + Basic Auth)
├── pkFavorite/         # Lambda – Pacchetti preferiti dealer (PostgreSQL/Aurora + RDS Proxy)
├── moparDoc/           # Lambda – MoparDoc: CreateJobCard (job-docs) + getUploadDocURL/uploadedDoc (MoparDocs Browser API)
├── isStellantisBrand/  # Lambda – Verifica appartenenza brand a Stellantis (Aurora PostgreSQL via RDS Proxy)
├── synch-status/       # Lambda – Aggiornamento stato sincronizzazione DJC (4 eventi Kafka) su Aurora PostgreSQL via RDS Proxy; security demandata al gateway IBM APIC
├── dmlConfigSync/      # Lambda – Sync giornaliera (EventBridge Schedule) company-types/customer-titles + dms/settings DML per mercato/dealer -> cache Aurora, letta da session
└── auroraAutoStart/    # Lambda – Avvio automatico mattutino (EventBridge Schedule, solo stage) del cluster Aurora se spento dal tool Stellantis di startstop

```

---

## Moduli

### agendaSoa

Lambda di routing centrale per la gestione degli appuntamenti tramite il servizio **AgendaSOA REST**.

#### Handlers disponibili

| `event.action` | Metodo client | Descrizione |
|---|---|---|
| `appointment` | `client.appointment(params)` | Recupera i dati di planning del recezionista |
| `availableHours` | `client.availableHours(params)` | Restituisce le fasce orarie disponibili per un PDV |
| `cCSList` | `client.cCSList(params)` | Lista dei CCS (Consiglieri Cliente Servizio) di un PDV |
| `data` | `client.data(params)` | Dettaglio di un appuntamento RDV per ID |

#### Struttura

```
agendaSoa/
├── index.js                    # Lambda entry-point (dispatcher)
├── src/
│   ├── agendaSOAClient.js      # Client REST AgendaSOA (axios)
│   ├── clientFactory.js        # Factory: crea il client da env vars
│   └── handlers/
│       ├── appointment.js
│       ├── availableHours.js
│       ├── cCSList.js
│       └── data.js
└── __tests__/                  # Unit test Jest
```

#### Event shape

```json
{
  "action": "appointment | availableHours | cCSList | data",
  "queryStringParameters": { "id": "...", "ccs": "...", "date": "..." },
  "body": "{...}",
  "params": { "..." }
}
```

---

### agendaSoaNaga

Lambda di routing per la **creazione e l'aggiornamento di appuntamenti NAGA**.

#### Handlers disponibili

| `event.action` | Metodo client | Descrizione |
|---|---|---|
| `createnaga` | `client.createnaga(body)` | Crea un nuovo appuntamento NAGA |
| `updatenaga` | `client.updatenaga(body, apptId)` | Aggiorna un appuntamento esistente |

#### Struttura

```
agendaSoaNaga/
├── index.js                    # Lambda entry-point (dispatcher)
├── src/
│   ├── agendaNagaClient.js     # Client REST NAGA (axios)
│   ├── clientFactory.js        # Factory: crea il client da env vars
│   └── handlers/
│       ├── createnaga.js
│       └── updatenaga.js
└── __tests__/                  # Unit test Jest
```

#### Event shape – updatenaga

```json
{
  "action": "updatenaga",
  "pathParameters": { "apptId": "12345" },
  "body": "{...payload...}"
}
```

---

### dms

Lambda per le **impostazioni DMS** e le **richieste di inquiry** (parti/upgrade/linee di lavoro) tramite l'API Stellantis DML, con autenticazione PingFederate (bearer token).

#### Actions disponibili

| `event.action` | Funzione service | Descrizione |
|---|---|---|
| `settings` | `getDmsSettings(token, params)` | Recupera la configurazione DMS del dealer |
| `company-types` | `getCompanyTypes(token, params)` | Recupera l'elenco configurazione DML dei tipi società |
| `customer-titles` | `getCustomerTitles(token, params)` | Recupera l'elenco configurazione DML dei titoli cliente |
| `inquiry` | `postDmsInquiry(token, body)` | Invia una richiesta DML inquiry (LFP / WL / MP) |

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) |
| `dmsService` | `getDmsSettings(token, params)` | GET `/dms/settings?country=&brand=&dealer=` |
| `dmsService` | `getCompanyTypes(token, params)` | GET `/configurations/company-types?country=&language=` |
| `dmsService` | `getCustomerTitles(token, params)` | GET `/configurations/customer-titles?country=&language=` |
| `dmsService` | `postDmsInquiry(token, body)` | POST `/inquiry/DML/1.0/inquiry` – tipi: `LFP` \| `WL` \| `MP` |
| `dmsService` | `buildTypeSection(type)` | Helper: genera la sezione payload specifica per tipo (LFP/WL/MP) |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Parametri `getCompanyTypes` / `getCustomerTitles`

Stesse credenziali/autenticazione di `settings` (bearer token PingFederate, `X-IBM-Client-Id`/`X-IBM-Client-Secret`, `X-Target-Env`) — cambiano solo path e query string.

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `country` | ✅ | Codice paese (es. `FR`) |
| `language` | ✅ | Codice lingua (es. `fr`) |

> **Nota:** come `getDmsSettings`, un `404` ("nessun dato per questi parametri", es. `{"success":false,"message":"No company types found for the given parameters"}`) **non** viene propagato come errore: la funzione restituisce `{ success: false, data: [] }`, cosi' i consumer (es. `session`/`MyPeopleDmsSessionRepository`) ricevono sempre un array (anche vuoto) invece di un'eccezione.

#### Parametri `postDmsInquiry`

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `PartsInquiryHeader.MessageType` | ✅ | Tipo richiesta: `LFP` \| `WL` \| `MP` |
| `PartsInquiryHeader.DocumentID` | ❌ | Numero Repair Order univoco. Contenuto non obbligatorio (può essere sconosciuto/omesso, es. per `LFP` quando l'ordine di riparazione non esiste ancora), ma il DML richiede comunque la chiave presente: se assente/`null`/`undefined`, viene inviata come stringa vuota `''` |
| `PartsInquiryHeader.CustomerIdDms` | ❌ | ID cliente nel DMS. Come `DocumentID`, contenuto non obbligatorio: se assente/`null`/`undefined`, viene inviata come `null` (chiave sempre presente) |
| `PartsInquiryHeader.VehicleID` | ✅ | VIN del veicolo |
| `ApplicationArea` | ✅ | Mittente, timestamp e BODID (UUID). Se omesso, viene costruito internamente da `buildApplicationArea()` usando `config.sender` (default statici da env) sovrascritto per-request da `sender` (vedi sotto), se fornito |
| `sender` | ❌ | Scorciatoia: sottoinsieme dei campi di `config.sender` (`dealerNumberId`, `dealerNumberIdSource`, `dealerCountryCode`, `languageCode`, `physicalSiteId`, `serviceId`, `currencyId`, `brand`, `componentId`, più `market` — vedi nota sotto) da sovrascrivere per questa richiesta, cosi' `ApplicationArea.Sender` riflette il dealer/brand/mercato reale del chiamante (`jobcard`/`pkManager`/`pkFavorite` — vedi rispettive sezioni), risolto **automaticamente e mai fornito dal frontend** (v. nota "Risoluzione automatica" sotto), invece dei soli default statici via env. Ignorato quando `ApplicationArea` è già fornito. Non inviato as-is al DML |
| `UpSelling.Packages` | ❌ | Usato per `LFP` |
| `WorkLines` | ❌ | Usato per `WL` |
| `SpareParts.PartsItem` | ❌ | Usato per `MP` |

> **Sender dinamico centralizzato (`buildApplicationArea`)**: la risoluzione di
> `physicalSiteId`/`dealerNumberIdSource` tramite lookup su `woc.ang_snowflakes`
> (`dbManager/AnagSnowflakesRepository.js::getPhysicalSiteAndSincom`) è
> **interamente centralizzata qui**, in `dms/dmsService.js::buildApplicationArea`,
> cosi' tutti i chiamanti (`jobcard`, `pkManager`, `pkFavorite`) condividono lo
> stesso identico meccanismo/stessi criteri, invece di duplicare la query
> ciascuno per conto proprio. Quando il `sender` passato a `postDmsInquiry`
> contiene **tutti e tre** `dealerNumberId` (il `mainSincom`), `market` e
> `brand`, `buildApplicationArea` esegue il lookup (chiave
> `mainSincom`+`market`+`brand`) e — se trova una riga — sovrascrive
> `physicalSiteId`/`dealerNumberIdSource`; **`market` non è mai inoltrato al
> DML**: serve solo come chiave di ricerca lato lookup, non è un campo di
> `ApplicationArea.Sender`. Il match su `mainSincom` è fatto **in OR** tra le
> colonne `cd_main_sincom_code` e `gn_legal_entity` (stesso dato logico,
> valorizzato in colonne diverse a seconda della sorgente/estrazione). Il
> `brand` è sempre cercato con un **unico criterio uniforme**, il codice
> ARCAD/RefTech a 2 lettere (`cd_contract_brand_arcad_code`): se il chiamante
> passa un codice in altro formato (tipicamente numerico WebDAC, es. `55`,
> `00`, `83`) viene prima trasformato nel corrispondente codice ARCAD
> interrogando la stessa tabella (`AnagSnowflakesRepository.js::resolveArcadBrandCode`).
> Il lookup è **best-effort**: se manca anche uno solo
> dei tre campi, o la query fallisce, si prosegue senza modificare
> `physicalSiteId`/`dealerNumberIdSource` (solo un warning in log) — non blocca
> mai la chiamata al gateway DML. Per questo, ogni funzione Lambda che include
> `dms/` in-process (`JobCardFunction`, `PkManagerFunction`, `PkFavoriteFunction`)
> e la stessa `DmsFunction` richiedono anche il codice sorgente di `dbManager/`
> (build via `Metadata: BuildMethod: makefile`, v. `Makefile`) e le variabili
> `DBMANAGER_DB_*` (stesso Aurora `wiadvisor` di `PkManagerFunction`/`SessionFunction`).
>
> **`DealerNumberIDSource` per "brand owner" (`config/brandowner.json`)**: il
> valore di `dealerNumberIdSource` risolto sopra da `woc.ang_snowflakes`
> (`CD_SINCOM_CODE`) è quello corretto per i brand il cui **owner** è `XF`
> (comportamento di default, invariato). Per i brand con owner `XP` viene
> invece usato `CD_DEALER_ARCAD_CODE` (colonna già letta dalla stessa riga di
> `woc.ang_snowflakes`, esposta da `getPhysicalSiteAndSincom` come
> `dealerArcadCode`). L'owner è determinato cercando il codice ARCAD a 2
> lettere del brand (`arcadBrand`, lo stesso già risolto internamente da
> `getPhysicalSiteAndSincom`/`resolveArcadBrandCode` per la query sopra, cosi'
> il match funziona indipendentemente dal formato — ARCAD o WebDAC — del
> `brand` ricevuto) nel registro statico `config/brandowner.json` su S3
> (bucket `TranslationsBucket`, stesso file/formato già usato da
> `v360/v360Service.js::enrichWithBrandOwnerAndEnergyType`), letto tramite un
> proprio `v360/s3ConfigRepository.js::S3ConfigRepository` (cache in memoria
> locale a `dms/dmsService.js`, indipendente da quella di `v360` — la logica
> resta di `dms`/`jobcard`/`pkManager`, `v360` fornisce solo l'utility di
> lettura/parsing del file S3). Anche questo lookup è **best-effort**: se
> manca `dealerArcadCode`, il brand non è presente nel registro, o S3 non è
> raggiungibile, `dealerNumberIdSource` resta quello già risolto
> (`CD_SINCOM_CODE`) — solo un warning in log, mai un'eccezione che blocchi la
> chiamata al gateway DML.
>
> **`Sender.DealerNumberID`/`Sender.DealerNumberIDSource` invertiti**: nel
> mapping finale del Sender, `Sender.DealerNumberID` riceve il valore risolto
> sopra (`dealerNumberIdSource` interno: `CD_SINCOM_CODE` o, per owner `XP`,
> `CD_DEALER_ARCAD_CODE`), mentre `Sender.DealerNumberIDSource` riceve il
> `mainSincom` passato dal chiamante (`dealerNumberId` interno, o il default
> statico di `config.sender` se non sovrascritto) — **invertiti rispetto ai
> nomi interni** usati per la risoluzione DB/XF-XP sopra.
>
> **`pairedOicCode` (filtro opzionale del lookup su `cd_paired_oic_code`)**:
> quando il `sender` passato a `postDmsInquiry` include anche `pairedOicCode`,
> la query di `getPhysicalSiteAndSincom` aggiunge la condizione
> `AND cd_paired_oic_code = pairedOicCode`, per disambiguare tra più righe
> altrimenti corrispondenti a `mainSincom`+`market`+`brand` ma relative a siti
> fisici/OIC diversi. È un campo **solo di lookup** (come `market`): non è mai
> inoltrato al DML. Ad oggi solo `jobcard/jobCardService.js::buildDmsSender` lo
> valorizza, a partire da `jobCardDetail.roInfo.pairedOicCode` di una
> jobCardDetails già disponibile (recuperata via DGT o dalla cache DynamoDB
> `TmpCacheTable`, v. sezione `jobcard`); `pkManager`/`pkFavorite` non lo
> conoscono e continuano a funzionare esattamente come prima (nessun filtro
> aggiuntivo sulla query) — retrocompatibile.
>
> **Risoluzione automatica del `dealerNumberId`/`market`/`brand`/lingua/country
> (`resolveDynamicSenderFields`)**: `mainSincom`, `market`, `language`,
> `dealerCountryCode` e `brand` **non devono mai essere passati dal frontend**
> (nessuno dei chiamanti li accetta più come dati "di fiducia" da FE): sono
> ricavati automaticamente, con gli stessi criteri per `jobcard`/`pkManager`/
> `pkFavorite`, da `dms/dmsService.js::resolveDynamicSenderFields({ username, vin },
> overrides)`, chiamata da ciascun `buildDmsSender`/`_buildDmsSender` PRIMA di
> `postDmsInquiry`:
> - `mainSincom`/`market`/`language`/`dealerCountryCode` ← `username`
>   (`event.requestContext.authorizer.sub`), tramite
>   `session/src/sessionContextCache.js::getCachedSessionContext` — stessa
>   risoluzione myPeople della lambda `session`, con cache best-effort su
>   DynamoDB (`TmpCacheTable`, chiave `session:context:<username>`, TTL
>   configurabile via `SESSION_CONTEXT_CACHE_TTL_MS`, default 5 min);
> - `brand` ← `vin` della richiesta corrente, tramite
>   `v360/v360Service.js::getCachedBrand` (campo `data.brandCode` della
>   risposta v360 `getdetails`, cache best-effort su DynamoDB (`TmpCacheTable`,
>   chiave `v360:getdetails:<vin>`, TTL 1h via `SESSION_CACHE_TTL_SECONDS`)) —
>   il brand **del veicolo**, non quello
>   di default del dealer/sessione (un dealer multi-brand può servire un
>   veicolo di un brand diverso dal proprio).
>
> Eventuali valori già noti al chiamante (`overrides`, es. `this.wsConfig` di
> `pkManager`) hanno sempre priorità sui valori auto-risolti: la funzione
> valorizza solo i campi assenti. È interamente **best-effort** (try/catch +
> `console.warn`, mai un'eccezione che blocchi la costruzione del Sender): se
> `username`/`vin` mancano, o session/myPeople/v360 non sono raggiungibili, i
> soli campi non risolvibili restano assenti e si ricade sui default statici
> di `config.sender`. Per questo, oltre a `dbManager/`, ogni Lambda che include
> `dms/` in-process (`JobCardFunction`, `PkManagerFunction`,
> `PkFavoriteFunction`) deve impacchettare **anche** `session/` (+ `myPeople/`
> e `dmlConfigSync/`, di cui `session` dipende) e `v360/` come cartelle
> sorelle (v. `Makefile`), e dichiarare le stesse variabili `MYPEOPLE_*`/
> `DMLCONFIGSYNC_DB_*`/`V360_PING_*`/`ASV_*`/`CONFIG_BUCKET_NAME` già usate da
> `SessionFunction`/`V360Function` in `template.yaml`. La lambda `dms` stessa
> **non richiama mai** `resolveDynamicSenderFields` dal proprio handler:
> resta "leggera" (non bundla `session`/`myPeople`/`dmlConfigSync`/`v360`),
> pur ospitando la funzione — è pensata per i chiamanti di `postDmsInquiry`.

#### Utilizzo CLI

```bash
# Impostazioni DMS
node index.js settings <country> <brand> <dealer>
# es: node index.js settings fr FT 0062230

# Tipi società
node index.js company-types <country> <language>
# es: node index.js company-types FR fr

# Titoli cliente
node index.js customer-titles <country> <language>
# es: node index.js customer-titles fr fr

# Inquiry — argomenti posizionali
node index.js inquiry <type> <documentId> <customerId> <vehicleId>
# es: node index.js inquiry LFP 84564621 854265 3C4NJCBH7KT831816

# Inquiry — da file JSON completo
node index.js inquiry --file ./LFP_1_Request.json
```

---

### jobcard

Lambda per la gestione delle **JobCard** tramite l'API Stellantis DGT (Digital Layer), con autenticazione PingFederate.

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) |
| `jobCardService` | `getJobCardList(token, params)` | Lista JobCard con filtri e paginazione |
| `jobCardService` | `getJobCardDetails(token, jobCardId, sessionContext)` | Dettaglio di una singola JobCard, arricchito con i dati DML (v. sotto) |
| `jobCardService` | `saveJobCard(token, payload)` | POST `/jobCard` – creazione/aggiornamento Job Card (azione `saveJobcard`, condivisa con la lambda `djc`) |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Parametri `getJobCardList`

| Parametro | Obbligatorio | Descrizione |
|---|---|---|
| `dealerId` | ✅ | ID del concessionario |
| `vin` | ❌ | Numero VIN |
| `creationStartDate` / `creationEndDate` | ❌ | Intervallo data creazione (ISO 8601) |
| `deliveryStartDate` / `deliveryEndDate` | ❌ | Intervallo data consegna (ISO 8601) |
| `receptionStartDate` / `receptionEndDate` | ❌ | Intervallo data ricezione (ISO 8601) |
| `licensePlate` | ❌ | Targa |
| `dmsRepairOrderId` | ❌ | ID ordine riparazione DMS |
| `customerName` | ❌ | Nome cliente |
| `page` | ❌ | Numero pagina (default: 1) |
| `pageSize` | ❌ | Elementi per pagina – 10/25/50/100 (default: 25) |
| `sortBy` | ❌ | Campo di ordinamento |
| `sortOrder` | ❌ | `asc` / `desc` |

#### Arricchimento risposta `getJobCardDetails`

Prima di essere restituita, la risposta viene arricchita da `sanitizeJobCardDetails` con campi calcolati non presenti nella risposta originale della DGT API:

- **`jobs[].packageType` / `jobs[].packageCharge`** — aggiunti a ciascun job (posizionati prima di `partInfo`/`laborInfo` quando presenti), derivati da `jobType`/`packageCode`: `jobType="MFP"` → `FP`/`CUSTOMER`; `jobType="STD"` con `packageCode` valorizzato → `QE`/`CUSTOMER`; `jobType="LFP"` → `LFP`/`CUSTOMER`; `jobType="STD"` senza `packageCode` (o assente/vuoto/`null` di `jobType`) → `GC`/`CUSTOMER`; qualsiasi altro `jobType` non vuoto → `GC`/`INTERNAL`. Se il job ha `paymentType` valorizzato, questo sovrascrive sempre `packageCharge` (il `packageType` resta invariato).
- **`roInfo.roSource`** — aggiunto subito dopo `roInfo.sourceApplication`, con lo stesso valore.

Inoltre, prima di essere persistita in cache (`saveJobCardDetailsToTmp`), la risposta viene arricchita anche con i dati del gateway DML (`getDataFromDML`/`getCartPriceAndAvailability`, v. sotto): `jobs[].partInfo[]`/`jobs[].laborInfo[]` ricevono così già prezzo/disponibilità/sconto aggiornati, con lo stesso `sessionContext` (opzionale) passato a `getJobCardDetails` — best-effort, non blocca la risposta in caso di problemi verso `dms`.

Vedi `jobcard/README.md` per la tabella completa delle regole.

#### `saveJobcard` (POST `/jobCard`)

Azione che invia (POST) un payload di **Digital Job Card** alla Push API SRP per
creare/aggiornare una Job Card — condivisa (stesso client PingFederate/DGT) con
la lambda **[djc](#djc)**, che ne è la declinazione dedicata alla costruzione dei
payload (`Save*`). **API Gateway instrada le richieste POST verso la lambda
`djc`**; questa azione resta disponibile qui per chiamata diretta/CLI e per
coerenza tra le due lambda. Regole di obbligatorietà (M/M(O)/M(C)), payload di
esempio e riferimento al documento *"SRP - DL DJC Post API Specification"* in
`jobcard/README.md` e `djc/README.md`.

Dopo una `saveJobCard` riuscita, se il payload contiene `appointments[]` con
almeno un elemento con `appointmentInternalId` valorizzato,
`index.js::syncAppointmentsToNaga` richiama in-process (stesso pattern di
`pkManager/PkManager.js`) l'azione `updatenaga` della lambda **[agendaSoaNaga](#agendasoanaga)**
per sincronizzare l'appuntamento NAGA. Il payload `updatenaga` viene costruito
da `appointments[].reception`/`delivery` (orari/date/anagrafiche del consulente),
da `/tmp/session.json`/`/tmp/VIN.json` (dati di sessione/VIN salvati dal
chiamante, letti in modo best-effort) e da `jobs[].jobDescription` — sia quelli
del payload `saveJobcard` sia, quando `roInfo.jobCardSrpId` è valorizzato,
quelli letti da `/tmp/<jobCardSrpId>.json` (stessa cache di
`getDataFromDMLFromTmp`) — per popolare `intervention[].nom`. Best-effort:
eventuali errori verso agendaSoaNaga vengono loggati ma non fanno fallire la
risposta di `saveJobcard` (già persistita con successo sulla DGT).

#### `getCartPriceAndAvailability` (azione `dml`) — Sender dinamico

`getCartPriceAndAvailability` (invocata dall'azione `dml` di `index.js`, tramite
`getDataFromDMLFromTmp`/`getDataFromDML`) interroga il gateway DML
(`dms/dmsService.js::postDmsInquiry`, `MessageType=WL`) per prezzo/disponibilita
di ricambi e manodopera, sullo stesso modello di
`pkManager/PkManager.js::getPriceAndAvailability` e `pkFavorite/index.js` (v.
[dms](#dms) → `postDmsInquiry`). L'azione `dml` viene chiamata **sempre dopo**
che il chiamante e' gia' entrato nel dettaglio della repair order, quindi ha
gia' a disposizione sia i dati di sessione sia il `jobCardDetail` appena
recuperato. **Nota**: la stessa `getCartPriceAndAvailability` viene ormai
invocata anche direttamente da `getJobCardDetails` (azione `details`), che
arricchisce già la risposta con i dati DML prima di persisterla in cache
(v. sopra); l'azione `dml` resta quindi utile per rileggere/aggiornare
l'arricchimento su un `jobCardDetail` già in cache senza rifare la GET a DGT
(es. dopo modifiche al carrello), evitando in tal caso una doppia chiamata
al gateway DML in caso di rigenerazione della cache (v.
`getDataFromDMLFromTmp`). Il **frontend non passa (e non deve passare) mainSincom/market/
brand/lingua/country**: `jobCardService.js::buildDmsSender(jobCardDetail,
sessionContext)` estrae il solo VIN da
`jobCardDetail.vehicleInfo.identification.vin` e delega la risoluzione
dinamica di tutto il resto a
`dms/dmsService.js::resolveDynamicSenderFields({ username, vin }, sessionContext)`
— STESSO meccanismo centralizzato usato anche da `pkManager`/`pkFavorite` (v.
nota "Risoluzione automatica" nella sezione [dms](#dms)):

- `dealerNumberId` ← `resolved.mainSincom` (da `sessionContext.mainSincom` se già noto, altrimenti risolto da `username` via `session/src/sessionContextCache.js`)
- `serviceId` ← `username` (risolto da `event.requestContext.authorizer.sub`, fallback `body.username` solo se manca `requestContext.authorizer` — uso locale/CLI)
- `languageCode` / `dealerCountryCode` ← `resolved.language`/`resolved.dealerCountryCode` (idem, da sessione se non già noti)
- `brand` ← `resolved.brand` (da `sessionContext.brand` se già noto, altrimenti risolto dal VIN tramite `v360/v360Service.js::getCachedBrand` — il brand del veicolo, non del dealer)
- `market` ← `resolved.market` (solo chiave di lookup lato `dms`, mai un campo `Sender` vero e proprio)
- `physicalSiteId`/`dealerNumberIdSource`/`componentId`/`currencyId` restano i default statici via env (`dms/config.js`), a meno che `dms` non li risolva dinamicamente (v. `buildApplicationArea` sopra)

La risoluzione è interamente **best-effort**: se `sessionContext`/`vin` mancano
o session/myPeople/v360 non sono raggiungibili, i soli campi non risolvibili
restano assenti dal `sender` — mai un'eccezione che blocchi
`getCartPriceAndAvailability`. `JobCardFunction` richiede quindi, oltre a
`../dms/authService`/`../dms/dmsService`/`../dbManager` (già presenti per il
lookup `physicalSiteId`/`dealerNumberIdSource` di `buildApplicationArea`),
anche il codice sorgente di `../session` (+ `../myPeople` e
`../dmlConfigSync`, di cui `session` dipende) e `../v360` (build via
`Metadata: BuildMethod: makefile`, v. `Makefile`), con le stesse variabili
`MYPEOPLE_*`/`DMLCONFIGSYNC_DB_*`/`V360_PING_*`/`ASV_*`/`CONFIG_BUCKET_NAME`
già usate da `SessionFunction`/`V360Function` in `template.yaml` — non perché
`jobCardService.js` acceda direttamente a queste cartelle, ma perché
`dms/dmsService.js::resolveDynamicSenderFields`/`buildApplicationArea`, incluse
**in-process** (v. Makefile), ne hanno bisogno per la risoluzione centralizzata.

#### Utilizzo CLI

```bash
node index.js list    <dealerId> [key=value ...]
node index.js details <jobCardId>
node index.js saveJobcard <payloadJsonFile>
# es: node index.js list 0062219 vin=VIN123 page=2
# es: node index.js details 79
# es: node index.js saveJobcard ./payload.json
```

---

### djc

Lambda **Digital Job Card**: declinazione della lambda `jobcard` dedicata alla
costruzione dei payload da inviare alla **Push API SRP** (Digital Layer) e al
loro invio effettivo. Legge il contenuto di riferimento (`jobCardDetail`) dalla
cache condivisa DynamoDB (`TmpCacheTable`, chiave
`jobcard:jobcarddetails:<jobCardId>`, scritta dalla lambda `jobcard` durante
una `getJobCardDetails`, per evitare una nuova chiamata a DGT — v.
`DjcManager.create()`) oppure, se `jobCardId` non è disponibile (uso
locale/CLI) o l'item in cache è assente/scaduto, da un'istantanea statica di
riferimento (`get.json`).

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `DjcManager` | `Save*(...)` | Costruisce `json_orig`/`json_mod` per una sezione della Job Card (`SaveRoInfo`, `SaveDmsSync`, `SaveCustomer`, `SaveVehicle`, `SaveJobs`, `SaveConsents`, `SaveAppointments`) |
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) — copia sincronizzata di `jobcard/authService.js` |
| `jobCardService` | `saveJobCard(token, payload)` | POST `/jobCard` – creazione/aggiornamento Job Card (azione `saveJobcard`) — copia sincronizzata di `jobcard/jobCardService.js` |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js — copia di `jobcard/httpClient.js` |

> `config.js`/`authService.js`/`httpClient.js` sono mantenuti **in sync** con gli
> omonimi file di `jobcard`: usano lo stesso client PingFederate/DGT (stesse
> credenziali/URL delle `GET /jobCardList` e `/jobCardDetails` di `jobcard`).

#### `saveJobcard` (POST `/jobCard`)

Azione che invia effettivamente alla Push API SRP il payload di Digital Job
Card (tipicamente il `json_mod` prodotto da uno dei metodi `Save*`). È
**replicata identica** nella lambda `jobcard` (stesso `jobCardService.js::
saveJobCard`), ma **API Gateway instrada le richieste POST verso la lambda
`djc`**, non verso `jobcard`.

Regole di obbligatorietà (M/M(O)/M(C)), regole di creazione/aggiornamento,
tabella degli identificativi per array, semantica `removalAction`/update
parziale, payload minimo/completo e risposte di esempio — riferimento al
documento **"SRP - DL DJC Post API Specification"** — sono documentate in
dettaglio in `djc/README.md` e nello schema `JobCardSaveRequest` di
`swagger-woc.yaml` (`POST /api/repairorder/{method}`, `method=save`).

Dopo una `saveJobCard` riuscita, se il payload contiene `appointments[]` con
almeno un elemento con `appointmentInternalId` valorizzato, viene sincronizzato
anche l'appuntamento NAGA (azione `updatenaga` di **[agendaSoaNaga](#agendasoanaga)**,
richiamata in-process) — v. dettagli nella sezione [jobcard](#jobcard) sopra
(`index.js::syncAppointmentsToNaga`, replicata identica qui).

#### Utilizzo CLI

```bash
node index.js SaveRoInfo <interiorCarWash> <exteriorCarWash> <old> <original> <returned> <circularEconomy> <obfcm> <waitOnSite> <vehicleIdentificationTagNumber> <loanerFlag>
node index.js SaveDmsSync <dmsSynchroStatus>
node index.js SaveCustomer <phone> <mobile> <email> <address> <additionalAddress>
node index.js SaveVehicle <licensePlate> <odometerOut> <mileageUnits> <fuelReserveLevel> <batteryReserveLevel>
node index.js SaveJobs
node index.js SaveConsents <channelCode1> <channelCode2> <channelCode3> <channelCode4> <channelCode5> <channelCode6>
node index.js SaveAppointments <estimatedReceptionDateTime> <receptionDateTime> <receptionServiceAdvisorId> <receptionServiceAdvisorName> <estimatedDeliveryDateTime> <deliveryDateTime> <deliveryServiceAdvisorId> <deliveryServiceAdvisorName>
node index.js saveJobcard <payloadJsonFile>
```

Vedi `djc/README.md` per la descrizione completa di ogni metodo, i parametri e
l'uso come Lambda (`exports.handler`, dispatch per `action`).

---

### moparDoc

Lambda che espone 3 azioni verso i due gateway MoparDoc/job-docs usati per la
gestione della documentazione allegata alle job card:

- **`createJobCard`** — `POST /job-docs/connector/v1/CreateJobCard` (connector job-docs, PSA)
- **`getUploadDocURL`** — `POST /Mopardocs/MoparDocsApi/Browser/getUploadDocURL` (MoparDocs Browser API, FCA/Fiat)
- **`uploadedDoc`** — `POST /Mopardocs/MoparDocsApi/Browser/UploadedDoc` (MoparDocs Browser API, FCA/Fiat)

Tutte e tre condividono lo stesso token PingFederate (stesso host/scope `prd:dgt`
di `jobcard`/`djc`, ma con un **client dedicato**: client_id/secret propri, non
condivisi) e le stesse credenziali **IBM API Connect** (`X-IBM-Client-Id`/
`X-IBM-Client-Secret`).

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `moparDocService` | `createJobCard(payload)` | POST `/CreateJobCard` sul connector job-docs |
| `moparDocService` | `getUploadDocURL(payload)` | POST `/getUploadDocURL` sul MoparDocs Browser API |
| `moparDocService` | `uploadedDoc(payload)` | POST `/UploadedDoc` sul MoparDocs Browser API |
| `authService` | `getBearerToken()` | Ottiene/rinnova il token PingFederate (cache su file, client dedicato MoparDoc) |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js (redazione dati sensibili nei log) |

URL/basePath (PingFederate + job-docs + MoparDocs Browser API) sono **hardcoded**
in `config.js` (stessa convenzione di `jobcard`/`djc`/`v360`); solo le
credenziali (`MOPARDOC_PING_CLIENT_ID/SECRET`, `MOPARDOC_IBM_CLIENT_ID/SECRET`)
sono configurabili via ambiente.

#### API contract (Lambda handler)

L'azione è risolta da `event.action` (invocazione diretta) o dall'ultimo
segmento del path (integrazione API Gateway, es. `.../moparDoc/createJobCard`).

```json
{ "action": "createJobCard", "body": {
  "vin": "VF3CABHW6GT204366", "market": "IT", "source": "WOC",
  "UserName": "mario.rossi", "dealerCode": "0062230",
  "JobCard_Title": "Tagliando 30.000km", "TAMAccessCode": "ACC123"
} }
```

```json
{ "action": "getUploadDocURL", "body": {
  "JobCardId": "JC123456", "Filename": "fattura.pdf",
  "ContentType": "application/pdf", "AccessToken": "eyJhbGciOi...", "Filetype": "pdf"
} }
```

```json
{ "action": "uploadedDoc", "body": {
  "JobCardId": "JC123456", "DocumentId": "DOC987654",
  "Action": "confirm", "AccessToken": "eyJhbGciOi..."
} }
```

Risposta: `200` con il body upstream in caso di successo; `400` se manca un
campo obbligatorio; `502` per errori upstream/di rete.

#### Utilizzo CLI

```bash
node index.js createJobCard   ./payload-createJobCard.json
node index.js getUploadDocURL ./payload-getUploadDocURL.json
node index.js uploadedDoc     ./payload-uploadedDoc.json
```

Vedi `moparDoc/README.md` per il dettaglio completo.

---

### v360

Lambda per le API **ASV360** (Vehicle 360): compatibilità OTA e dettagli veicolo, con autenticazione PingFederate.

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) |
| `v360Service` | `otaCompatibility(token, params)` | POST `/otaCompatibility` – compatibilità aggiornamenti OTA |
| `v360Service` | `getDetails(token, params)` | POST `/getdetails` – dettaglio veicolo |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Parametri `otaCompatibility`

| Parametro | Obbligatorio | Descrizione |
|---|---|---|
| `vin` | ✅ | VIN del veicolo |
| `includeOtaHistoryData` | ❌ | `"true"` / `"false"` (default `"true"`) |
| `locale` | ❌ | Es. `"fr_FR"` (default `"en_EN"`) |

#### Parametri `getDetails`

| Parametro | Obbligatorio | Descrizione |
|---|---|---|
| `vin` | ✅ | VIN del veicolo |
| `searchType` | ❌ | Default `"vin"` |
| `countryCode` | ❌ | Es. `"FR"` |
| `clientId` | ❌ | Client identifier |
| `offering` | ❌ | Es. `"Vehicle Description, campaign, warranty"` |
| `languageCode` | ❌ | Es. `"fr"` |

#### Utilizzo CLI

```bash
node index.js otaCompatibility <vin> [key=value ...]
node index.js getdetails       <vin> [key=value ...]
# es: node index.js otaCompatibility VR7EMZKU7RJ963237 locale=fr_FR
# es: node index.js getdetails VF3VEAHHWFZ062040 countryCode=FR languageCode=fr
```

---

### pkEper

Lambda per i **pacchetti ePer** (Stellantis FCA/Fiat), client SOAP che replica il servizio `WsIQPckEper` originariamente in PHP.

#### Handlers disponibili

| `event.action` | Metodo client | Descrizione |
|---|---|---|
| `getGroupsPRRequest` | `client.getGroupsPRRequest(body)` | Lista gruppi pacchetti per un VIN |
| `getSubgroupsPR` | `client.getSubgroupsPR(body)` | Lista sottogruppi di un gruppo |
| `getPackagesPR` | `client.getPackagesPR(body)` | Lista pacchetti di un sottogruppo |
| `getPackageDetailsPR` | `client.getPackageDetailsPR(body)` | Dettaglio di un pacchetto |

#### Struttura

```
pkEper/
├── index.js               # Lambda entry-point + demo CLI
├── WsIQPckEper.js          # Client SOAP (equivalente WsIQPckEper.class.php)
├── test.js                 # Smoke-test manuale
└── __tests__/              # Unit test Jest
```

#### Event shape

```json
{
  "action": "getGroupsPRRequest | getSubgroupsPR | getPackagesPR | getPackageDetailsPR",
  "body": { "coddealer": "0073741", "codmarket": "1000", "VIN": "...", "lingua": "IT" }
}
```

---

### pkDocsoa

Lambda per i **pacchetti DocSOA** (Stellantis PSA), client REST che replica il servizio SOAP originario. Il gateway `api-cert-preprod.groupe-psa.com/api/cert-aai` richiede, oltre a Basic Auth/WS-Security e agli header `X-IBM-Client-Id`/`X-IBM-Client-Secret`, un **certificato client mTLS**: certificato e chiave (segreti Secrets Manager `apicCert`/`apicKey`, gli **stessi** usati da `myPeople`) sono recuperati a runtime tramite l'[AWS Parameters and Secrets Lambda Extension](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html) (vedi `certService.js`, stesso pattern di `myPeople/certService.js`).

#### Handlers disponibili

| `event.action` | Metodo client | Descrizione |
|---|---|---|
| `functionsService` | `client.functionsService(params)` | Lista funzioni disponibili per un VIN |
| `forfaitService` | `client.forfaitService(params)` | Lista forfait (pacchetti) |
| `ibxDetailForfaitService` | `client.ibxDetailForfaitService(params)` | Dettaglio di un forfait |
| `ibxParametrageService` | `client.ibxParametrageService(params)` | Parametraggio IBX |
| `ibxDetailtpService` | `client.ibxDetailtpService(params)` | Dettaglio tempario (tp) |

#### Struttura

```
pkDocsoa/
├── index.js               # Lambda entry-point + demo CLI
├── DocSOARestClient.js     # Client REST DocSOA (axios) + helper vinParts
├── certService.js          # mTLS: recupero cert/key da Secrets Manager (apicCert/apicKey) + https.Agent cachato
├── test.js                 # Smoke-test manuale
└── __tests__/              # Unit test Jest
```

#### Event shape

```json
{
  "action": "functionsService | forfaitService | ibxDetailForfaitService | ibxParametrageService | ibxDetailtpService",
  "body": { "vin": "VF3CABHW6GT204366", "langue": "fr", "pays": "FR", "marque": "AP" }
}
```

---

### pkMenupricing

Lambda per i **pacchetti MenuPricing** (Opel/Vauxhall), client SOAP con autenticazione WS-Security.

#### Handlers disponibili

| `event.action` | Metodo client | Descrizione |
|---|---|---|
| `getJobs` | `client.getJobs(body)` | Lista job/pacchetti disponibili per un VIN |
| `getJobDetails` | `client.getJobDetails(body)` | Dettaglio di un job/pacchetto |

#### Struttura

```
pkMenupricing/
├── index.js                    # Lambda entry-point + demo CLI
├── MenuPricingSoapClient.js     # Client SOAP MenuPricing
├── test.js                      # Smoke-test manuale
└── __tests__/                   # Unit test Jest
```

#### Event shape

```json
{
  "action": "getJobs | getJobDetails",
  "body": { "vin": "W0VZT6GT7M1017935", "languageCode": "ES", "countryCode": "ES", "dealerIdentificationCode": "ES96590", "manufacturer": "OV" }
}
```

---

### pkManager

Lambda orchestratore che gestisce la **configurazione e la validazione dei pacchetti** su più web service (ePer, DocSOA, MenuPricing), determinando quali pacchetti configurati sono effettivamente disponibili per un VIN e recuperandone il dettaglio. Richiede il codice sorgente dei tre moduli fratelli (`pkEper`, `pkDocsoa`, `pkMenupricing`) tramite path relativi, oltre a `dbManager` (usato da `getPkList` per risolvere `pkwstouse` da `HQ_PKCONFIG`, dato `codbrand` + `market`/`codmarket`): in AWS viene per questo buildato con un `Makefile` custom (`Metadata: BuildMethod: makefile` in `template.yaml`) che ricrea la stessa struttura di cartelle sibling dentro il pacchetto Lambda.

#### Handlers disponibili

| `event.action` | Metodo manager | Descrizione |
|---|---|---|
| `getConfigPackages` | `manager.getConfigPackages(pkwstouse)` | Configurazione pacchetti per il ws indicato, letta da `woc.config_packages` (Aurora PostgreSQL) via `dbManager/ConfigPackagesRepository.js` |
| `getValidPackages` | `manager.getValidPackages(market, pkwstouse, VIN)` | Intersezione tra config e pacchetti live dal WS |
| `getValidPackagesDetail` | `manager.getValidPackagesDetail(market, pkwstouse, VIN)` | `getValidPackages` + dettaglio di ogni pacchetto in parallelo |
| `getPriceAndAvailability` | `manager.getPriceAndAvailability(market, pkwstouse, VIN)` | `getValidPackagesDetail` + arricchimento `AV_LOCAL`/`PRICE`/`SCONTO` per ogni riga di `listaOperazioni`/`listaRicambi` |
| `getPkList` | `manager.getPkList(codbrand, documentId, customerId, VIN, market, dealerIdentificationCode)` | Orchestratore end-to-end: risolve `pkwstouse` da `HQ_PKCONFIG` tramite `dbManager.getPkwstouse(pool, { codmarket: market, codbrand })`, poi come `getPriceAndAvailability`, ma **normalizza** ogni pacchetto allo stesso set di chiavi (`result, codice, descrizione, pkPrice, isFixedPrice, packageType, niveau, listaOperazioni, listaRicambi, category`), a prescindere dal `pkwstouse` risolto |

`pkwstouse` accetta i valori: `eper`, `docsoa`, `menupricing`.

Ogni dettaglio pacchetto riporta anche `isFixedPrice`/`packageType`: sempre `"0"`/`"QE"` per `eper`; per `menupricing`/`docsoa`, `"1"`/`"FP"` se il pacchetto è a prezzo fisso (promozione "Lex" per menupricing, forfait `ibxDetailForfaitService` per docsoa), altrimenti `"0"`/`"QE"`. Per `docsoa`, se il forfait non viene trovato si tenta un fallback su `ibxDetailtpService` (tempario). Vedi `pkManager/README.md` per il dettaglio completo.

> **Sender dinamico (`getPriceAndAvailability`)**: `PkManager.js::_buildDmsSender(market,
> vehicleId, username)` deriva il Sender dell'inquiry DMS (v. tabella `sender`
> in [dms](#dms) → `postDmsInquiry`) da `this.wsConfig` (eper/docsoa/menupricing)
> come override **espliciti** (`mainSincom` da `menupricing.dealerIdentificationCode`/
> `eper.coddealer`/`docsoa.codePdv`, `dealerCountryCode`/`language` da
> menupricing/docsoa, `brand` da `docsoa.codbrand`), poi delega a
> `dms/dmsService.js::resolveDynamicSenderFields({ username, vin: vehicleId }, overrides)`
> — STESSO meccanismo centralizzato usato anche da `jobcard`/`pkFavorite` (v.
> nota "Risoluzione automatica" nella sezione [dms](#dms)): solo i campi che
> `wsConfig` non fornisce vengono risolti automaticamente da `username`
> (sessione/myPeople) e `vehicleId` (brand da v360). `physicalSiteId` resta
> `docsoa.codePdv` (default statico); `market` è passato as-is (stesso
> parametro di `getPkList`/`getPriceAndAvailability`, entrambi ora estesi con
> un parametro `username` propagato a `_buildDmsSender`). `_buildDmsSender()` è
> **asincrona e non accede direttamente a `dbManager`**: il lookup dinamico
> `physicalSiteId`/`dealerNumberIdSource` su `woc.ang_snowflakes` resta
> centralizzato in `dms/dmsService.js::buildApplicationArea` (v. nota "Sender
> dinamico centralizzato" nella sezione [dms](#dms)): se il `sender` passato
> contiene `dealerNumberId`+`market`+`brand`, `dms` esegue il lookup e
> sovrascrive i valori "sintetici" (`docsoa.codePdv` / lo stesso
> `dealerNumberId`) con quelli reali. `username` è risolto da
> `pkManager/index.js::resolveUsername(event, body)` (stesso pattern
> authorizer.sub/fallback `body.username` di `jobcard`/`pkFavorite`).

> ⚠️ **Nota**: `getValidPackages`/`getValidPackagesDetail` invocano internamente metodi (`getCompletePkEperList`, `getCompletePkMpList`, `getCompletePkSOAList`) non ancora implementati sui client `WsIQPckEper`/`MenuPricingSoapClient`/`DocSOARestClient`. Da completare prima di un utilizzo in produzione di queste due action.

#### Struttura

```
pkManager/
├── index.js          # Lambda entry-point + CLI
├── PkManager.js       # Classe orchestratore
├── test.js            # Smoke-test manuale
└── __tests__/         # Unit test Jest
```

#### Event shape

```json
{
  "action": "getConfigPackages | getValidPackages | getValidPackagesDetail",
  "body": { "market": "IT", "pkwstouse": "eper", "VIN": "ZAC5JABL9PJK00363" }
}
```

---

---

### translations

Lambda per il recupero dei **file di traduzione** (`GET /translations?lang=en`), letti da un bucket S3 al path `locales/{lang}/translation.json`. L'accesso ai dati è isolato dietro un'interfaccia `TranslationsRepository`, per permettere in futuro di sostituire S3 con un database senza impattare l'handler HTTP.

#### Utilizzo CLI

```bash
node index.js translations lang=en
```

#### Event shape

```json
{ "action": "translations", "queryStringParameters": { "lang": "en" } }
```

### session

Lambda che restituisce i **dati di sessione** (`codmarket`, `marketIso`, `oic`, `sincom`, `physicalsite`, `pdvId`, preferenze pezzi, sconti massimi, ecc.) per l'utente autenticato.

L'Handler HTTP (dietro API Gateway, proxy REST) **non si fida di alcun parametro fornito dal client** (query/path/body): l'identità arriva sempre dal Lambda Authorizer (`lmb-np-bsn0027990-<env>-authorizer`), valorizzata in `event.requestContext.authorizer`:

- `sub` — id utente stabile (username IURSMA, es. `"0073741.d235"`) — è l'**unico** valore usato come `username` per il flusso `myPeople -> dms/settings`. Se assente, la Lambda risponde `401` senza interrogare alcun repository (nessun fallback su parametri client-controllati, per evitare che un chiamante possa richiedere la sessione di un altro utente passando uno `username`/`codmarket` arbitrario).
- `roles` — stringa CSV (es. `"dealer,advisor"`), esposta come array da `getAuthContext(event)`; l'autorizzazione applicativa (chi può fare cosa) resta a carico di chi consuma questi dati. Questo array viene incluso anche nel body della risposta 200, come `userroles` (vedi nota sotto).
- `profile` — JSON string col profilo canonico (stessa forma di `GET /auth/user-info`: `sub`, `given_name`, `family_name`, `name`, `email`, `locale`, `country`, `roles[]`, `dealer_code`, `dealer_name`, `brand`, `region_code`, ...), parsato da `getAuthContext(event)` se presente (`null` se assente o JSON non valido). Non usato oggi per calcolare la sessione (si usa sempre `myPeople` via `sub`), disponibile per usi futuri.

Con `sub` disponibile, la Lambda chiama `myPeople` (`readUserProfiles`, per recuperare mercato/OIC/dealer/lingua/tipo utente), poi legge **in parallelo** sette cache/tabelle Aurora popolate/mantenute dai moduli `dmlConfigSync`/`dbManager` (nessuna chiamata live a `dms/*` da parte di `session`): `woc.dms_settings` (per `isdml`/`dmlcustomerupdate`/`dmldiscount`, chiave `country`+`brand`+`dealer`), `woc.dml_configurations` (per `companytypes`/`customertitles`, chiave `country`+`language`, entrambi derivati dallo stesso `NATIONiso2` di myPeople), la tabella `woc.anag_brand` (per risolvere i loghi dei brand di ogni OIC, vedi nota `brandLogos` sotto), la tabella `woc.ang_snowflakes` (per risolvere `marketIso`, il codice ISO paese del dealer, dato `codmarket`, tramite `dbManager.getCountryIsoCode`, e per risolvere `oics[].brands`, vedi nota sotto), la tabella `woc.hq_application_enabling` (per filtrare gli OIC disabilitati per WOC, vedi nota sotto), e la tabella `woc.addr_snowflakes` (per risolvere `oics[].address`/`oics[].zipcode`/`oics[].city`, vedi nota sotto), componendo un JSON con **la stessa forma storica** della risposta S3 — vedi `MyPeopleDmsSessionRepository` — a cui l'handler (`src/index.js`) aggiunge il campo `userroles` (vedi nota sotto). I campi non derivabili da myPeople/dms (es. `physicalsite`, `pdvId`, `inmandate`, `vat`, `pkwstouse`, `interiorcarwash`/`exteriorcarwash`, `partpref_*`, `pcydealer1-3`, `pcystellantis1-3`, `maxdiscountperc`, `maxdiscountval` — dati che nel flusso storico arrivano da una tabella dedicata, non da myPeople/dms) sono valorizzati a `null`. Se l'utente non risulta su myPeople (`RC`/`STATUS` non di successo), la Lambda risponde `404`.

> **Nota (utenti HQ):** myPeople modella **solo** i profili della rete dealer (username IURSMA): per un utente HQ (staff Stellantis, non dealer, es. `"SF48816"`) risponde con `RC=121`, `STATUS="HQ users are not allowed for this feature."`, `User={}`. Questo caso **non** viene trattato come utente non trovato (404, riservato a `RC` diverso da `0`/`121` o `User` assente): `MyPeopleDmsSessionRepository.getSessionData` ritorna invece una sessione 200 "vuota" (stessa forma/chiavi del JSON storico, tutti i campi dealer-specific `null`/`[]`, `usertype: "HQ"`), cosi' un utente HQ legittimo può comunque accedere all'app senza errori.

> **Nota (`userroles`):** il body della risposta 200 include sempre un campo `userroles` (array di stringhe, es. `["dealer","advisor"]`, `[]` se l'authorizer non valorizza `roles`), preso **esclusivamente** da `event.requestContext.authorizer.roles` (Lambda Authorizer) tramite `getAuthContext(event)` — mai da myPeople/dms, stesso principio "identità solo dall'authorizer" già applicato a `sub`. Aggiunto dall'handler (`src/index.js`) dopo la chiamata al repository, non fa parte dell'oggetto restituito da `MyPeopleDmsSessionRepository`/`S3SessionRepository`: viene inserito nell'ordine delle chiavi della risposta **subito dopo `profile`**, seguito dai 3 flag `hqCentral`/`hqMarket`/`dealer` (vedi nota sotto), da `hqMarketsList` (vedi nota sotto) e poi da `userroles` stesso (in fondo se `profile` non fosse presente).

> **Nota (`hqCentral`/`hqMarket`/`dealer`):** il body della risposta 200 include sempre questi 3 campi numerici `0`/`1`, derivati da `userroles` tramite `resolveRoleFlags(roles)` (`src/index.js`), **un solo flag a `1` per volta** (priorità `hqCentral` > `hqMarket` > `dealer`): `hqCentral = 1` se un ruolo contiene la sottostringa `HQCENTRAL` (case-insensitive, es. `WRT.WOC.NONPROD.HQCENTRAL`, prefisso `Z` ed ambiente `NONPROD`/`PROD` variabili e ignorati); altrimenti `hqMarket = 1` se un ruolo contiene `HQNSC` seguito da 4 cifre, il codice mercato (es. `ZWRT.WOC.NONPROD.HQNSC3109`); altrimenti (default, incluso il caso `userroles` vuoto) `dealer = 1`. Sono inseriti nell'ordine delle chiavi della risposta **subito dopo `profile`, prima di `hqMarketsList`/`userroles`**.

> **Nota (`hqMarketsList`):** il body della risposta 200 include sempre un campo `hqMarketsList` (array di oggetti `{ market, description }`, es. `[{ "market": "3109", "description": "France" }]`), calcolato da `resolveHqMarketsList` (`src/hqMarketsResolver.js`) in base ai flag `hqCentral`/`hqMarket` sopra descritti e **mai** valorizzato lato client: per un `dealer` (`hqCentral=0`, `hqMarket=0`) è sempre `[]` (nessuna query eseguita); per un utente `hqCentral=1` contiene **tutti** i mercati distinti presenti in `woc.ang_snowflakes` (stesso filtro `fl_is_deleted_flag = 0` delle altre query su questa tabella, colonna `cd_market_code` alias `market`); per un utente `hqMarket=1` contiene il **singolo** mercato ricavato dal ruolo `HQNSC<4 cifre>` (es. `ZWRT.WOC.NONPROD.HQNSC3109` → mercato `"3109"`) (`[]` se nessun ruolo corrisponde al pattern). La colonna `gn_country_name` **non esiste** su `woc.ang_snowflakes`: la `description` è risolta con un `LEFT JOIN` su `woc.addr_snowflakes` (stesso `cd_market_code`, `fl_is_deleted_flag = 0`), quindi è `null` per un mercato presente in `ang_snowflakes` ma senza (ancora) righe indirizzo in `addr_snowflakes` (mai un errore). Stesso principio fault-tolerant delle altre letture DB di questa Lambda: un errore di query non blocca mai la sessione, `hqMarketsList` torna semplicemente `[]`. Inserito nell'ordine delle chiavi della risposta **subito dopo `dealer`, prima di `userroles`**.

> **Nota (`woc.ang_snowflakes`, righe cancellate logicamente):** **tutte** le query di `dbManager` su `woc.ang_snowflakes` (`getCountryIsoCode`, `getPhysicalSiteAndSincom`, `getPhysicalSiteAndPdvId`, `resolveArcadBrandCode`, `getBrandsByOics` in `AnagSnowflakesRepository.js`; `getEnablingConfiguration`, `getAddressByOics` in `HqRepository.js`) filtrano `fl_is_deleted_flag = 0`, escludendo le righe cancellate logicamente dalla sorgente Snowflake (`fl_is_deleted_flag = 1`, colonna SMALLINT 0/1, v. `sql/create_table_ang_snowflakes.sql`). Questo evita, in particolare, che `oics[].brands` (i brand mostrati per ciascun OIC nella risposta di sessione) includa codici brand di righe già disattivate/cancellate sulla sorgente.

> **Nota (companytypes/customertitles):** questi due campi **non** chiamano più live `dms/getCompanyTypes`/`dms/getCustomerTitles` ad ogni richiesta di sessione: vengono letti dalla tabella `woc.dml_configurations`, popolata una volta al giorno dal modulo `dmlConfigSync` (vedi sezione dedicata sotto). La lettura dalla cache **non blocca mai** la sessione: in caso di errore DB, riga assente per il mercato richiesto, o `country` non derivabile da myPeople, i due campi tornano semplicemente `[]` (nessun errore/502 propagato all'utente).

> **Nota (`isdml`/`dmlcustomerupdate`/`dmldiscount`):** questi tre campi **non** chiamano più live `dms/settings` ad ogni richiesta di sessione: vengono letti dalla tabella `woc.dms_settings` (chiave `country`+`brand`+`dealer`), popolata una volta al giorno dal modulo `dmlConfigSync` per le combinazioni registrate in `woc.dms_settings_enabled_dealers`. A differenza dei mercati (elenco piccolo, popolabile a mano), le combinazioni dealer non sono pre-enumerabili: al primo cache-miss per una combinazione mai vista, `session` ritorna i valori di default (`isdml: false`, `dmlcustomerupdate: null`, `dmldiscount: null`, mai un errore) **e registra** (best-effort, `INSERT ... ON CONFLICT DO NOTHING`) la combinazione in `woc.dms_settings_enabled_dealers`, cosicché la sincronizzazione schedulata del giorno successivo la popoli. Stesso principio fault-tolerant di companytypes/customertitles: un errore di lettura/registrazione non blocca mai la sessione.

> **Nota (`oics[].brandLogos`):** ogni elemento dell'array `oics` include, subito dopo il campo `brands`, un array `brandLogos` con i percorsi (`logo_s3_key`) dei loghi dei brand elencati in `brands` (CSV di codici numerici, es. `"30,31,33,43"` → `["assets/images/logo/brand-stla/CITROEN.png", "assets/images/logo/brand-stla/PEUGEOT.png", ...]`), risolti tramite un'unica query batch (per tutti gli OIC della sessione) sulla tabella `woc.anag_brand` (stessa tabella/cluster Aurora già usata dalla lambda `isStellantisBrand`). Stesso principio fault-tolerant delle altre letture DB di questa Lambda: `brandLogos` è `[]` se `brands` è assente/vuoto, se un codice non ha un logo associato, o se la query al DB fallisce per qualunque motivo (non blocca mai il resto della risposta di sessione).

> **Nota (`oics[].brands`):** il CSV di codici brand di ciascun OIC **non** è più (solo) quello fornito da myPeople: viene sovrascritto con l'elenco effettivo/aggiornato letto da `woc.ang_snowflakes` (`dbManager.getBrandsByOics`), aggregando (in un'unica query batch, per tutti gli OIC della sessione) i valori distinti di `cd_contract_brand_webdac_code` per gli snowflake con `cd_paired_oic_code` uguale al `CODE` dell'OIC (il "oic_paired" di myPeople). Se la tabella non ha righe per un OIC (o la query fallisce), `brands` ricade sul CSV originale fornito da myPeople per quell'OIC (mai un errore/502); se anche myPeople non lo fornisce, `brands` è `""`. `oics[].brandLogos` (nota sopra) viene sempre calcolato a partire da questo elenco eventualmente sovrascritto, non più dal CSV grezzo di myPeople.

> **Nota (OIC disabilitati per WOC):** gli OIC per cui esiste una riga in `woc.hq_application_enabling` con `enablewoc = 0` (per la coppia `market`+`oic`, tramite `dbManager.getDisabledOics`, un'unica query batch per tutti gli OIC della sessione) vengono **tolti** dall'array `oics` della risposta di sessione. Un OIC senza riga di configurazione resta abilitato di default (comportamento "opt-out", diverso dall'endpoint di amministrazione `hqManager`/`dbManager.getEnablingConfiguration`, che di default mostra un OIC come disabilitato quando manca la riga); un OIC con `MARKET`/`CODE` mancante non è verificabile e viene mantenuto per compatibilità. Stesso principio fault-tolerant delle altre letture DB di questa Lambda: un errore di lettura non toglie alcun OIC dalla lista (non blocca mai il resto della risposta di sessione).

> **Nota (`oics[].address`/`oics[].zipcode`/`oics[].city`):** questi tre campi di ciascun OIC **non** sono più (solo) quelli eventualmente forniti da myPeople: vengono sovrascritti con l'indirizzo del sito letto da `woc.addr_snowflakes` (`dbManager.getAddressByOics`, un'unica query batch per tutti gli OIC della sessione, join con `woc.ang_snowflakes` su `cd_paired_oic_code`/`cd_unique_site_code = cd_site_identification_code`): `address` ← `gn_address_1`, `zipcode` ← `cd_zip_code`, `city` ← `gn_town`. Se la tabella non ha righe per un OIC (o la query fallisce), i tre campi ricadono sui valori eventualmente forniti da myPeople per quell'OIC (`ADDRESS`/`ZIPCODE`/`CITY`, mai un errore/502); se anche myPeople non li fornisce, restano `null`. I campi vengono inseriti anche se assenti nell'oggetto OIC originale di myPeople.

> **Nota (`marketIso`):** codice ISO paese del dealer (colonna `cd_dealer_country_iso_code`), risolto a partire dal `codmarket` dell'utente (`Attributes.MARKETCODE`, colonna `cd_market_code`) tramite `dbManager.getCountryIsoCode(pool, { market })` sulla tabella `woc.ang_snowflakes` (snapshot dell'estrazione Snowflake "M2m-queries"). Stesso principio fault-tolerant delle altre letture DB di questa Lambda: `null` se `codmarket` è assente, se non esiste ancora una riga per il mercato, o se la query fallisce per qualunque motivo (non blocca mai il resto della risposta di sessione).

> **CLI (uso interno/debug, non esposto via API Gateway):** `node session/src/index.js [codmarket]` (flusso storico S3, default mercato `"1000"`) oppure `node session/src/index.js --username <username>` (flusso myPeople/dms) — invocazioni dirette da riga di comando, prive di contesto authorizer, mantenute solo per test/debug locale; **non** riflettono il comportamento dell'handler HTTP.

L'accesso ai dati è isolato dietro un'interfaccia `SessionRepository`, implementata da `S3SessionRepository` (flusso `codmarket`, usato solo dalla CLI) e da `MyPeopleDmsSessionRepository` (flusso `username`, usato dall'handler HTTP tramite `sub` e dalla CLI tramite `--username`), per permettere di aggiungere/sostituire sorgenti dati senza impattare l'handler HTTP (stessa architettura del modulo `translations`).

> **Nota tecnica:** per poter richiamare in-process il codice di `myPeople`, la cache DB di `dmlConfigSync` e `dbManager` (senza invocazioni Lambda-to-Lambda separate), `SessionFunction` in `template.yaml` usa `CodeUri: ./` (root del repo) + `Metadata: BuildMethod: makefile`, con un target dedicato in `Makefile` che copia `session/`, `myPeople/`, `dms/`, `dmlConfigSync/` e `dbManager/` nel pacchetto di build (stesso pattern già usato da `pkManager` per `pkEper`/`pkDocsoa`/`pkMenupricing`/`dms`/`dbManager`). `session` stesso **non richiede più `dms/`** (nessuna chiamata live rimasta): la cartella `dms/` resta comunque nel pacchetto perché è una dipendenza transitiva di `dmlConfigSync/index.js` (impacchettato come cartella sorella, non invocato da `session`).

#### Mappatura myPeople/dms → campi di sessione

| Campo output | Origine |
|---|---|
| `username` | username IURSMA usato per la chiamata myPeople (`sub` dall'authorizer, oppure valore passato a `--username` in CLI) |
| `codmarket` | `Response.User.Attributes.MARKETCODE` |
| `marketIso` | codice ISO paese del dealer (`woc.ang_snowflakes.cd_dealer_country_iso_code`), risolto tramite `dbManager.getCountryIsoCode(pool, { market: codmarket })`; `null` se `codmarket` assente, riga non trovata, o errore DB |
| `oic` | `CODE` dell'OIC con `MAIN: "Y"` (fallback: primo OIC disponibile) |
| `sincom` | `Attributes.MAINSINCOM` |
| `sessionbrand` / `brandvehic_fca` | primo codice del campo `BRANDS` (CSV) dell'OIC selezionato |
| `brandvehic_reftech` | codice brand transcodificato (tabella interna 83→AR, 00→FT, 70→LA, 57→JE, 55→CY, 77→FO, 66→AH, 56→DG, 58→RM, 30→AC, 31→AP, 33→DS, 43→OV, 97→CT); è anche il valore usato come `brand` nella lettura cache `woc.dms_settings` |
| `brandvehic_genome` | sempre `null` (nessuna tabella di mappatura disponibile) |
| `language` | codice lingua ISO2 minuscolo da `Attributes.NATIONiso2` (es. `it`) |
| `locale` | `` `${iso2}_${ISO2}` `` da `Attributes.NATIONiso2` (es. `it_IT`) |
| `usertype` | `Attributes.USERTYPE` |
| `isdml` | `true` se la cache `woc.dms_settings` (chiave `country`+`brand`+`dealer`) ha `success: true`; `false` se non ancora sincronizzata (cache-miss) o in caso di errore |
| `dmlcustomerupdate` | valore della chiave `knownCustomerUpdate` (fallback `accountCustomerUpdate`) nell'array `data` della cache `woc.dms_settings`, altrimenti `null` |
| `dmldiscount` | valore della prima chiave contenente `discount` nell'array `data` della cache `woc.dms_settings`, altrimenti `null` |
| `oics` | array `Response.User.OICs` di myPeople **filtrato** (tolti gli OIC con `enablewoc = 0` in `woc.hq_application_enabling`, vedi nota sopra), con tutte le chiavi di ogni oggetto in minuscolo (es. `MARKET`→`market`, `CODE`→`code`, `BRANDS`→`brands`, ...); il campo `brands` è sovrascritto con l'elenco letto da `woc.ang_snowflakes` (fallback al CSV di myPeople, vedi nota sopra), `address`/`zipcode`/`city` sono sovrascritti con l'indirizzo del sito letto da `woc.addr_snowflakes` (fallback ai valori di myPeople, `null` se nessuno dei due, vedi nota sopra), e ogni elemento include inoltre `brandLogos` subito dopo `brands` (vedi nota sopra) |
| `applications` | intero array `Response.User.Applications` di myPeople, riportato **as-is** ma con tutte le chiavi di ogni oggetto in minuscolo (es. `APPLICATION`→`application`, `PROFILE`→`profile`, `STATUS`→`status`, `MARKET`→`market`) |
| `companytypes` | array `company_types` letto dalla cache `woc.dml_configurations` per `(country, language)` (ISO2 minuscolo da `NATIONiso2`), popolata giornalmente da `dmlConfigSync`; `[]` se riga assente/errore DB/`country` non derivabile |
| `customertitles` | array `customer_titles` letto dalla stessa riga cache di `companytypes`; `[]` se riga assente/errore DB/`country` non derivabile |
| tutti gli altri campi | `null` (non derivabili da myPeople/dms) |

#### Funzioni principali

| Funzione | Descrizione |
|---|---|
| `handler(event)` | Entry-point Lambda HTTP: legge `sub` da `event.requestContext.authorizer` (via `getAuthContext`) e usa **sempre** `MyPeopleDmsSessionRepository` con `sub` come username; ignora qualunque `username`/`codmarket` fornito da query/path/criteria. Ritorna 401 se `sub` è assente, 200 con i dati, 404 se l'utente non è presente su myPeople, 502 su errori generici |
| `getAuthContext(event)` | Estrae `{ sub, roles, profile }` da `event.requestContext.authorizer`: `roles` (CSV) convertito in array, `profile` (JSON string) parsato in oggetto (`null` se assente/non valido) |
| `getSessionData(codmarket)` | `S3SessionRepository`: scarica `session/session_data.json` da S3 ed estrae la sezione relativa al mercato richiesto (usato solo dalla CLI) |
| `getSessionData(username)` | `MyPeopleDmsSessionRepository`: chiama `myPeople.readUserProfiles` e legge in parallelo le cache/tabelle `woc.dms_settings`/`woc.dml_configurations`/`woc.anag_brand`/`woc.ang_snowflakes` (nessuna chiamata live a `dms/*`), componendo il JSON di sessione |
| `buildRepository(overrides)` | Factory che costruisce `S3SessionRepository` (bucket/key/client configurabili via env o overrides, utile nei test e nella CLI) |
| `buildMyPeopleDmsRepository(overrides)` | Factory che costruisce `MyPeopleDmsSessionRepository` (funzioni myPeople/dms iniettabili via overrides, utile nei test) |

#### Struttura

```
session/
├── src/
│   ├── index.js                             # Lambda entry-point + CLI
│   ├── errors.js                             # SessionNotFoundError (404)
│   ├── repositoryFactory.js                  # Factory: buildRepository(), buildMyPeopleDmsRepository()
│   ├── hqMarketsResolver.js                   # resolveHqMarketsList(): calcola hqMarketsList (mercati HQ) da woc.ang_snowflakes
│   └── repositories/
│       ├── sessionRepository.js              # Interfaccia base
│       ├── s3SessionRepository.js            # Implementazione S3 (bucket + key JSON) — flusso codmarket
│       └── myPeopleDmsSessionRepository.js    # Implementazione myPeople + cache DB (dms/settings, company-types/customer-titles, brand logos) — flusso username
└── __tests__/                                # Unit test Jest
```

#### Event shape

```json
{ "criteria": { "codmarket": "3109" } }
```

oppure, per il nuovo flusso utente:

```json
{ "criteria": { "username": "0073741.d235" } }
```

oppure, dietro API Gateway:

```json
{ "queryStringParameters": { "codmarket": "3109" } }
```

```json
{ "queryStringParameters": { "username": "0073741.d235" } }
```

Senza alcun parametro, viene usato il mercato di default (`1000`).

#### Utilizzo CLI

```bash
node src/index.js                    # mercato di default (1000)
node src/index.js 3109               # mercato specifico
node src/index.js --username 0073741.d235   # flusso myPeople + dms
```

---

### myPeople

Lambda per il recupero dei **profili utente** tramite l'API PSA/Stellantis `readUserProfiles` (piattaforma IURSMA), esposta via API Connect. La chiamata richiede autenticazione **Basic Auth** + header `X-IBM-Client-Id`, oltre a un **certificato client mTLS** (coppia certificato/chiave privata PEM). Certificato e chiave non sono salvati su disco/S3: vengono recuperati a runtime da **AWS Secrets Manager** tramite l'[AWS Parameters and Secrets Lambda Extension](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html) (endpoint locale `http://localhost:2773/secretsmanager/get`), e usati per costruire un `https.Agent` dedicato, cachato tra invocazioni a caldo della stessa Lambda.

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `certService` | `fetchSecret(secretId)` | Recupera un secret da Secrets Manager tramite l'extension Lambda (porta locale 2773); normalizza il valore con `extractPem` |
| `certService` | `extractPem(value)` | Normalizza il valore del secret in un PEM valido: se è già un PEM lo restituisce trimmato, altrimenti estrae il blocco `-----BEGIN...-----END...-----` ovunque si trovi (utile quando il secret è stato salvato come oggetto "JSON-like" con newline reali invece che come Plaintext puro), altrimenti restituisce il valore originale invariato |
| `certService` | `getHttpsAgent()` | Costruisce (e cachea) un `https.Agent` con certificato/chiave client per l'mTLS |
| `myPeopleService` | `readUserProfiles({ username })` | Esegue la GET `readUserProfiles` con Basic Auth + `X-IBM-Client-Id` + agent mTLS (l'`identifier` è una costante letta da config, non un parametro di chiamata) |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Parametri `readUserProfiles`

| Parametro | Obbligatorio | Descrizione |
|---|---|---|
| `username` | ✅ | Identificativo utente (es. `0073741.d235`) |

> L'`identifier` non è più un parametro di input: è un valore costante configurato tramite la variabile d'ambiente `MYPEOPLE_IDENTIFIER` (vedi sezione Variabili d'ambiente).

#### Utilizzo CLI

```bash
node index.js <username>
# es: node index.js 0073741.d235
```

> **Nota:** la Lambda gira all'interno di una VPC (vedi `Globals.Function.VpcConfig` in `template.yaml`); affinché l'extension possa raggiungere Secrets Manager è necessario un NAT Gateway o un VPC Interface Endpoint per `secretsmanager` nelle subnet configurate.

---

### isStellantisBrand

Lambda per la **verifica dell'appartenenza di un brand al gruppo Stellantis**, esposta come endpoint `GET /api/isStellantisBrand`. Riceve un codice brand ARCAD (`ar_codbrand`) e verifica se esiste nella tabella `woc.anag_brand` del database Aurora PostgreSQL "wiadvisor" tramite RDS Proxy.

#### Endpoint

| Metodo | Path | Parametro | Descrizione |
|---|---|---|---|
| `GET` | `/api/isStellantisBrand` | `ar_codbrand` (query, required, max 2 chars, solo A-Z) | Verifica se il brand è Stellantis |

#### Risposte

| Status | Body | Descrizione |
|---|---|---|
| 200 | `{ "success": true, "isStellantisBrand": true }` | Brand presente in anagrafica |
| 200 | `{ "success": true, "isStellantisBrand": false }` | Brand non presente |
| 400 | `{ "success": false, "message": "..." }` | Errore di validazione input |
| 500 | `{ "success": false, "message": "Errore interno del server" }` | Errore interno (DB, Secrets Manager, ecc.) |

#### Struttura

```
isStellantisBrand/
├── index.js                    # Lambda handler (validazione + query)
├── package.json                # Dipendenze (pg, @aws-sdk/client-secrets-manager)
├── openapi.yaml                # Specifica OpenAPI 3.0
├── infrastructure.csv          # Riga CSV per team infrastruttura
├── shared/
│   └── dbClient.js             # Libreria condivisa connessione DB (pool pg riutilizzabile)
└── __tests__/                  # Unit test Jest + property-based test (fast-check)
```

#### Validazione input

1. `ar_codbrand` mancante/null/vuoto/whitespace → 400 `"ar_codbrand è obbligatorio"`
2. Lunghezza > 2 caratteri → 400 `"ar_codbrand deve essere di massimo 2 caratteri"`
3. Caratteri non alfabetici → 400 `"ar_codbrand deve contenere solo caratteri alfabetici"`
4. Conversione a uppercase prima della query

#### Connessione DB (shared/dbClient.js)

- Credenziali recuperate da **Secrets Manager** (`DB_SECRET_ARN`)
- Pool `pg` con TLS verso **RDS Proxy** (`RDS_PROXY_ENDPOINT`)
- Pool riutilizzato tra invocazioni (warm start), invalidato in caso di errore
- Timeout connessione: 5 secondi

---

### synch-status

Lambda per l'**aggiornamento dello stato di sincronizzazione DJC** di una job card. Riceve da DJC uno dei 4 eventi Kafka previsti dalla SRP DL KAFKA Specification e aggiorna (**UPDATE-only**, mai INSERT) il campo `djc_sync_status` del record già presente nella tabella `woc.comunication_asyncro_djc` del database Aurora PostgreSQL "wiadvisor", raggiunto tramite **RDS Proxy**.

> **Sicurezza:** la security di questa Lambda è **totalmente demandata al gateway IBM API Connect (APIC)**, inclusa l'autenticazione e la **validazione del token**. La Lambda assume che ogni invocazione ricevuta sia già autorizzata e **non esegue alcun controllo di token** (nessun `authService`): si concentra solo su parsing/validazione del payload, aggiornamento dello stato in Aurora, logging e tracing.

#### Endpoint (gateway IBM APIC)

Esposta sul gateway IBM APIC. In ambiente **DEV** l'endpoint è:

```
https://emea-aws.dev.np-api.stellantis.com/ps-dev/extra/woc/job-card/v1/synch-status
```

> Regola di naming ambiente (come per i nomi/ARN di ruoli, parametri SSM e secret): in **stage** `ps-dev`/`dev.np-api` diventano `ps-stage`/`stage.np-api`, in **produzione** non c'è il segmento `np-` (né il prefisso `np-` nei nomi delle risorse AWS).

| Metodo | Path | Body | Descrizione |
|---|---|---|---|
| `POST` | `/synch-status` | `eventType`, `jobCardId` (o `jobCardSrpId`), `timestamp` (ISO 8601) | Aggiorna `djc_sync_status` del record esistente |

I 4 `eventType` supportati (mappati sullo stato DB corrispondente):

| eventType | djc_sync_status |
|---|---|
| `DMS_PUSH_SUCCESS_WITHOUT_UPDATE` | `SUCCESS_WITHOUT_UPDATE` |
| `DMS_PUSH_SUCCESS_WITH_UPDATE` | `SUCCESS_WITH_UPDATE` |
| `DMS_PUSH_REFUSAL` | `REFUSAL` |
| `DMS_PUSH_FAILURE` | `FAILURE` |

#### Risposte

| Status | Body | Descrizione |
|---|---|---|
| 200 | `{ "success": true, "response": { "responseId", "jobCardId", "eventType", "status", "timestamp" } }` | Record aggiornato con successo |
| 400 | `{ "success": false, "error": "Bad Request", ... }` | Body non JSON valido o validazione payload fallita |
| 404 | `{ "success": false, "error": "Not Found", ... }` | Record non presente (deve essere creato prima da un'altra Lambda) |
| 503 | `{ "success": false, "error": "Service Unavailable", ... }` | Impossibile connettersi ad Aurora |
| 504 | `{ "success": false, "error": "Gateway Timeout", ... }` | Query DB oltre il timeout |
| 500 | `{ "success": false, "error": "Internal Server Error", ... }` | Errore interno |

#### Struttura

```
synch-status/
├── index.js                    # Lambda handler (parsing + validazione + UPDATE Aurora)
├── config.js                   # Configurazione centralizzata
├── validator.js                # Validazione payload
├── logger.js                   # Logging strutturato + traceId
├── package.json                # Dipendenze (pg, @aws-sdk/client-secrets-manager, @aws-sdk/client-ssm, ...)
├── shared/
│   └── dbClient.js             # Libreria condivisa connessione DB (pool pg riutilizzabile — identica a isStellantisBrand)
└── __tests__/                  # Unit test Jest
```

#### Permessi e ruolo IAM

Stessi permessi di `isStellantisBrand` (VPC access, X-Ray, `ssm:GetParameter` sui due parametri DB, `secretsmanager:GetSecretValue`, `kms:Decrypt`). A differenza di `isStellantisBrand` — che usa policy inline gestite da SAM — questa Lambda referenzia in `template.yaml` un **ruolo IAM pre-esistente** fornito dall'infra. In DEV:

```
arn:aws:iam::237024525379:role/stla-rol-np-bsn0027990-dev-synch-status
```

> Stessa regola di naming: `-dev` in dev, `-stage` in stage, in **produzione** nessun suffisso ambiente `np-` (`stla-rol-bsn0027990-prod-synch-status`). I permessi equivalenti a quelli di `isStellantisBrand` devono essere già presenti su quel ruolo (quando si valorizza `Role`, SAM ignora `Policies`).

#### Connessione DB (shared/dbClient.js)

- Credenziali recuperate da **Secrets Manager** (ARN letto dal parametro SSM `DB_SECRET_ARN_PARAM`)
- Pool `pg` con TLS verso **RDS Proxy** (endpoint letto dal parametro SSM `RDS_PROXY_ENDPOINT_PARAM`)
- Pool riutilizzato tra invocazioni (warm start), invalidato in caso di errore
- Timeout connessione: 5 secondi

---

### pkFavorite

Lambda per **salvare/leggere i pacchetti preferiti** del dealer (toggle per singolo pacchetto + elenco per VIN). I dati sono persistiti su tabella `PKFAVORITE` in **PostgreSQL** (cluster Aurora `rds-np-bsn0027990-dev-aurora`, raggiunto tramite **RDS Proxy**, non direttamente). Le credenziali del DB vengono lette da **AWS Secrets Manager** tramite l'[AWS Parameters and Secrets Lambda Extension](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html) (stesso pattern di `myPeople`), riusando il layer esistente `MyPeopleExtensionLayerArn`.

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `db` | `fetchSecretJson(secretId)` | Recupera e fa il parse JSON di un secret da Secrets Manager tramite l'extension Lambda |
| `db` | `getPool()` | Costruisce (e cachea) un `pg.Pool`: usa le credenziali da env se presenti, altrimenti le recupera da Secrets Manager |
| `FavoriteRepository` | `listFavorites(pool, { username })` | Elenca tutti i pacchetti preferiti di un dealer (ricerca solo per `username`, indipendentemente dal VIN), ordinati per `created_at` |
| `FavoriteRepository` | `toggleFavorite(pool, { username, vin, packageCode })` | Elimina il preferito se già presente, altrimenti lo crea (toggle) |

#### Contratto API

| Metodo | Parametri | Descrizione |
|---|---|---|
| `GET` | `vin` (query, obbligatorio); `mainSincom`, `market`/`codmarket`, `brand`/`codbrand`, `language`, `dealerCountryCode`/`marketIso` (query, tutti opzionali — **override di solo test/debug, il FE non li invia mai**) | Elenca tutti i pacchetti preferiti dell'utente autenticato (ricerca solo per username); i dati vengono poi arricchiti via DML usando il `vin` indicato |
| `POST` | `vin`, `package` (body, obbligatori) | Aggiunge/rimuove (toggle) il pacchetto preferito |

> **Sicurezza:** lo `username` **non** viene mai letto dal body quando è presente un contesto di autenticazione (`event.requestContext.authorizer.sub`): in quel caso è l'unica fonte accettata (401 se assente). Il fallback su `body.username` è consentito solo in assenza totale di `authorizer` (comodo per test CLI/invocazione diretta), stesso identico criterio già adottato in `session`.

> **Sender dinamico (GET)**: come `jobcard`/`pkManager` (v. nota "Risoluzione
> automatica" nella sezione [dms](#dms)), ogni chiamata DML (`LFP`, una per
> pacchetto preferito) usa un `sender` costruito da
> `index.js::buildDmsSender(resolveSessionContext(body), username, vin)` che
> delega a `dms/dmsService.js::resolveDynamicSenderFields({ username, vin },
> sessionContext)`: `dealerNumberId` ← `resolved.mainSincom`, `serviceId` ←
> `username` (da authorizer), `languageCode` ← `resolved.language`,
> `dealerCountryCode` ← `resolved.dealerCountryCode`, `brand` ←
> `resolved.brand`, `market` ← `resolved.market` (solo chiave di lookup lato
> `dms`, mai un campo `Sender`). Il **frontend non passa (e non deve passare)**
> questi campi: `resolveSessionContext(body)` resta un override opzionale di
> solo test/debug (query string, v. tabella sopra) — nel flusso reale sono
> assenti, e vengono risolti automaticamente da `username`
> (`session/src/sessionContextCache.js`, cache best-effort su DynamoDB
> (`TmpCacheTable`, chiave `session:context:<username>`), utile perché lo
> stesso username può richiedere l'arricchimento DML di più pacchetti
> preferiti nella stessa invocazione/istanza Lambda "warm") e da `vin`
> (`v360/v360Service.js::getCachedBrand`, cache best-effort su DynamoDB
> (`TmpCacheTable`, chiave `v360:getdetails:<vin>`)). Se la risoluzione
> fallisce (myPeople/
> ASV360 irraggiungibili, ...) i soli campi mancanti restano non valorizzati —
> mai un'eccezione che blocchi la GET dei preferiti. La CLI (`node index.js
> list ...`) non passa alcun sender (comportamento invariato).

#### Utilizzo CLI

```bash
node index.js list <username> <vin>
node index.js toggle <username> <vin> <packageCode>
```

---

### dmlConfigSync

Lambda **schedulata** (EventBridge Schedule, `cron(0 8 * * ? *)` — 08:00 UTC ogni giorno, vedi `template.yaml`) che sincronizza una volta al giorno due cache indipendenti su Aurora PostgreSQL, così che `session` possa leggerle dal DB invece di chiamare i servizi DML live ad ogni richiesta di sessione:

1. **company-types/customer-titles** per i mercati abilitati;
2. **dms/settings** per le combinazioni `country`+`brand`+`dealer` abilitate (usato per `isdml`/`dmlcustomerupdate`/`dmldiscount`).

Ad ogni esecuzione (le due sync condividono lo stesso bearer token PingFederate, ottenuto una sola volta):

**Mercati (company-types/customer-titles):**
1. legge l'elenco dei mercati abilitati dalla tabella `woc.dml_enabled_markets` (`country`, `language`, `active`) — gestibile via SQL senza bisogno di un redeploy per abilitare/disabilitare un mercato;
2. per ciascun mercato chiama **in parallelo** `dms.getCompanyTypes`/`dms.getCustomerTitles`;
3. upserta il risultato (`company_types`, `customer_titles` come JSONB, `[]` se il servizio risponde 404/senza dati) nella tabella `woc.dml_configurations` (PK `country`+`language`).

**Dealer (dms/settings):**
1. legge l'elenco delle combinazioni abilitate dalla tabella `woc.dms_settings_enabled_dealers` (`country`, `brand`, `dealer`, `active`) — popolata **automaticamente** da `session` al primo cache-miss per una combinazione mai vista (nessun popolamento manuale necessario per i nuovi dealer, a differenza dei mercati);
2. per ciascuna combinazione chiama `dms.getDmsSettings`;
3. upserta il risultato (`success` come booleano, `data` come JSONB, `[]` se il servizio risponde 404/senza dati) nella tabella `woc.dms_settings` (PK `country`+`brand`+`dealer`).

Ogni mercato/dealer viene processato in isolamento (`Promise.allSettled`): un elemento che fallisce (rete, credenziali, DB) non blocca la sync degli altri elementi abilitati; il risultato per-elemento (`success`/`error`) viene loggato e restituito nel summary (`results` per i mercati, `dealerResults` per i dealer).

> **Nota tecnica:** stesso pattern di `pkManager`/`session`: `DmlConfigSyncFunction` in `template.yaml` usa `CodeUri: ./` + `Metadata: BuildMethod: makefile`, con un target dedicato in `Makefile` che copia `dmlConfigSync/` e `dms/` nel pacchetto di build. La connessione DB riusa lo stesso cluster Aurora/RDS Proxy e lo stesso secret di `pkFavorite` (`PkFavoriteDbHost`/`PkFavoriteDbSecretId`), nessun nuovo parametro CloudFormation.

#### Funzioni principali

| Funzione | Descrizione |
|---|---|
| `handler()` | Entry-point Lambda (trigger `Schedule`): esegue `runSync()` e logga il summary |
| `runSync(overrides)` | Orchestratore: legge mercati e dealer abilitati (in parallelo), ottiene un bearer token condiviso, sincronizza tutti i mercati e tutti i dealer in parallelo isolando gli errori per singolo elemento; ritorna `{success, results, dealerResults}`; dipendenze iniettabili via `overrides` per i test |
| `syncMarket(pool, token, market, deps)` | Sincronizza un singolo mercato (company-types + customer-titles in parallelo) e upserta il risultato in `woc.dml_configurations` |
| `syncDealer(pool, token, dealer, deps)` | Sincronizza una singola combinazione country+brand+dealer (dms/settings) e upserta il risultato in `woc.dms_settings` |

#### Utilizzo CLI

```bash
node index.js sync
```

---

### auroraAutoStart

Lambda **schedulata** (EventBridge Schedule, `cron(0 6 ? * MON-FRI *)` — 06:00 UTC nei giorni lavorativi lun-ven, vedi `template.yaml`) il cui unico scopo è **avviare automaticamente ogni mattina il cluster Aurora di stage se risulta spento**.

**Contesto:** un tool centralizzato Stellantis ("Stellantis startstop tool", esterno a questo repository) spegne ogni sera il cluster Aurora `rds-np-bsn0027990-${Environment}-aurora` per risparmio costi sull'ambiente non-prod (verificabile dal tag `stla_scheduler_action` applicato al cluster e dagli eventi RDS ~19:12 UTC), ma **non prevede alcun riavvio automatico al mattino** — confermato via CloudTrail: prima di questa Lambda, tutte le chiamate `StartDBCluster` storiche erano invocazioni manuali di un operatore.

Ad ogni esecuzione:
1. legge lo stato corrente del cluster (`rds:DescribeDBClusters`);
2. se lo stato è `"stopped"`, invoca `rds:StartDBCluster`;
3. se lo stato è qualsiasi altro valore (`available`, `starting`, `backing-up`, ...) non fa nulla — idempotente, sicuro da rieseguire anche se il cluster è già stato avviato manualmente prima dello scheduling.

> **Nota:** deployata **solo per l'ambiente stage** (`Condition: IsStage` in `template.yaml`) — l'ambiente **dev** resta sempre acceso 24/7 (nessuno spegnimento automatico osservato) e **prod** non è gestito da questo scheduler. Nessun nuovo parametro CloudFormation: il nome del cluster è derivato con la stessa convenzione di naming già in uso (`rds-np-bsn0027990-${Environment}-aurora`).

#### Funzioni principali

| Funzione | Descrizione |
|---|---|
| `handler()` | Entry-point Lambda (trigger `Schedule`): legge `AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER` e chiama `startClusterIfStopped()` |
| `startClusterIfStopped(dbClusterIdentifier, deps)` | Verifica lo stato del cluster e lo avvia solo se `"stopped"`; ritorna `{clusterIdentifier, previousStatus, action, message}`; dipendenze iniettabili via `deps` per i test |

#### Utilizzo CLI

```bash
node index.js
```

---

## Installazione

Ogni modulo è indipendente. Installare le dipendenze separatamente:

```bash
cd agendaSoa      && npm install
cd agendaSoaNaga  && npm install
cd dms            && npm install
cd jobcard        && npm install
cd djc            && npm install
cd v360           && npm install
cd pkEper         && npm install
cd pkDocsoa       && npm install
cd pkMenupricing  && npm install
cd pkManager      && npm install
cd translations   && npm install
cd session        && npm install
cd myPeople       && npm install
cd pkFavorite     && npm install
cd moparDoc       && npm install
cd isStellantisBrand && npm install
cd synch-status   && npm install
cd dmlConfigSync  && npm install
cd auroraAutoStart && npm install
```

---

## Variabili d'ambiente

Ogni modulo legge le credenziali da un file `.env` nella propria cartella.  
Creare il file copiando `.env.example` e compilando i valori.

### agendaSoa / agendaSoaNaga

```env
AGENDA_SOA_HOST=https://...        # URL base del servizio AgendaSOA
AGENDA_SOA_USERNAME=...            # Username autenticazione Basic
AGENDA_SOA_PASSWORD=...            # Password autenticazione Basic
AGENDA_SOA_API_KEY=...             # API-Key statica (usata dall'endpoint appointment)
```

### dms

```env
DMS_PING_CLIENT_ID=...              # Client ID PingFederate (dedicato dms)
DMS_PING_CLIENT_SECRET=...          # Client Secret PingFederate (dedicato dms)
DML_IBM_CLIENT_ID=...              # X-IBM-Client-Id per le API DML
DML_IBM_CLIENT_SECRET=...          # X-IBM-Client-Secret per le API DML
DML_X_TARGET_ENV=stage             # Ambiente target (stage / prod)
# Per il lookup centralizzato (best-effort) di physicalSiteId/
# dealerNumberIdSource su woc.ang_snowflakes in buildApplicationArea() —
# stesse variabili/stesso Aurora "wiadvisor" di PkManagerFunction/SessionFunction
DBMANAGER_DB_HOST=...
DBMANAGER_DB_PORT=5432
DBMANAGER_DB_NAME=...
DBMANAGER_DB_SECRET_ID=...
```

### jobcard

```env
JOBCARD_PING_CLIENT_ID=...          # Client ID PingFederate (dedicato jobcard)
JOBCARD_PING_CLIENT_SECRET=...      # Client Secret PingFederate (dedicato jobcard)
DGT_CLIENT_ID=...                  # X-IBM-Client-Id per le API DGT
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API DGT
# Richieste perché il codice sorgente di dms/ è incluso in-process (Makefile):
# dms/dmsService.js::buildApplicationArea esegue il lookup best-effort di
# physicalSiteId/dealerNumberIdSource su woc.ang_snowflakes — stesse
# variabili/stesso Aurora "wiadvisor" di PkManagerFunction/SessionFunction.
# jobCardService.js non accede più direttamente a dbManager.
DBMANAGER_DB_HOST=...
DBMANAGER_DB_PORT=5432
DBMANAGER_DB_NAME=...
DBMANAGER_DB_SECRET_ID=...
```


### djc

```env
JOBCARD_PING_CLIENT_ID=...          # Client ID PingFederate — stesso client di jobcard (richiesto solo per saveJobcard)
JOBCARD_PING_CLIENT_SECRET=...      # Client Secret PingFederate — stesso client di jobcard (richiesto solo per saveJobcard)
DGT_CLIENT_ID=...                  # X-IBM-Client-Id per le API DGT (richiesto solo per saveJobcard)
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API DGT (richiesto solo per saveJobcard)
```

> Non richieste per i metodi `Save*` (che costruiscono solo `json_orig`/`json_mod`
> in locale) — solo per `saveJobcard`, che invia effettivamente il payload alla
> Push API SRP.

### moparDoc

```env
MOPARDOC_PING_CLIENT_ID=...         # Client ID PingFederate dedicato a moparDoc (scope prd:dgt)
MOPARDOC_PING_CLIENT_SECRET=...     # Client Secret PingFederate dedicato a moparDoc
MOPARDOC_IBM_CLIENT_ID=...          # X-IBM-Client-Id (job-docs connector + MoparDocs Browser API)
MOPARDOC_IBM_CLIENT_SECRET=...      # X-IBM-Client-Secret (job-docs connector + MoparDocs Browser API)
```

### v360

```env
V360_PING_CLIENT_ID=...             # Client ID PingFederate (dedicato v360)
V360_PING_CLIENT_SECRET=...         # Client Secret PingFederate (dedicato v360)
ASV_CLIENT_ID=...                  # X-IBM-Client-Id per le API ASV360
ASV_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API ASV360
ASV_GETDETAILS_CLIENT_ID=...       # clientId di default per getdetails (environment-specific)
```

### pkEper

```env
EPER_HOST=eper.parts.fiat.com      # Host servizio SOAP ePer
```

`coddealer`/`codmarket` sono passati nel `body` dell'evento Lambda (non da env).

### pkDocsoa

```env
DOCSOA_HOST=https://api-cert-preprod.groupe-psa.com/api/cert-aai   # Base URL gateway DocSOA
DOCSOA_USERNAME=...                    # Username autenticazione (WS-Security / Basic Auth)
DOCSOA_PASSWORD=...                    # Password autenticazione (WS-Security / Basic Auth)
DOCSOA_IBM_CLIENT_ID=...               # X-IBM-Client-Id per il gateway API Connect
DOCSOA_IBM_CLIENT_SECRET=...           # X-IBM-Client-Secret per il gateway API Connect
DOCSOA_CERT_SECRET_ID=apicCert         # (opzionale) id secret Secrets Manager col certificato client mTLS (STESSO usato da myPeople)
DOCSOA_KEY_SECRET_ID=apicKey           # (opzionale) id secret Secrets Manager con la chiave privata mTLS (STESSO usato da myPeople)
PROXY_HOST=...                         # (opzionale) proxy corporate Stellantis/PSA
PROXY_PORT=8080                        # (opzionale) porta proxy
```

### pkMenupricing

```env
MENUPRICING_WSDL=...        # URL base servizio (senza /Menus o /SecuredMenus)
MENUPRICING_USR=...         # Credenziali WS-Security (applicazione)
MENUPRICING_PWS=...
MENUPRICING_USR_REQ=...     # Credenziali di richiesta (dealerDetails nel body)
MENUPRICING_PWS_REQ=...
```

### pkManager

Orchestra `pkEper` + `pkDocsoa` + `pkMenupricing`: richiede le rispettive variabili sopra, più i parametri dealer/mercato specifici per ogni WS:

```env
# ── ePer ─────────────────────────────────────────────────────────────
EPER_CODDEALER=...
EPER_CODMARKET=...
EPER_LINGUA=IT
# EPER_TICKET=...                  # opzionale

# ── DocSOA ───────────────────────────────────────────────────────────
DOCSOA_CODBRAND=...
DOCSOA_LANGUE=...
DOCSOA_PAYS=...
DOCSOA_CODEPDV=...
# DOCSOA_LDP=... / DOCSOA_TYPE_INTERNET=...   # opzionali

# ── MenuPricing ──────────────────────────────────────────────────────
MP_LANGUAGE_CODE=...
MP_COUNTRY_CODE=...
MP_DEALER_IDENTIFICATION_CODE=...
MP_MANUFACTURER=...
```

### translations

```env
TRANSLATIONS_BUCKET_NAME=...        # Nome del bucket S3 con i file di traduzione (obbligatoria)
TRANSLATIONS_KEY_PREFIX=locales     # (opzionale) prefisso key S3 ({prefix}/{lang}/translation.json)
TRANSLATIONS_DEFAULT_LANG=en        # (opzionale) lingua di default quando "lang" non è passato
```

> **Nota:** `authService` implementa un meccanismo di cache del Bearer token su DynamoDB (tabella `TmpCacheTable`, env `DYNAMO_CACHE_TABLE_NAME` — v. `dynamoCache.js`) per evitare di richiedere un nuovo token ad ogni invocazione, condivisa tra le istanze/funzioni Lambda (a differenza della precedente cache su file `/tmp`, persa ad ogni cold start e mai condivisa tra funzioni diverse). Il token viene rinnovato automaticamente 30 secondi prima della scadenza e viene invalidato se scope/client_id non corrispondono più a quelli configurati.

### session

```env
SESSION_BUCKET_NAME=...              # Nome del bucket S3 con i dati di sessione (obbligatoria per il flusso codmarket)
SESSION_DATA_KEY=session/session_data.json  # (opzionale) key S3 del file JSON dati di sessione
SESSION_DEFAULT_MARKET=1000          # (opzionale) mercato di default quando "codmarket" non è passato
```

> **Nota:** i dati di sessione sono letti da un unico file JSON su S3 (`session/session_data.json`, stesso bucket di `translations`), indicizzato per codice mercato a 4 caratteri. Se il mercato richiesto non è presente nel file la Lambda risponde `404`.

> **Nota (flusso `username`):** quando viene passato `username` invece di `codmarket`, la Lambda richiama in-process il codice di `myPeople` e `dms`, quindi richiede anche **tutte** le variabili d'ambiente elencate nelle sezioni `dms` e `myPeople` qui sotto (`DMS_PING_CLIENT_ID`, `DMS_PING_CLIENT_SECRET`, `DML_IBM_CLIENT_ID`, `DML_IBM_CLIENT_SECRET`, `DML_X_TARGET_ENV`, `MYPEOPLE_*`), oltre alle variabili `DMLCONFIGSYNC_DB_*` (cache `woc.dms_settings`/`woc.dml_configurations`) e `DBMANAGER_DB_*` (tabelle `woc.ang_snowflakes`, per `marketIso`/`oics[].brands`, `woc.hq_application_enabling`, per il filtro degli OIC disabilitati, e `woc.addr_snowflakes`, per `oics[].address`/`oics[].zipcode`/`oics[].city`) — vedi rispettivamente `dmlConfigSync/.env.example` e `dbManager/.env.example` (stesso Aurora/secret di `pkFavorite`, nessun nuovo parametro CFN in AWS).

### myPeople

```env
MYPEOPLE_HOST=https://api-basic-preprod.groupe-psa.com   # Host base API myPeople/IURSMA
MYPEOPLE_BASE_PATH=/applications/mypeople/iursma/v1       # (opzionale) base path del servizio
MYPEOPLE_IBM_CLIENT_ID=...           # X-IBM-Client-Id per il gateway API Connect
MYPEOPLE_USERNAME=...                # Username Basic Auth
MYPEOPLE_PASSWORD=...                # Password Basic Auth
MYPEOPLE_CERT_SECRET_ID=apicCert     # (opzionale) id secret Secrets Manager col certificato client mTLS
MYPEOPLE_KEY_SECRET_ID=apicKey       # (opzionale) id secret Secrets Manager con la chiave privata mTLS
MYPEOPLE_IDENTIFIER=...              # Identificativo richiesta/dispositivo (UUID) — valore costante, non più un parametro di input
```

> **Nota:** certificato e chiave mTLS **non** vanno messi nel `.env`: sono recuperati a runtime da AWS Secrets Manager tramite l'AWS Parameters and Secrets Lambda Extension (layer aggiunto alla Lambda in `template.yaml`).

### isStellantisBrand

```env
DB_SECRET_ARN=arn:aws:secretsmanager:...   # ARN del secret con le credenziali DB (sm-np-bsn0027990-${Environment}-aurora-app)
RDS_PROXY_ENDPOINT=...                     # Endpoint del RDS Proxy per la connessione ad Aurora PostgreSQL
```

> **Nota:** il secret in Secrets Manager contiene un payload JSON con le chiavi `dbname` ("wiadvisor"), `engine` ("postgres"), `password`, `port` (5432), `username` ("wiadvisor_app"). La connessione è TLS via RDS Proxy. La Lambda gira in VPC.

### synch-status

```env
DB_SECRET_ARN_PARAM=/app/np-BSN0027990-dev/DB_SECRET_ARN          # Parametro SSM con l'ARN del secret credenziali DB
RDS_PROXY_ENDPOINT_PARAM=/app/np-BSN0027990-dev/RDS_PROXY_ENDPOINT # Parametro SSM con l'endpoint del RDS Proxy
```

> **Nota:** stesse due variabili d'ambiente (e stessi valori) di `isStellantisBrand`. La Lambda legge da SSM l'ARN del secret e l'endpoint RDS Proxy, poi le credenziali da Secrets Manager; connessione TLS via RDS Proxy, in VPC. Regola di naming: `-dev` in dev, `-stage` in stage, in produzione nessun `np-` né suffisso ambiente (`/app/BSN0027990/...`).

### pkFavorite

```env
PKFAVORITE_DB_HOST=rdsproxy-np-bsn0027990-dev.proxy-xxxx.eu-west-1.rds.amazonaws.com  # Host RDS Proxy (obbligatoria)
PKFAVORITE_DB_PORT=5432                    # (opzionale) default 5432
PKFAVORITE_DB_NAME=wiadvisor               # (opzionale) default wiadvisor
PKFAVORITE_DB_USER=...                     # (opzionale) se assente, letto da Secrets Manager
PKFAVORITE_DB_PASSWORD=...                 # (opzionale) se assente, letto da Secrets Manager
PKFAVORITE_DB_SECRET_ID=sm-np-bsn0027990-dev-aurora-app  # (opzionale) id secret con user/password/dbname/port
PKFAVORITE_DB_SSL=true                     # (opzionale) default true
# Per il codice sorgente di dms/ incluso in-process (Makefile): dms/dmsService.js
# ::buildApplicationArea esegue il lookup best-effort di physicalSiteId/
# dealerNumberIdSource su woc.ang_snowflakes — stesso Aurora "wiadvisor" di
# PkManagerFunction/SessionFunction (riusa gli stessi parametri PkFavoriteDb*)
DBMANAGER_DB_HOST=...
DBMANAGER_DB_PORT=5432
DBMANAGER_DB_NAME=...
DBMANAGER_DB_SECRET_ID=...
```

> **Nota:** user/password del DB **non** vanno messi nel `.env` in produzione: sono recuperati a runtime da AWS Secrets Manager tramite l'AWS Parameters and Secrets Lambda Extension, stesso layer riusato da `myPeople`. La connessione avviene sempre tramite **RDS Proxy**, non direttamente sul cluster Aurora.

### dmlConfigSync

```env
DMLCONFIGSYNC_DB_HOST=rdsproxy-np-bsn0027990-dev.proxy-xxxx.eu-west-1.rds.amazonaws.com  # Host RDS Proxy (obbligatoria)
DMLCONFIGSYNC_DB_PORT=5432                    # (opzionale) default 5432
DMLCONFIGSYNC_DB_NAME=wiadvisor               # (opzionale) default wiadvisor
DMLCONFIGSYNC_DB_USER=...                     # (opzionale) se assente, letto da Secrets Manager
DMLCONFIGSYNC_DB_PASSWORD=...                 # (opzionale) se assente, letto da Secrets Manager
DMLCONFIGSYNC_DB_SECRET_ID=sm-np-bsn0027990-dev-aurora-app  # (opzionale) id secret con user/password/dbname/port
DMLCONFIGSYNC_DB_SSL=true                     # (opzionale) default true
```

> **Nota:** stesso cluster Aurora/RDS Proxy e stesso secret Secrets Manager di `pkFavorite` (in `template.yaml` riusa infatti i parametri `PkFavoriteDbHost`/`PkFavoriteDbSecretId`, nessun nuovo parametro CloudFormation). Richiede inoltre **tutte** le variabili d'ambiente della sezione `dms` qui sopra (`DMS_PING_CLIENT_ID`, `DMS_PING_CLIENT_SECRET`, `DML_IBM_CLIENT_ID`, `DML_IBM_CLIENT_SECRET`, `DML_X_TARGET_ENV`), necessarie per chiamare `dms.getCompanyTypes`/`dms.getCustomerTitles`/`dms.getDmsSettings`.

---

### auroraAutoStart

```env
AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER=rds-np-bsn0027990-stage-aurora  # (opzionale in Lambda: impostata da template.yaml; obbligatoria solo per CLI/test locali)
AWS_REGION=eu-west-1                                                  # (opzionale in Lambda: già impostata automaticamente da AWS)
```

> **Nota:** in Lambda `AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER` è valorizzata automaticamente da `template.yaml` (`!Sub "rds-np-bsn0027990-${Environment}-aurora"`), nessun secret/credenziale DB richiesto (usa solo l'API di gestione RDS via IAM, non si connette al database).

---

## Unit Test & Coverage

### Framework

Tutti i moduli usano **[Jest](https://jestjs.io/)** come framework di test.  
I test sono completamente isolati: nessuna chiamata reale a servizi esterni (tutto mockato con `jest.mock()`).

La build **fallisce automaticamente** se la coverage scende sotto la soglia minima del **90%** su statements, branches, functions e lines (configurato via `coverageThreshold` in ogni `package.json`).

### Eseguire i test

```bash
# Solo test
cd agendaSoa && npm test

# Test + report di copertura (genera coverage/)
cd agendaSoa && npm run test:coverage
```

### Riepilogo test

| Modulo | Test Suites | Tests | File testati |
|---|:---:|:---:|---|
| **agendaSoa** | 7 | 81 | `index`, `agendaSOAClient`, `clientFactory`, `handlers/*` |
| **agendaSoaNaga** | 5 | 39 | `index`, `agendaNagaClient`, `clientFactory`, `handlers/*` |
| **dms** | 3 | 40 | `httpClient`, `authService`, `dmsService` |
| **jobcard** | 3 | 67 | `httpClient`, `authService`, `jobCardService` |
| **djc** | 4 | 61 | `httpClient`, `authService`, `jobCardService`, `DjcManager` |
| **moparDoc** | 4 | 37 | `httpClient`, `authService`, `moparDocService`, `index` |
| **v360** | 3 | 29 | `httpClient`, `authService`, `v360Service` |
| **pkEper** | 1 | 19 | `WsIQPckEper` |
| **pkDocsoa** | 2 | 40 | `DocSOARestClient`, `certService` |
| **pkMenupricing** | 1 | 14 | `MenuPricingSoapClient` |
| **pkManager** | 1 | 27 | `PkManager` |
| **translations** | 5 | 42 | `index`, `errors`, `repositoryFactory`, `handlers/translations`, `repositories/S3TranslationsRepository` |
| **session** | 7 | 74 | `index` (handler + CLI), `errors`, `repositoryFactory`, `repositories/sessionRepository`, `repositories/s3SessionRepository`, `repositories/myPeopleDmsSessionRepository` (+ lazy-load) |
| **myPeople** | 4 | 39 | `httpClient`, `certService`, `myPeopleService`, `index` (handler + CLI) |
| **isStellantisBrand** | 3 | 36 | `index` (handler), `shared/dbClient`, property-based (`fast-check`) |
| **synch-status** | 3 | 87 | `index` (handler + `_validatePayload`/`_buildResponse`), `config`, `validator` |
| **dmlConfigSync** | 4 | 50 | `index` (handler + CLI + `runSync`/`syncMarket`/`syncDealer`), `db`, `DmlConfigRepository`, `DmsSettingsRepository` |
| **auroraAutoStart** | 2 | 8 | `index` (handler), `services/auroraClusterService` |
| **Totale** | **58** | **753** | |

### Copertura del codice

| Modulo | Statements | Branches | Functions | Lines |
|---|:---:|:---:|:---:|:---:|
| **agendaSoa** | 100% ✅ | 96.96% ✅ | 100% ✅ | 100% ✅ |
| **agendaSoaNaga** | 100% ✅ | 92.68% ✅ | 100% ✅ | 100% ✅ |
| **dms** | 100% ✅ | 96.55% ✅ | 100% ✅ | 100% ✅ |
| **jobcard** | 99.06% ✅ | 93.89% ✅ | 100% ✅ | 100% ✅ |
| **djc** | 99.45% ✅ | 97.05% ✅ | 100% ✅ | 100% ✅ |
| **moparDoc** | 99.17% ✅ | 96.36% ✅ | 100% ✅ | 100% ✅ |
| **v360** | 100% ✅ | 93.18% ✅ | 100% ✅ | 100% ✅ |
| **pkEper** | 98.66% ✅ | 91.11% ✅ | 100% ✅ | 98.64% ✅ |
| **pkDocsoa** | 97.61% ✅ | 93.70% ✅ | 100% ✅ | 98.97% ✅ |
| **pkMenupricing** | 100% ✅ | 98.52% ✅ | 100% ✅ | 100% ✅ |
| **pkManager** | 99.01% ✅ | 90.47% ✅ | 100% ✅ | 100% ✅ |
| **translations** | 98.94% ✅ | 94.64% ✅ | 100% ✅ | 98.9% ✅ |
| **session** | 98.19% ✅ | 94.17% ✅ | 100% ✅ | 99.52% ✅ |
| **myPeople** | 99% ✅ | 94.59% ✅ | 100% ✅ | 100% ✅ |
| **isStellantisBrand** | 100% ✅ | 97.87% ✅ | 100% ✅ | 100% ✅ |
| **synch-status** | 94.85% ✅ | 94% ✅ | 100% ✅ | 94.76% ✅ |
| **dmlConfigSync** | 97.46% ✅ | 92.43% ✅ | 96.77% ✅ | 97.18% ✅ |
| **auroraAutoStart** | 100% ✅ | 100% ✅ | 100% ✅ | 100% ✅ |

> Soglia minima enforced: **90%** su tutti i criteri. La CI fallisce automaticamente se non raggiunta.
>
> **Nota (`synch-status`):** le 3 suite (`__tests__/config.test.js`, `validator.test.js`, `index.test.js`) passano tutte (87 test). La copertura aggregata è sopra il 90% su tutti i criteri (branch 94%, `config.js` a 100% di branch); le soglie per-file definite in `synch-status/package.json` (index 90/85, config 80/70, validator 100) sono ampiamente rispettate.

### Struttura dei test

```
<modulo>/
└── __tests__/
    ├── index.test.js           # Dispatcher Lambda (routing, 400 su action sconosciuta)
    ├── agendaSOAClient.test.js # Client REST: metodi pubblici, interceptors, _post, edge cases
    ├── clientFactory.test.js   # Factory: env vars, overrides
    └── handlers/
        ├── appointment.test.js
        ├── availableHours.test.js
        ├── cCSList.test.js
        └── data.test.js
```

### Cosa viene testato

#### agendaSoa
- **index** – routing verso tutti i handler, fallback `httpMethod`, 400 per action sconosciuta/assente
- **agendaSOAClient** – costruttore (con e senza argomenti), `_basicAuthHeader`, `_processResponse` (2xx/4xx/5xx), interceptors request/response, `_get`/`_getWithApiKey`/`_post` (inclusi `validateStatus`), tutti i metodi pubblici (`appointment`, `availableHours`, `cCSList`, `data`, `getAvHoursForRec`), padding orari, mapping CCS, filtro slot occupati, edge cases (tranches null, rdv null, formato data non standard)
- **clientFactory** – costruzione da env vars, override config
- **handlers** – merge parametri (queryString + body + params), 200/502/500, validazione parametri obbligatori

#### agendaSoaNaga
- **index** – routing `createnaga`/`updatenaga`, fallback `httpMethod`, 400 per action sconosciuta
- **agendaNagaClient** – `_basicAuthHeader`, `_processResponse`, `createnaga`, `updatenaga` (path con apptId, `authUser`), `_post` validateStatus
- **clientFactory** – costruzione da env vars, override config, metodi esposti
- **handlers** – parsing body, fallback su `params`, 400 se `apptId` mancante, 200/502/500

#### dms / jobcard / v360
- **httpClient** – parsing JSON/testo, concatenamento chunk, scrittura body, reject su errore di rete
- **authService** – cache valida, cache scaduta/assente (rinnovo), scrittura cache, errore HTTP, `access_token` assente, `expires_in` default
- **dmsService** – validazione parametri obbligatori `getDmsSettings` (country/brand/dealer), `postDmsInquiry` (MessageType/VehicleID obbligatori; `DocumentID`/`CustomerIdDms` a contenuto opzionale ma sempre presenti nel payload, rispettivamente come `''` e `null` se omessi), tipi inquiry (LFP/WL/MP), `buildTypeSection`, headers corretti (Authorization, IBM credentials), errori HTTP
- **jobCardService / v360Service** – validazione parametri obbligatori, tutti i filtri opzionali (date range, paginazione, ordinamento), headers corretti (Authorization, IBM credentials, x-trace-id), errori HTTP; per `jobCardService`: arricchimento `jobs[].packageType`/`packageCharge` (tutte le combinazioni `jobType`/`packageCode`/`paymentType`), posizionamento prima di `partInfo`/`laborInfo`, aggiunta `roInfo.roSource` subito dopo `sourceApplication` (incluso il caso `roInfo`/`sourceApplication` assenti); `saveJobCard` — POST `/jobCard` con payload/`body.payload`, headers corretti, errori HTTP

#### djc
- **httpClient / authService** – stessi casi di `jobcard` (file sincronizzati)
- **jobCardService** – `saveJobCard` (POST `/jobCard`), stessi casi di `jobcard/jobCardService.js::saveJobCard`
- **DjcManager** – costruttore sincrono (`djcJson` esplicito o fallback su `get.json`), factory asincrona `DjcManager.create()` (lettura da DynamoDB via chiave `jobcard:jobcarddetails:<jobCardId>`, fallback su `get.json` se `jobCardId` assente, errore esplicito se l'item in cache manca), tutti i metodi `Save*` (`SaveRoInfo`, `SaveDmsSync`, `SaveCustomer`, `SaveVehicle`, `SaveJobs`, `SaveConsents`, `SaveAppointments`): struttura `json_orig`/`json_mod`, campi sovrascritti vs. campi invariati, metodi non ancora implementati (`Error` esplicito)

#### pkEper / pkDocsoa / pkMenupricing / pkManager
- **WsIQPckEper / DocSOARestClient / MenuPricingSoapClient** – costruzione envelope/richiesta SOAP-REST, parsing risposta, gestione errori HTTP/SOAP, tutti i metodi pubblici del client
- **PkManager** – costruttore (config da env vars), `getConfigPackages` (mappa per ws, letta da `woc.config_packages` via `dbManager/ConfigPackagesRepository.js`), `getValidPackages` (intersezione config/WS live), `getValidPackagesDetail` (dettaglio parallelo, `isFixedPrice`/`packageType` per ws), `getPriceAndAvailability`, `getPkList` (normalizzazione via `_normalizePkDetail`, gestione elementi in errore), fallback docsoa forfait→tempario (`ibxDetailtpService`, uso di `rowData.ref` come `refTp`), `_fetchDetail`/`_fetchLiveMap` con mock dei tre client sibling

#### translations
- **index** – dispatch CLI/Lambda verso l'handler `translations`
- **S3TranslationsRepository** – fetch e parsing del JSON da S3, `TranslationNotFoundError` su `NoSuchKey`/404/Code, errori S3 generici rilanciati, JSON non valido, bucket non configurato
- **repositoryFactory** – costruzione dell'istanza di default e con override
- **handlers/translations** – merge `queryStringParameters`/`body`/`params` (params vince), default lingua, 200/404/502, header `Content-Type`

#### session
- **index (handler)** – legge `sub` da `event.requestContext.authorizer` (via `getAuthContext`), ignorando `username`/`codmarket` da `event.criteria`/`queryStringParameters`/`pathParameters`; 401 se `sub` assente, altrimenti usa sempre `MyPeopleDmsSessionRepository(sub)`; 200 con i dati di sessione, 404 su `SessionNotFoundError` (utente assente su myPeople), 502 su errori generici (es. myPeople/dms irraggiungibili), header `Content-Type`
- **index (getAuthContext)** – estrazione `sub`/`roles`/`profile` da `requestContext.authorizer` assente o vuoto, conversione `roles` CSV→array (incluso trim ed elementi vuoti), parsing JSON di `profile` (assente/non valido → `null`)
- **index (runCli)** – stampa dati su mercato di default/richiesto da argv o su `--username <value>`, log errore + `process.exitCode=1` in caso di fallimento (incluso `--username` senza valore)
- **errors** – `SessionNotFoundError` con `code=SESSION_NOT_FOUND`, messaggio con il mercato/utente richiesto e `label` opzionale (`"il mercato"` di default, `"l'utente"` per il flusso username)
- **sessionRepository** – la classe base lancia errore "non implementato"
- **s3SessionRepository** – fetch e parsing del JSON da S3, estrazione della sezione relativa al mercato (uppercase), `SessionNotFoundError` su mercato assente, gestione errori S3 (`NoSuchKey`/404/Code), JSON non valido, bucket non configurato
- **myPeopleDmsSessionRepository** – happy path con mappatura completa myPeople→cache DB→JSON di sessione (incluso `oics`/`applications`, gli interi blocchi `OICs`/`Applications` di myPeople con chiavi in minuscolo, e `companytypes`/`customertitles`, gli array `data` letti dalla cache `woc.dml_configurations`), `oics[].brandLogos` (risoluzione batch dei codici brand CSV tramite `woc.anag_brand`, posizionamento subito dopo `brands`, `[]` se `brands` assente/vuoto o se la query fallisce, nessuna query se non ci sono codici brand da risolvere), `oics[].brands` sovrascritto dall'elenco letto da `woc.ang_snowflakes` (`getBrandsByOics`, chiamata con l'elenco deduplicato dei `CODE` degli OIC), fallback al CSV originale di myPeople quando il DB non ha righe per l'OIC o la query fallisce, `oics[].address`/`oics[].zipcode`/`oics[].city` sovrascritti dall'indirizzo letto da `woc.addr_snowflakes` (`getAddressByOics`, chiamata con lo stesso elenco deduplicato dei `CODE` degli OIC), fallback ai valori di myPeople (`ADDRESS`/`ZIPCODE`/`CITY`, `null` se assenti) quando il DB non ha righe per l'OIC o la query fallisce, OIC con `enablewoc = 0` in `woc.hq_application_enabling` (`getDisabledOics`, chiamata con le coppie deduplicate `{market, oic}`) tolti dall'array `oics`, OIC senza riga di configurazione mantenuto (default abilitato/opt-out), errore di lettura di `getBrandsByOics`/`getDisabledOics`/`getAddressByOics` mai propagato (fallback rispettivamente al CSV di myPeople, a nessuna esclusione, e ai valori di myPeople), nessuna query batch se non ci sono OIC, `username` mancante, `RC`/`STATUS` di fallimento → `SessionNotFoundError`, `User` assente, fallback OIC (nessun `MAIN=Y`, nessun OIC), codice brand sconosciuto → `brandvehic_reftech: null`, cache-miss su `woc.dms_settings` → default (`isdml:false`/`null`/`null`) + registrazione (`await`) best-effort in `woc.dms_settings_enabled_dealers`, errore di lettura cache dms/settings o di registrazione dealer mai propagato (fallback ai default, mai un errore/502), nessuna interrogazione/registrazione dms/settings se manca `country`/`brand`/`dealer`, `companytypes`/`customertitles` a `[]` quando la cache `woc.dml_configurations` fallisce o non contiene un array `data`, fallback `dmlcustomerupdate`→`accountCustomerUpdate`, ricerca chiave `dmldiscount`, attributi tutti assenti (`|| null`), `oics: []`/`applications: []` quando myPeople non restituisce OIC/Applications, `applications` assente dal blocco `User`; test dedicato per il caricamento lazy (`require` dinamico) di `myPeople`/`dmlConfigSync`/`DmsSettingsRepository`/`DmlConfigRepository`/`dbManager` (incluso `woc.anag_brand`, `woc.ang_snowflakes`, `woc.hq_application_enabling`, `woc.addr_snowflakes`) quando non sono iniettate funzioni mock
- **repositoryFactory** – costruzione dell'istanza di default e con override, sia per `buildRepository` (S3) che per `buildMyPeopleDmsRepository` (myPeople/dms)

#### myPeople
- **httpClient** – parsing JSON/testo, concatenamento chunk, scrittura body, reject su errore di rete
- **certService** – `fetchSecret` (200 con `SecretString`, status non-200, JSON non valido, errore di rete sulla request, estrazione del PEM quando il secret è salvato come oggetto "JSON-like"), `extractPem` (PEM già valido, blocco PEM estratto da un wrapper con chiavi extra, nessun PEM trovato, input non-stringa), `getHttpsAgent` (fetch parallelo cert/key, cache tra invocazioni, reset cache e retry dopo un fallimento)
- **myPeopleService** – validazione parametro obbligatorio (`username`), costruzione options (host/porta/path/query string) con `identifier` costante da config, header `X-IBM-Client-Id` + `Authorization: Basic`, uso dell'agent mTLS, errori su risposta non-200
- **index** – risoluzione parametri da invocazione diretta/`queryStringParameters`/body JSON, 200/400/502, entrypoint CLI

#### isStellantisBrand
- **index (handler)** – validazione `ar_codbrand` (mancante/null/vuoto/whitespace, >2 caratteri, caratteri non alfabetici) → 400 con messaggio dedicato per ciascun caso; conversione a uppercase prima della query; 200 con `isStellantisBrand: true|false` in base al risultato della query; 500 su errore di connessione DB/Secrets Manager/query, senza esporre stack trace o dettagli interni nel body; formato risposta (`statusCode`/`headers`/`body` JSON) su tutti i path
- **shared/dbClient** – modalità remota (default): recupero ARN secret + endpoint RDS Proxy da SSM e credenziali da Secrets Manager, creazione del `pg.Pool` con `ssl: true`, errori su variabili d'ambiente mancanti (`DB_SECRET_ARN_PARAM`/`RDS_PROXY_ENDPOINT_PARAM`) o secret senza `SecretString`, cache del pool tra invocazioni (warm start, SSM/Secrets Manager interrogati una sola volta), `invalidatePool()` per forzare il refresh, gestione di `pool.connect()` fallito (invalida il pool, chiama `pool.end()`, propaga l'errore originale anche se `end()` fallisce a sua volta), invalidazione del pool tramite il listener `error` del pool, porta di default 5432; modalità locale (`DB_LOCAL_MODE=true`, case-insensitive): bypassa SSM/Secrets Manager, usa le credenziali/env locali di default con override via env (`DB_HOST`/`DB_NAME`/`DB_USER`/`DB_PASSWORD`/`DB_PORT`/`DB_SSL`)
- **property-based (fast-check)** – invarianti sulla validazione di `ar_codbrand` verificate su input generati casualmente: stringhe alfabetiche di 1-2 caratteri sempre accettate (200, query eseguita con il valore uppercase), qualunque stringa non vuota più lunga di 2 caratteri sempre rifiutata con il messaggio "massimo 2 caratteri", qualunque stringa di 1-2 caratteri con almeno un carattere non alfabetico sempre rifiutata con il messaggio "solo caratteri alfabetici", qualunque stringa vuota/whitespace sempre rifiutata con il messaggio "obbligatorio"

#### synch-status

- **index (handler)** – parsing del `body` (stringa JSON o oggetto), 400 su body non JSON valido; validazione payload (campi obbligatori `eventType`/`jobCardId`|`jobCardSrpId`/`timestamp`, `eventType` tra i 4 supportati, `timestamp` ISO 8601) con 400 e dettaglio errori; mappatura `eventType` → `djc_sync_status`; **UPDATE-only** su `woc.comunication_asyncro_djc` (mai INSERT) con incremento di `version`; 404 quando il record non esiste (deve essere creato prima da un'altra Lambda); 503 su errore di connessione Aurora, 504 su timeout query, 500 su errore generico; nessuna validazione del token (security demandata al gateway IBM APIC)
- **config** – pattern singleton `getInstance()`/`reset()`, struttura della configurazione (sezioni AWS/OAuth/APIC/Logging/Timeouts/API endpoints), risoluzione ambiente da env (`ENVIRONMENT`, default `dev`), `getByPath()` (path annidati, `null` se non trovato), gestione del log level
- **validator** – regole di validazione del payload e degli eventi (campi obbligatori, `eventType` supportati, `timestamp` ISO 8601, dimensioni min/max, raccolta di tutti gli errori)

#### dmlConfigSync
- **index (syncMarket)** – chiamata parallela a `getCompanyTypes`/`getCustomerTitles` con upsert degli array `data` (`[]` se il servizio risponde senza dati, es. 404 normalizzato)
- **index (syncDealer)** – chiamata a `getDmsSettings` con upsert della risposta completa (`{success, data}`) in `woc.dms_settings`
- **index (runSync)** – nessun mercato/dealer abilitato → `{success:true, results:[], dealerResults:[]}` senza chiamare `getBearerToken`; errore wrappato quando `getBearerToken` fallisce; sync di tutti i mercati/dealer abilitati in parallelo (bearer token condiviso, un'unica chiamata); isolamento dei fallimenti per singolo mercato/dealer (`Promise.allSettled`, un elemento fallito non blocca gli altri né l'upsert dei mercati/dealer riusciti)
- **index (handler/main CLI)** – delega a `runSync` e log del summary; comando CLI sconosciuto → `[ERROR]`+exit 1; comando `sync` con esito positivo/negativo (`exitCode` non impostato/`1`); caricamento lazy (`require` dinamico) di `dms/authService`/`dms/dmsService` quando le dipendenze non sono iniettate
- **db** – creazione/cache del pool `pg` (variabili d'ambiente dirette vs lettura da Secrets Manager), `connectionTimeoutMillis` configurato
- **DmlConfigRepository** – `listEnabledMarkets` (mercati attivi ordinati), `upsertDmlConfiguration` (validazione `country`/`language`, upsert con `ON CONFLICT`, default `[]` per array non validi), `getDmlConfiguration` (validazione parametri, riga trovata/assente, normalizzazione difensiva di colonne JSONB non-array)
- **DmsSettingsRepository** – `listEnabledDealers` (combinazioni attive ordinate), `upsertDmsSettings` (validazione `country`/`brand`/`dealer`, scomposizione della risposta in colonne separate `success`/`data`, default `success:false`/`data:[]` per risposte assenti/fallite), `getDmsSettings` (validazione parametri, ricostruzione di `{success, data}` da riga trovata, `null` se combinazione mai vista, normalizzazione difensiva di `data` non-array), `registerDealer` (`INSERT ... ON CONFLICT DO NOTHING`, nessuna query se `country`/`brand`/`dealer` mancante)

#### auroraAutoStart
- **index (handler)** – legge `AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER` e delega a `startClusterIfStopped`; errore se la variabile non è impostata; propagazione dell'errore in caso di fallimento del servizio
- **services/auroraClusterService (startClusterIfStopped)** – avvio (`rds:StartDBCluster`) solo quando lo stato corrente è `"stopped"`; nessuna azione (idempotente) per qualunque altro stato (`available`, `starting`, ...); errore se il cluster non viene trovato; dipendenze iniettabili (`rdsClient`) per i test, con copertura anche del ramo di default (istanziazione interna di `RDSClient`)

---

## Security Scan

Ad ogni **push e pull request**, il workflow GitHub Actions esegue automaticamente:

```bash
npm audit --audit-level=high
```

Il job fallisce se vengono rilevate vulnerabilità di livello **high** o **critical** nelle dipendenze.  
I risultati sono visibili nel log dello step "Security scan" nella tab **Actions** del repository.

---

## Report di copertura

Il report HTML completo viene generato automaticamente e pubblicato come **artefatto scaricabile** su GitHub Actions.

### Come accedere al report

1. Vai sul repository GitHub → tab **Actions**
2. Clicca sul workflow run più recente
3. In fondo alla pagina, sezione **Artifacts**
4. Scarica l'artefatto del modulo desiderato (es. `coverage-agendaSoa`)
5. Estrai lo zip e apri `lcov-report/index.html` nel browser

Gli artefatti sono disponibili per **30 giorni** da ogni esecuzione.

### Generare il report in locale

```bash
cd agendaSoa
npm run test:coverage
# Apri coverage/lcov-report/index.html nel browser
```

Il comando genera nella cartella `coverage/`:
- `lcov-report/index.html` — report HTML navigabile per file e riga
- `cobertura-coverage.xml` — formato XML per integrazione CI
- `coverage-summary.json` — riepilogo JSON con le percentuali per modulo

