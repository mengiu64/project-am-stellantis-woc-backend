# project-am-stellantis-woc-backend

> 🇮🇹 Italiano &nbsp;|&nbsp; 🇬🇧 [Read in English](README.en.md)

Stellantis – WOC BackEnd: raccolta di Lambda Node.js per l'integrazione con i servizi Stellantis (AgendaSOA, NAGA, DMS, JobCard, V360, pkEper, pkDocsoa, pkMenupricing, pkManager, translations, session, myPeople).

![Unit Tests](https://github.com/stla-wrt00/project-am-stellantis-woc-backend/actions/workflows/unit-tests.yml/badge.svg)

---

## Indice

1. [Struttura del progetto](#struttura-del-progetto)
2. [Moduli](#moduli)
   - [agendaSoa](#agendasoa)
   - [agendaSoaNaga](#agendasoaNaga)
   - [dms](#dms)
   - [jobcard](#jobcard)
   - [v360](#v360)
   - [pkEper](#pkeper)
   - [pkDocsoa](#pkdocsoa)
   - [pkMenupricing](#pkmenupricing)
   - [pkManager](#pkmanager)
   - [translations](#translations)
   - [session](#session)
   - [myPeople](#mypeople)
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
├── jobcard/            # Lambda – JobCard list/details (Stellantis DGT API)
├── v360/               # Lambda – OTA Compatibility & Vehicle Details (ASV360 API)
├── pkEper/             # Lambda – Pacchetti ePer (Stellantis FCA/Fiat SOAP)
├── pkDocsoa/           # Lambda – Pacchetti DocSOA (Stellantis PSA REST)
├── pkMenupricing/      # Lambda – Pacchetti MenuPricing (Opel/Vauxhall SOAP)
├── pkManager/          # Lambda – Orchestratore multi-WS pacchetti (ePer/DocSOA/MenuPricing)
├── translations/       # Lambda – Recupero traduzioni da S3
├── session/            # Lambda – Dati di sessione (codmarket, oic, sincom, ...)
└── myPeople/           # Lambda – Profili utente PSA IURSMA (mTLS + Basic Auth)

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
| `inquiry` | `postDmsInquiry(token, body)` | Invia una richiesta DML inquiry (LFP / WL / MP) |

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) |
| `dmsService` | `getDmsSettings(token, params)` | GET `/dms/settings?country=&brand=&dealer=` |
| `dmsService` | `postDmsInquiry(token, body)` | POST `/inquiry/DML/1.0/inquiry` – tipi: `LFP` \| `WL` \| `MP` |
| `dmsService` | `buildTypeSection(type)` | Helper: genera la sezione payload specifica per tipo (LFP/WL/MP) |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Parametri `postDmsInquiry`

| Campo | Obbligatorio | Descrizione |
|---|---|---|
| `PartsInquiryHeader.MessageType` | ✅ | Tipo richiesta: `LFP` \| `WL` \| `MP` |
| `PartsInquiryHeader.DocumentID` | ✅ | Numero Repair Order univoco |
| `PartsInquiryHeader.CustomerIdDms` | ✅ | ID cliente nel DMS |
| `PartsInquiryHeader.VehicleID` | ✅ | VIN del veicolo |
| `ApplicationArea` | ✅ | Mittente, timestamp e BODID (UUID) |
| `UpSelling.Packages` | ❌ | Usato per `LFP` |
| `WorkLines` | ❌ | Usato per `WL` |
| `SpareParts.PartsItem` | ❌ | Usato per `MP` |

#### Utilizzo CLI

```bash
# Impostazioni DMS
node index.js settings <country> <brand> <dealer>
# es: node index.js settings fr FT 0062230

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
| `jobCardService` | `getJobCardDetails(token, jobCardId)` | Dettaglio di una singola JobCard |
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

#### Utilizzo CLI

```bash
node index.js list    <dealerId> [key=value ...]
node index.js details <jobCardId>
# es: node index.js list 0062219 vin=VIN123 page=2
# es: node index.js details 79
```

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
| `offering` | ❌ | Es. `"Vehicle Description,campaign"` |
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

Lambda per i **pacchetti DocSOA** (Stellantis PSA), client REST che replica il servizio SOAP originario.

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

Lambda orchestratore che gestisce la **configurazione e la validazione dei pacchetti** su più web service (ePer, DocSOA, MenuPricing), determinando quali pacchetti configurati sono effettivamente disponibili per un VIN e recuperandone il dettaglio. Richiede il codice sorgente dei tre moduli fratelli (`pkEper`, `pkDocsoa`, `pkMenupricing`) tramite path relativi: in AWS viene per questo buildato con un `Makefile` custom (`Metadata: BuildMethod: makefile` in `template.yaml`) che ricrea la stessa struttura di cartelle sibling dentro il pacchetto Lambda.

#### Handlers disponibili

| `event.action` | Metodo manager | Descrizione |
|---|---|---|
| `getConfigPackages` | `manager.getConfigPackages(market, pkwstouse)` | Configurazione statica pacchetti per il ws indicato |
| `getValidPackages` | `manager.getValidPackages(market, pkwstouse, VIN)` | Intersezione tra config e pacchetti live dal WS |
| `getValidPackagesDetail` | `manager.getValidPackagesDetail(market, pkwstouse, VIN)` | `getValidPackages` + dettaglio di ogni pacchetto in parallelo |

`pkwstouse` accetta i valori: `eper`, `docsoa`, `menupricing`.

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

Lambda che restituisce i **dati di sessione** (`codmarket`, `oic`, `sincom`, `physicalsite`, `pdvId`, preferenze pezzi, sconti massimi, ecc.) per l'utente autenticato.

L'Handler HTTP (dietro API Gateway, proxy REST) **non si fida di alcun parametro fornito dal client** (query/path/body): l'identità arriva sempre dal Lambda Authorizer (`lmb-np-bsn0027990-<env>-authorizer`), valorizzata in `event.requestContext.authorizer`:

- `sub` — id utente stabile (username IURSMA, es. `"0073741.d235"`) — è l'**unico** valore usato come `username` per il flusso `myPeople -> dms/settings`. Se assente, la Lambda risponde `401` senza interrogare alcun repository (nessun fallback su parametri client-controllati, per evitare che un chiamante possa richiedere la sessione di un altro utente passando uno `username`/`codmarket` arbitrario).
- `roles` — stringa CSV (es. `"dealer,advisor"`), esposta come array da `getAuthContext(event)`; l'autorizzazione applicativa (chi può fare cosa) resta a carico di chi consuma questi dati.
- `profile` — JSON string col profilo canonico (stessa forma di `GET /auth/user-info`: `sub`, `given_name`, `family_name`, `name`, `email`, `locale`, `country`, `roles[]`, `dealer_code`, `dealer_name`, `brand`, `region_code`, ...), parsato da `getAuthContext(event)` se presente (`null` se assente o JSON non valido). Non usato oggi per calcolare la sessione (si usa sempre `myPeople` via `sub`), disponibile per usi futuri.

Con `sub` disponibile, la Lambda chiama in sequenza `myPeople` (`readUserProfiles`, per recuperare mercato/OIC/dealer/lingua/tipo utente) e poi `dms/settings` (con i parametri `country`/`brand`/`dealer` derivati dalla risposta myPeople), componendo un JSON con **la stessa forma storica** della risposta S3 — vedi `MyPeopleDmsSessionRepository`. I campi non derivabili da myPeople/dms (es. `physicalsite`, `pdvId`, `inmandate`, `vat`, `pkwstouse`, `interiorcarwash`/`exteriorcarwash`, `partpref_*`, `pcydealer1-3`, `pcystellantis1-3`, `maxdiscountperc`, `maxdiscountval` — dati che nel flusso storico arrivano da una tabella dedicata, non da myPeople/dms) sono valorizzati a `null`. Se l'utente non risulta su myPeople (`RC`/`STATUS` non di successo), la Lambda risponde `404`.

> **CLI (uso interno/debug, non esposto via API Gateway):** `node session/src/index.js [codmarket]` (flusso storico S3, default mercato `"1000"`) oppure `node session/src/index.js --username <username>` (flusso myPeople/dms) — invocazioni dirette da riga di comando, prive di contesto authorizer, mantenute solo per test/debug locale; **non** riflettono il comportamento dell'handler HTTP.

L'accesso ai dati è isolato dietro un'interfaccia `SessionRepository`, implementata da `S3SessionRepository` (flusso `codmarket`, usato solo dalla CLI) e da `MyPeopleDmsSessionRepository` (flusso `username`, usato dall'handler HTTP tramite `sub` e dalla CLI tramite `--username`), per permettere di aggiungere/sostituire sorgenti dati senza impattare l'handler HTTP (stessa architettura del modulo `translations`).

> **Nota tecnica:** per poter richiamare in-process il codice di `myPeople` e `dms` (senza invocazioni Lambda-to-Lambda separate), `SessionFunction` in `template.yaml` usa `CodeUri: ./` (root del repo) + `Metadata: BuildMethod: makefile`, con un target dedicato in `Makefile` che copia `session/`, `myPeople/` e `dms/` nel pacchetto di build (stesso pattern già usato da `pkManager` per `pkEper`/`pkDocsoa`/`pkMenupricing`/`dms`).

#### Mappatura myPeople/dms → campi di sessione

| Campo output | Origine |
|---|---|
| `codmarket` | `Response.User.Attributes.MARKETCODE` |
| `oic` | `CODE` dell'OIC con `MAIN: "Y"` (fallback: primo OIC disponibile) |
| `sincom` | `Attributes.MAINSINCOM` |
| `sessionbrand` / `brandvehic_fca` | primo codice del campo `BRANDS` (CSV) dell'OIC selezionato |
| `brandvehic_reftech` | codice brand transcodificato (tabella interna 83→AR, 00→FT, 70→LA, 57→JE, 55→CY, 77→FO, 66→AH, 56→DG, 58→RM, 30→AC, 31→AP, 33→DS, 43→OV, 97→CT); è anche il valore usato come `brand` nella chiamata a `dms/settings` |
| `brandvehic_genome` | sempre `null` (nessuna tabella di mappatura disponibile) |
| `language` | `` `${iso2}_${ISO2}` `` da `Attributes.NATIONiso2` (es. `it_IT`) |
| `usertype` | `Attributes.USERTYPE` |
| `isdml` | `true` se `dms/settings` risponde `success: true` |
| `dmlcustomerupdate` | valore della chiave `knownCustomerUpdate` (fallback `accountCustomerUpdate`) in `dms/settings`, altrimenti `null` |
| `dmldiscount` | valore della prima chiave di `dms/settings` contenente `discount`, altrimenti `null` |
| `oics` | intero array `Response.User.OICs` di myPeople, riportato **as-is** ma con tutte le chiavi di ogni oggetto in minuscolo (es. `MARKET`→`market`, `CODE`→`code`, `BRANDS`→`brands`, ...) |
| tutti gli altri campi | `null` (non derivabili da myPeople/dms) |

#### Funzioni principali

| Funzione | Descrizione |
|---|---|
| `handler(event)` | Entry-point Lambda HTTP: legge `sub` da `event.requestContext.authorizer` (via `getAuthContext`) e usa **sempre** `MyPeopleDmsSessionRepository` con `sub` come username; ignora qualunque `username`/`codmarket` fornito da query/path/criteria. Ritorna 401 se `sub` è assente, 200 con i dati, 404 se l'utente non è presente su myPeople, 502 su errori generici |
| `getAuthContext(event)` | Estrae `{ sub, roles, profile }` da `event.requestContext.authorizer`: `roles` (CSV) convertito in array, `profile` (JSON string) parsato in oggetto (`null` se assente/non valido) |
| `getSessionData(codmarket)` | `S3SessionRepository`: scarica `session/session_data.json` da S3 ed estrae la sezione relativa al mercato richiesto (usato solo dalla CLI) |
| `getSessionData(username)` | `MyPeopleDmsSessionRepository`: chiama `myPeople.readUserProfiles` + `dms.getDmsSettings` e compone il JSON di sessione |
| `buildRepository(overrides)` | Factory che costruisce `S3SessionRepository` (bucket/key/client configurabili via env o overrides, utile nei test e nella CLI) |
| `buildMyPeopleDmsRepository(overrides)` | Factory che costruisce `MyPeopleDmsSessionRepository` (funzioni myPeople/dms iniettabili via overrides, utile nei test) |

#### Struttura

```
session/
├── src/
│   ├── index.js                             # Lambda entry-point + CLI
│   ├── errors.js                             # SessionNotFoundError (404)
│   ├── repositoryFactory.js                  # Factory: buildRepository(), buildMyPeopleDmsRepository()
│   └── repositories/
│       ├── sessionRepository.js              # Interfaccia base
│       ├── s3SessionRepository.js            # Implementazione S3 (bucket + key JSON) — flusso codmarket
│       └── myPeopleDmsSessionRepository.js    # Implementazione myPeople + dms/settings — flusso username
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

## Installazione

Ogni modulo è indipendente. Installare le dipendenze separatamente:

```bash
cd agendaSoa      && npm install
cd agendaSoaNaga  && npm install
cd dms            && npm install
cd jobcard        && npm install
cd v360           && npm install
cd pkEper         && npm install
cd pkDocsoa       && npm install
cd pkMenupricing  && npm install
cd pkManager      && npm install
cd translations   && npm install
cd session        && npm install
cd myPeople       && npm install
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
```

### jobcard

```env
JOBCARD_PING_CLIENT_ID=...          # Client ID PingFederate (dedicato jobcard)
JOBCARD_PING_CLIENT_SECRET=...      # Client Secret PingFederate (dedicato jobcard)
DGT_CLIENT_ID=...                  # X-IBM-Client-Id per le API DGT
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API DGT
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
DOCSOA_HOST=https://api.inetpsa.com   # URL base servizio DocSOA
DOCSOA_USERNAME=...                    # Username autenticazione
DOCSOA_PASSWORD=...                    # Password autenticazione
DOCSOA_CLIENT_ID=...                   # Client ID applicazione
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

> **Nota:** `authService` implementa un meccanismo di cache su file (`.token.cache.json`) per evitare di richiedere un nuovo token ad ogni invocazione. Il token viene rinnovato automaticamente 30 secondi prima della scadenza.

### session

```env
SESSION_BUCKET_NAME=...              # Nome del bucket S3 con i dati di sessione (obbligatoria per il flusso codmarket)
SESSION_DATA_KEY=session/session_data.json  # (opzionale) key S3 del file JSON dati di sessione
SESSION_DEFAULT_MARKET=1000          # (opzionale) mercato di default quando "codmarket" non è passato
```

> **Nota:** i dati di sessione sono letti da un unico file JSON su S3 (`session/session_data.json`, stesso bucket di `translations`), indicizzato per codice mercato a 4 caratteri. Se il mercato richiesto non è presente nel file la Lambda risponde `404`.

> **Nota (flusso `username`):** quando viene passato `username` invece di `codmarket`, la Lambda richiama in-process il codice di `myPeople` e `dms`, quindi richiede anche **tutte** le variabili d'ambiente elencate nelle sezioni `dms` e `myPeople` qui sotto (`DMS_PING_CLIENT_ID`, `DMS_PING_CLIENT_SECRET`, `DML_IBM_CLIENT_ID`, `DML_IBM_CLIENT_SECRET`, `DML_X_TARGET_ENV`, `MYPEOPLE_*`).

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
| **jobcard** | 3 | 28 | `httpClient`, `authService`, `jobCardService` |
| **v360** | 3 | 29 | `httpClient`, `authService`, `v360Service` |
| **pkEper** | 1 | 19 | `WsIQPckEper` |
| **pkDocsoa** | 1 | 19 | `DocSOARestClient` |
| **pkMenupricing** | 1 | 14 | `MenuPricingSoapClient` |
| **pkManager** | 1 | 27 | `PkManager` |
| **translations** | 5 | 42 | `index`, `errors`, `repositoryFactory`, `handlers/translations`, `repositories/S3TranslationsRepository` |
| **session** | 7 | 60 | `index` (handler + CLI), `errors`, `repositoryFactory`, `repositories/sessionRepository`, `repositories/s3SessionRepository`, `repositories/myPeopleDmsSessionRepository` (+ lazy-load) |
| **myPeople** | 4 | 39 | `httpClient`, `certService`, `myPeopleService`, `index` (handler + CLI) |
| **Totale** | **41** | **437** | |

### Copertura del codice

| Modulo | Statements | Branches | Functions | Lines |
|---|:---:|:---:|:---:|:---:|
| **agendaSoa** | 100% ✅ | 96.96% ✅ | 100% ✅ | 100% ✅ |
| **agendaSoaNaga** | 100% ✅ | 92.68% ✅ | 100% ✅ | 100% ✅ |
| **dms** | 100% ✅ | 96.55% ✅ | 100% ✅ | 100% ✅ |
| **jobcard** | 100% ✅ | 96.66% ✅ | 100% ✅ | 100% ✅ |
| **v360** | 100% ✅ | 93.18% ✅ | 100% ✅ | 100% ✅ |
| **pkEper** | 98.66% ✅ | 91.11% ✅ | 100% ✅ | 98.64% ✅ |
| **pkDocsoa** | 98.46% ✅ | 92.40% ✅ | 100% ✅ | 100% ✅ |
| **pkMenupricing** | 100% ✅ | 98.52% ✅ | 100% ✅ | 100% ✅ |
| **pkManager** | 99.01% ✅ | 90.47% ✅ | 100% ✅ | 100% ✅ |
| **translations** | 98.94% ✅ | 94.64% ✅ | 100% ✅ | 98.9% ✅ |
| **session** | 98.69% ✅ | 93.84% ✅ | 100% ✅ | 99.32% ✅ |
| **myPeople** | 99% ✅ | 94.59% ✅ | 100% ✅ | 100% ✅ |

> Soglia minima enforced: **90%** su tutti i criteri. La CI fallisce automaticamente se non raggiunta.

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
- **dmsService** – validazione parametri obbligatori `getDmsSettings` (country/brand/dealer), `postDmsInquiry` (MessageType/DocumentID/CustomerIdDms/VehicleID), tipi inquiry (LFP/WL/MP), `buildTypeSection`, headers corretti (Authorization, IBM credentials), errori HTTP
- **jobCardService / v360Service** – validazione parametri obbligatori, tutti i filtri opzionali (date range, paginazione, ordinamento), headers corretti (Authorization, IBM credentials, x-trace-id), errori HTTP

#### pkEper / pkDocsoa / pkMenupricing / pkManager
- **WsIQPckEper / DocSOARestClient / MenuPricingSoapClient** – costruzione envelope/richiesta SOAP-REST, parsing risposta, gestione errori HTTP/SOAP, tutti i metodi pubblici del client
- **PkManager** – costruttore (config da env vars), `getConfigPackages` (mappa statica per ws), `getValidPackages` (intersezione config/WS live), `getValidPackagesDetail` (dettaglio parallelo), `_fetchDetail`/`_fetchLiveMap` con mock dei tre client sibling

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
- **myPeopleDmsSessionRepository** – happy path con mappatura completa myPeople→dms→JSON di sessione (incluso `oics`, l'intero blocco `OICs` di myPeople con chiavi in minuscolo), `username` mancante, `RC`/`STATUS` di fallimento → `SessionNotFoundError`, `User` assente, fallback OIC (nessun `MAIN=Y`, nessun OIC), codice brand sconosciuto → `brandvehic_reftech: null`, fallimento `dms/settings` (errore wrappato), fallback `dmlcustomerupdate`→`accountCustomerUpdate`, ricerca chiave `dmldiscount`, `isdml: false`, attributi tutti assenti (`|| null`), `oics: []` quando myPeople non restituisce OIC; test dedicato per il caricamento lazy (`require` dinamico) di `myPeople`/`dms` quando non sono iniettate funzioni mock
- **repositoryFactory** – costruzione dell'istanza di default e con override, sia per `buildRepository` (S3) che per `buildMyPeopleDmsRepository` (myPeople/dms)

#### myPeople
- **httpClient** – parsing JSON/testo, concatenamento chunk, scrittura body, reject su errore di rete
- **certService** – `fetchSecret` (200 con `SecretString`, status non-200, JSON non valido, errore di rete sulla request, estrazione del PEM quando il secret è salvato come oggetto "JSON-like"), `extractPem` (PEM già valido, blocco PEM estratto da un wrapper con chiavi extra, nessun PEM trovato, input non-stringa), `getHttpsAgent` (fetch parallelo cert/key, cache tra invocazioni, reset cache e retry dopo un fallimento)
- **myPeopleService** – validazione parametro obbligatorio (`username`), costruzione options (host/porta/path/query string) con `identifier` costante da config, header `X-IBM-Client-Id` + `Authorization: Basic`, uso dell'agent mTLS, errori su risposta non-200
- **index** – risoluzione parametri da invocazione diretta/`queryStringParameters`/body JSON, 200/400/502, entrypoint CLI

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

