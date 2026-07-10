# project-am-stellantis-woc-backend

> 🇮🇹 Italiano &nbsp;|&nbsp; 🇬🇧 [Read in English](README.en.md)

Stellantis – WOC BackEnd: raccolta di Lambda Node.js per l'integrazione con i servizi Stellantis (AgendaSOA, NAGA, DMS, JobCard, V360, pkEper, pkDocsoa, pkMenupricing, pkManager, translations).

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
└── translations/       # Lambda – Recupero traduzioni da S3

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
| **Totale** | **30** | **338** | |

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

