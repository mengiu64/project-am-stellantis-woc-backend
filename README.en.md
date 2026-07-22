# project-am-stellantis-woc-backend

> 🇮🇹 [Leggi in italiano](README.md) &nbsp;|&nbsp; 🇬🇧 English

Stellantis – WOC BackEnd: collection of Node.js Lambdas for integration with Stellantis services (AgendaSOA, NAGA, DMS, JobCard, V360, pkEper, pkDocsoa, pkMenupricing, pkManager, translations, session).

![Unit Tests](https://github.com/stla-wrt00/project-am-stellantis-woc-backend/actions/workflows/unit-tests.yml/badge.svg)

---

## Table of Contents

1. [Project structure](#project-structure)
2. [Modules](#modules)
   - [agendaSoa](#agendasoa)
   - [agendaSoaNaga](#agendasoanaga)
   - [dms](#dms)
   - [jobcard](#jobcard)
   - [v360](#v360)
   - [pkEper](#pkeper)
   - [pkDocsoa](#pkdocsoa)
   - [pkMenupricing](#pkmenupricing)
   - [pkManager](#pkmanager)
   - [translations](#translations)
   - [session](#session)
3. [Installation](#installation)
4. [Environment variables](#environment-variables)
5. [Unit Test & Coverage](#unit-test--coverage)
6. [Security Scan](#security-scan)
7. [Coverage report](#coverage-report)

---

## Project structure

```
project-am-stellantis-woc-backend/
├── agendaSoa/          # Lambda – appointment scheduling (AgendaSOA REST)
├── agendaSoaNaga/      # Lambda – NAGA appointment creation/update
├── dms/                # Lambda – DMS Settings (Stellantis DML API)
├── jobcard/            # Lambda – JobCard list/details (Stellantis DGT API)
├── v360/               # Lambda – OTA Compatibility & Vehicle Details (ASV360 API)
├── pkEper/             # Lambda – ePer packages (Stellantis FCA/Fiat SOAP)
├── pkDocsoa/           # Lambda – DocSOA packages (Stellantis PSA REST)
├── pkMenupricing/      # Lambda – MenuPricing packages (Opel/Vauxhall SOAP)
├── pkManager/          # Lambda – multi-WS package orchestrator (ePer/DocSOA/MenuPricing)
├── translations/       # Lambda – translation retrieval from S3
└── session/            # Lambda – session data (codmarket, oic, sincom, ...)

```

---

## Modules

### agendaSoa

Central routing Lambda for appointment management via the **AgendaSOA REST** service.

#### Available handlers

| `event.action` | Client method | Description |
|---|---|---|
| `appointment` | `client.appointment(params)` | Retrieves receptionist planning data |
| `availableHours` | `client.availableHours(params)` | Returns available time slots for a PDV |
| `cCSList` | `client.cCSList(params)` | List of CCS (Customer Service Advisors) for a PDV |
| `data` | `client.data(params)` | Details of an RDV appointment by ID |

#### Structure

```
agendaSoa/
├── index.js                    # Lambda entry-point (dispatcher)
├── src/
│   ├── agendaSOAClient.js      # AgendaSOA REST client (axios)
│   ├── clientFactory.js        # Factory: creates the client from env vars
│   └── handlers/
│       ├── appointment.js
│       ├── availableHours.js
│       ├── cCSList.js
│       └── data.js
└── __tests__/                  # Jest unit tests
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

Routing Lambda for **NAGA appointment creation and update**.

#### Available handlers

| `event.action` | Client method | Description |
|---|---|---|
| `createnaga` | `client.createnaga(body)` | Creates a new NAGA appointment |
| `updatenaga` | `client.updatenaga(body, apptId)` | Updates an existing appointment |

#### Structure

```
agendaSoaNaga/
├── index.js                    # Lambda entry-point (dispatcher)
├── src/
│   ├── agendaNagaClient.js     # NAGA REST client (axios)
│   ├── clientFactory.js        # Factory: creates the client from env vars
│   └── handlers/
│       ├── createnaga.js
│       └── updatenaga.js
└── __tests__/                  # Jest unit tests
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

Lambda for **DMS settings** and **inquiry requests** (parts/upgrades/work lines) via the Stellantis DML API, with PingFederate authentication (bearer token).

#### Available actions

| `event.action` | Service function | Description |
|---|---|---|
| `settings` | `getDmsSettings(token, params)` | Retrieves dealer DMS configuration |
| `inquiry` | `postDmsInquiry(token, body)` | Submits a DML inquiry request (LFP / WL / MP) |

#### Main functions

| Module | Function | Description |
|---|---|---|
| `authService` | `getBearerToken()` | Gets/renews the PingFederate bearer token (file cache) |
| `dmsService` | `getDmsSettings(token, params)` | GET `/dms/settings?country=&brand=&dealer=` |
| `dmsService` | `postDmsInquiry(token, body)` | POST `/inquiry/DML/1.0/inquiry` – types: `LFP` \| `WL` \| `MP` |
| `dmsService` | `buildTypeSection(type)` | Helper: generates the type-specific payload section (LFP/WL/MP) |
| `httpClient` | `httpsRequest(options, body)` | Native Node.js HTTPS client |

#### `postDmsInquiry` parameters

| Field | Required | Description |
|---|---|---|
| `PartsInquiryHeader.MessageType` | ✅ | Request type: `LFP` \| `WL` \| `MP` |
| `PartsInquiryHeader.DocumentID` | ✅ | Unique Repair Order number |
| `PartsInquiryHeader.CustomerIdDms` | ✅ | Customer ID in DMS |
| `PartsInquiryHeader.VehicleID` | ✅ | Vehicle VIN |
| `ApplicationArea` | ✅ | Sender, timestamp and BODID (UUID) |
| `UpSelling.Packages` | ❌ | Used for `LFP` |
| `WorkLines` | ❌ | Used for `WL` |
| `SpareParts.PartsItem` | ❌ | Used for `MP` |

#### CLI usage

```bash
# DMS settings
node index.js settings <country> <brand> <dealer>
# e.g.: node index.js settings fr FT 0062230

# Inquiry — positional arguments
node index.js inquiry <type> <documentId> <customerId> <vehicleId>
# e.g.: node index.js inquiry LFP 84564621 854265 3C4NJCBH7KT831816

# Inquiry — from full JSON file
node index.js inquiry --file ./LFP_1_Request.json
```

---

### jobcard

Lambda for **JobCard** management via the Stellantis DGT (Digital Layer) API, with PingFederate authentication.

#### Main functions

| Module | Function | Description |
|---|---|---|
| `authService` | `getBearerToken()` | Gets/renews the PingFederate bearer token (file cache) |
| `jobCardService` | `getJobCardList(token, params)` | JobCard list with filters and pagination |
| `jobCardService` | `getJobCardDetails(token, jobCardId)` | Details of a single JobCard |
| `httpClient` | `httpsRequest(options, body)` | Native Node.js HTTPS client |

#### `getJobCardList` parameters

| Parameter | Required | Description |
|---|---|---|
| `dealerId` | ✅ | Dealer ID |
| `vin` | ❌ | VIN number |
| `creationStartDate` / `creationEndDate` | ❌ | Creation date range (ISO 8601) |
| `deliveryStartDate` / `deliveryEndDate` | ❌ | Delivery date range (ISO 8601) |
| `receptionStartDate` / `receptionEndDate` | ❌ | Reception date range (ISO 8601) |
| `licensePlate` | ❌ | License plate |
| `dmsRepairOrderId` | ❌ | DMS repair order ID |
| `customerName` | ❌ | Customer name |
| `page` | ❌ | Page number (default: 1) |
| `pageSize` | ❌ | Items per page – 10/25/50/100 (default: 25) |
| `sortBy` | ❌ | Sort field |
| `sortOrder` | ❌ | `asc` / `desc` |

#### CLI usage

```bash
node index.js list    <dealerId> [key=value ...]
node index.js details <jobCardId>
# e.g.: node index.js list 0062219 vin=VIN123 page=2
# e.g.: node index.js details 79
```

---

### v360

Lambda for **ASV360** APIs (Vehicle 360): OTA compatibility and vehicle details, with PingFederate authentication.

#### Main functions

| Module | Function | Description |
|---|---|---|
| `authService` | `getBearerToken()` | Gets/renews the PingFederate bearer token (file cache) |
| `v360Service` | `otaCompatibility(token, params)` | POST `/otaCompatibility` – OTA update compatibility |
| `v360Service` | `getDetails(token, params)` | POST `/getdetails` – vehicle details |
| `httpClient` | `httpsRequest(options, body)` | Native Node.js HTTPS client |

#### `otaCompatibility` parameters

| Parameter | Required | Description |
|---|---|---|
| `vin` | ✅ | Vehicle VIN |
| `includeOtaHistoryData` | ❌ | `"true"` / `"false"` (default `"true"`) |
| `locale` | ❌ | E.g. `"fr_FR"` (default `"en_EN"`) |

#### `getDetails` parameters

| Parameter | Required | Description |
|---|---|---|
| `vin` | ✅ | Vehicle VIN |
| `searchType` | ❌ | Default `"vin"` |
| `countryCode` | ❌ | E.g. `"FR"` |
| `clientId` | ❌ | Client identifier |
| `offering` | ❌ | E.g. `"Vehicle Description,campaign"` |
| `languageCode` | ❌ | E.g. `"fr"` |

#### CLI usage

```bash
node index.js otaCompatibility <vin> [key=value ...]
node index.js getdetails       <vin> [key=value ...]
# e.g.: node index.js otaCompatibility VR7EMZKU7RJ963237 locale=fr_FR
# e.g.: node index.js getdetails VF3VEAHHWFZ062040 countryCode=FR languageCode=fr
```

---

### pkEper

Lambda for **ePer packages** (Stellantis FCA/Fiat), a SOAP client replicating the original `WsIQPckEper` PHP service.

#### Available handlers

| `event.action` | Client method | Description |
|---|---|---|
| `getGroupsPRRequest` | `client.getGroupsPRRequest(body)` | List package groups for a VIN |
| `getSubgroupsPR` | `client.getSubgroupsPR(body)` | List subgroups of a group |
| `getPackagesPR` | `client.getPackagesPR(body)` | List packages of a subgroup |
| `getPackageDetailsPR` | `client.getPackageDetailsPR(body)` | Package detail |

#### Structure

```
pkEper/
├── index.js               # Lambda entry-point + demo CLI
├── WsIQPckEper.js          # SOAP client (equivalent of WsIQPckEper.class.php)
├── test.js                 # Manual smoke-test
└── __tests__/              # Jest unit tests
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

Lambda for **DocSOA packages** (Stellantis PSA), a REST client replicating the original SOAP service. The `api-cert-preprod.groupe-psa.com/api/cert-aai` gateway requires, in addition to Basic Auth/WS-Security and the `X-IBM-Client-Id`/`X-IBM-Client-Secret` headers, a **client mTLS certificate**: the certificate and key (Secrets Manager secrets `apicCert`/`apicKey`, the **same** ones used by `myPeople`) are retrieved at runtime via the [AWS Parameters and Secrets Lambda Extension](https://docs.aws.amazon.com/secretsmanager/latest/userguide/retrieving-secrets_lambda.html) (see `certService.js`, same pattern as `myPeople/certService.js`).

#### Available handlers

| `event.action` | Client method | Description |
|---|---|---|
| `functionsService` | `client.functionsService(params)` | List available functions for a VIN |
| `forfaitService` | `client.forfaitService(params)` | List forfaits (packages) |
| `ibxDetailForfaitService` | `client.ibxDetailForfaitService(params)` | Forfait detail |
| `ibxParametrageService` | `client.ibxParametrageService(params)` | IBX parametrization |
| `ibxDetailtpService` | `client.ibxDetailtpService(params)` | Time schedule (tp) detail |

#### Structure

```
pkDocsoa/
├── index.js               # Lambda entry-point + demo CLI
├── DocSOARestClient.js     # DocSOA REST client (axios) + vinParts helper
├── certService.js          # mTLS: retrieves cert/key from Secrets Manager (apicCert/apicKey) + cached https.Agent
├── test.js                 # Manual smoke-test
└── __tests__/              # Jest unit tests
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

Lambda for **MenuPricing packages** (Opel/Vauxhall), a SOAP client with WS-Security authentication.

#### Available handlers

| `event.action` | Client method | Description |
|---|---|---|
| `getJobs` | `client.getJobs(body)` | List available jobs/packages for a VIN |
| `getJobDetails` | `client.getJobDetails(body)` | Job/package detail |

#### Structure

```
pkMenupricing/
├── index.js                    # Lambda entry-point + demo CLI
├── MenuPricingSoapClient.js     # MenuPricing SOAP client
├── test.js                      # Manual smoke-test
└── __tests__/                   # Jest unit tests
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

Orchestrator Lambda that manages **package configuration and validation** across multiple web services (ePer, DocSOA, MenuPricing), determining which configured packages are actually available for a VIN and fetching their details. It requires the source code of the three sibling modules (`pkEper`, `pkDocsoa`, `pkMenupricing`) via relative paths: in AWS it is therefore built with a custom `Makefile` (`Metadata: BuildMethod: makefile` in `template.yaml`) that recreates the same sibling folder structure inside the Lambda package.

#### Available handlers

| `event.action` | Manager method | Description |
|---|---|---|
| `getConfigPackages` | `manager.getConfigPackages(market, pkwstouse)` | Static package configuration for the given ws |
| `getValidPackages` | `manager.getValidPackages(market, pkwstouse, VIN)` | Intersection between config and live packages from the WS |
| `getValidPackagesDetail` | `manager.getValidPackagesDetail(market, pkwstouse, VIN)` | `getValidPackages` + detail of each package in parallel |

`pkwstouse` accepts the values: `eper`, `docsoa`, `menupricing`.

> ⚠️ **Note**: `getValidPackages`/`getValidPackagesDetail` internally call methods (`getCompletePkEperList`, `getCompletePkMpList`, `getCompletePkSOAList`) not yet implemented on the `WsIQPckEper`/`MenuPricingSoapClient`/`DocSOARestClient` clients. To be completed before using these two actions in production.

#### Structure

```
pkManager/
├── index.js          # Lambda entry-point + CLI
├── PkManager.js       # Orchestrator class
├── test.js            # Manual smoke-test
└── __tests__/         # Jest unit tests
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

Lambda for retrieving **translation files** (`GET /translations?lang=en`), read from an S3 bucket at path `locales/{lang}/translation.json`. Data access is isolated behind a `TranslationsRepository` interface, so S3 can be replaced by a database in the future without impacting the HTTP handler.

#### CLI usage

```bash
node index.js translations lang=en
```

#### Event shape

```json
{ "action": "translations", "queryStringParameters": { "lang": "en" } }
```

### session

Lambda that returns **session data** (`codmarket`, `oic`, `sincom`, `physicalsite`, `pdvId`, part preferences, max discounts, etc.) for a given market, read from a single JSON file on S3 (`session/session_data.json`, same bucket used by `translations`). The file contains an object keyed by 4-character market code (e.g. `"1000"`); the only accepted input parameter is the **market code** (`codmarket`, 4 characters): if not provided, the default `1000` is used. If the requested market is not present in the file, the Lambda responds with `404`. Data access is isolated behind a `SessionRepository` interface, implemented by `S3SessionRepository`, to allow replacing S3 in the future without impacting the HTTP handler (same architecture as the `translations` module).

#### Main functions

| Function | Description |
|---|---|
| `handler(event)` | Lambda entry-point: reads `codmarket` from `event.criteria`, `queryStringParameters` or `pathParameters` (in this priority order), defaulting to `1000`; returns 200 with the data, 404 if the market is not present in the file, 502 on generic errors (e.g. S3 unreachable) |
| `getSessionData(codmarket)` | `S3SessionRepository`: downloads `session/session_data.json` from S3 and extracts the section for the requested market |
| `buildRepository(overrides)` | Factory that builds `S3SessionRepository` (bucket/key/client configurable via env or overrides, useful in tests) |

#### Structure

```
session/
├── src/
│   ├── index.js                             # Lambda entry-point + CLI
│   ├── errors.js                             # SessionNotFoundError (404)
│   ├── repositoryFactory.js                  # Factory: buildRepository()
│   └── repositories/
│       ├── sessionRepository.js              # Base interface
│       └── s3SessionRepository.js            # S3 implementation (bucket + JSON key)
└── __tests__/                                # Jest unit tests
```

#### Event shape

```json
{ "criteria": { "codmarket": "3109" } }
```

or, behind API Gateway:

```json
{ "queryStringParameters": { "codmarket": "3109" } }
```

Without any parameter, the default market (`1000`) is used.

#### CLI usage

```bash
node src/index.js         # default market (1000)
node src/index.js 3109    # specific market
```

---

## Installation

Each module is independent. Install dependencies separately:

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
```

---

## Environment variables

Each module reads credentials from a `.env` file in its own folder.  
Create the file by copying `.env.example` and filling in the values.

### agendaSoa / agendaSoaNaga

```env
AGENDA_SOA_HOST=https://...        # AgendaSOA service base URL
AGENDA_SOA_USERNAME=...            # Basic auth username
AGENDA_SOA_PASSWORD=...            # Basic auth password
AGENDA_SOA_API_KEY=...             # Static API key (used by the appointment endpoint)
```

### dms

```env
DMS_PING_CLIENT_ID=...              # PingFederate Client ID (dms-dedicated)
DMS_PING_CLIENT_SECRET=...          # PingFederate Client Secret (dms-dedicated)
DML_IBM_CLIENT_ID=...              # X-IBM-Client-Id for DML APIs
DML_IBM_CLIENT_SECRET=...          # X-IBM-Client-Secret for DML APIs
DML_X_TARGET_ENV=stage             # Target environment (stage / prod)
```

### jobcard

```env
JOBCARD_PING_CLIENT_ID=...          # PingFederate Client ID (jobcard-dedicated)
JOBCARD_PING_CLIENT_SECRET=...      # PingFederate Client Secret (jobcard-dedicated)
DGT_CLIENT_ID=...                  # X-IBM-Client-Id for DGT APIs
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret for DGT APIs
```

### v360

```env
V360_PING_CLIENT_ID=...             # PingFederate Client ID (v360-dedicated)
V360_PING_CLIENT_SECRET=...         # PingFederate Client Secret (v360-dedicated)
ASV_CLIENT_ID=...                  # X-IBM-Client-Id for ASV360 APIs
ASV_CLIENT_SECRET=...              # X-IBM-Client-Secret for ASV360 APIs
ASV_GETDETAILS_CLIENT_ID=...       # Default clientId for getdetails (environment-specific)
```

### pkEper

```env
EPER_HOST=eper.parts.fiat.com      # ePer SOAP service host
```

`coddealer`/`codmarket` are passed in the Lambda event `body` (not via env).

### pkDocsoa

```env
DOCSOA_HOST=https://api-cert-preprod.groupe-psa.com/api/cert-aai   # DocSOA gateway base URL
DOCSOA_USERNAME=...                    # Authentication username (WS-Security / Basic Auth)
DOCSOA_PASSWORD=...                    # Authentication password (WS-Security / Basic Auth)
DOCSOA_IBM_CLIENT_ID=...               # X-IBM-Client-Id for the API Connect gateway
DOCSOA_IBM_CLIENT_SECRET=...           # X-IBM-Client-Secret for the API Connect gateway
DOCSOA_CERT_SECRET_ID=apicCert         # (optional) Secrets Manager secret id with the mTLS client certificate (SAME one used by myPeople)
DOCSOA_KEY_SECRET_ID=apicKey           # (optional) Secrets Manager secret id with the mTLS client private key (SAME one used by myPeople)
PROXY_HOST=...                         # (optional) Stellantis/PSA corporate proxy
PROXY_PORT=8080                        # (optional) proxy port
```

### pkMenupricing

```env
MENUPRICING_WSDL=...        # Base service URL (without /Menus or /SecuredMenus)
MENUPRICING_USR=...         # WS-Security credentials (application)
MENUPRICING_PWS=...
MENUPRICING_USR_REQ=...     # Request credentials (dealerDetails in body)
MENUPRICING_PWS_REQ=...
```

### pkManager

Orchestrates `pkEper` + `pkDocsoa` + `pkMenupricing`: requires the variables above plus the dealer/market parameters specific to each WS:

```env
# ── ePer ─────────────────────────────────────────────────────────────
EPER_CODDEALER=...
EPER_CODMARKET=...
EPER_LINGUA=IT
# EPER_TICKET=...                  # optional

# ── DocSOA ───────────────────────────────────────────────────────────
DOCSOA_CODBRAND=...
DOCSOA_LANGUE=...
DOCSOA_PAYS=...
DOCSOA_CODEPDV=...
# DOCSOA_LDP=... / DOCSOA_TYPE_INTERNET=...   # optional

# ── MenuPricing ──────────────────────────────────────────────────────
MP_LANGUAGE_CODE=...
MP_COUNTRY_CODE=...
MP_DEALER_IDENTIFICATION_CODE=...
MP_MANUFACTURER=...
```

### translations

```env
TRANSLATIONS_BUCKET_NAME=...        # S3 bucket name with translation files (required)
TRANSLATIONS_KEY_PREFIX=locales     # (optional) S3 key prefix ({prefix}/{lang}/translation.json)
TRANSLATIONS_DEFAULT_LANG=en        # (optional) default language when "lang" is not provided
```

> **Note:** `authService` implements a file-based cache mechanism (`.token.cache.json`) to avoid requesting a new token on every invocation. The token is automatically renewed 30 seconds before expiry.

### session

```env
SESSION_BUCKET_NAME=...              # S3 bucket name with session data (required)
SESSION_DATA_KEY=session/session_data.json  # (optional) S3 key of the session data JSON file
SESSION_DEFAULT_MARKET=1000          # (optional) default market when "codmarket" is not passed
```

> **Note:** session data is read from a single JSON file on S3 (`session/session_data.json`, same bucket as `translations`), keyed by 4-character market code. If the requested market is not present in the file, the Lambda responds with `404`.

---

## Unit Test & Coverage

### Framework

All modules use **[Jest](https://jestjs.io/)** as the test framework.  
Tests are fully isolated: no real calls to external services (everything mocked with `jest.mock()`).

The build **automatically fails** if coverage drops below the minimum threshold of **90%** on statements, branches, functions and lines (configured via `coverageThreshold` in each `package.json`).

### Running the tests

```bash
# Tests only
cd agendaSoa && npm test

# Tests + coverage report (generates coverage/)
cd agendaSoa && npm run test:coverage
```

### Test summary

| Module | Test Suites | Tests | Files tested |
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
| **session** | 5 | 33 | `index` (handler + CLI), `errors`, `repositoryFactory`, `repositories/sessionRepository`, `repositories/s3SessionRepository` |
| **Total** | **35** | **371** | |

### Code coverage

| Module | Statements | Branches | Functions | Lines |
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
| **session** | 98.46% ✅ | 92.85% ✅ | 100% ✅ | 98.46% ✅ |

> Minimum enforced threshold: **90%** on all criteria. CI automatically fails if not reached.

### Test structure

```
<module>/
└── __tests__/
    ├── index.test.js           # Lambda dispatcher (routing, 400 on unknown action)
    ├── agendaSOAClient.test.js # REST client: public methods, interceptors, _post, edge cases
    ├── clientFactory.test.js   # Factory: env vars, overrides
    └── handlers/
        ├── appointment.test.js
        ├── availableHours.test.js
        ├── cCSList.test.js
        └── data.test.js
```

### What is tested

#### agendaSoa
- **index** – routing to all handlers, `httpMethod` fallback, 400 for unknown/missing action
- **agendaSOAClient** – constructor (with and without arguments), `_basicAuthHeader`, `_processResponse` (2xx/4xx/5xx), request/response interceptors, `_get`/`_getWithApiKey`/`_post` (including `validateStatus`), all public methods (`appointment`, `availableHours`, `cCSList`, `data`, `getAvHoursForRec`), time slot padding, CCS mapping, occupied slot filtering, edge cases (null tranches, null rdv, non-standard date format)
- **clientFactory** – construction from env vars, config override
- **handlers** – parameter merging (queryString + body + params), 200/502/500, required parameter validation

#### agendaSoaNaga
- **index** – `createnaga`/`updatenaga` routing, `httpMethod` fallback, 400 for unknown action
- **agendaNagaClient** – `_basicAuthHeader`, `_processResponse`, `createnaga`, `updatenaga` (path with apptId, `authUser`), `_post` validateStatus
- **clientFactory** – construction from env vars, config override, exposed methods
- **handlers** – body parsing, `params` fallback, 400 if `apptId` missing, 200/502/500

#### dms / jobcard / v360
- **httpClient** – JSON/text parsing, chunk concatenation, body writing, reject on network error
- **authService** – valid cache, expired/missing cache (renewal), cache writing, HTTP error, missing `access_token`, default `expires_in`
- **dmsService** – required parameter validation `getDmsSettings` (country/brand/dealer), `postDmsInquiry` (MessageType/DocumentID/CustomerIdDms/VehicleID), inquiry types (LFP/WL/MP), `buildTypeSection`, correct headers (Authorization, IBM credentials), HTTP errors
- **jobCardService / v360Service** – required parameter validation, all optional filters (date range, pagination, sorting), correct headers (Authorization, IBM credentials, x-trace-id), HTTP errors

#### pkEper / pkDocsoa / pkMenupricing / pkManager
- **WsIQPckEper / DocSOARestClient / MenuPricingSoapClient** – SOAP/REST envelope/request construction, response parsing, HTTP/SOAP error handling, all public client methods
- **PkManager** – constructor (config from env vars), `getConfigPackages` (static map per ws), `getValidPackages` (config/live WS intersection), `getValidPackagesDetail` (parallel detail fetch), `_fetchDetail`/`_fetchLiveMap` with mocks of the three sibling clients

#### translations
- **index** – CLI/Lambda dispatch to the `translations` handler
- **S3TranslationsRepository** – fetch and parse JSON from S3, `TranslationNotFoundError` on `NoSuchKey`/404/Code, generic S3 errors rethrown, invalid JSON, missing bucket configuration
- **repositoryFactory** – default instance construction and overrides
- **handlers/translations** – merge `queryStringParameters`/`body`/`params` (params wins), default language, 200/404/502, `Content-Type` header

#### session
- **index (handler)** – merges `event.criteria`/`queryStringParameters`/`pathParameters` (`criteria` wins), defaults to market `1000`, 200 with session data, 404 on `SessionNotFoundError` (missing market), 502 on generic errors (e.g. S3 unreachable), `Content-Type` header
- **index (runCli)** – prints data for the default/requested market from argv, logs error + sets `process.exitCode=1` on failure
- **errors** – `SessionNotFoundError` with `code=SESSION_NOT_FOUND` and message including the requested market
- **sessionRepository** – base class throws a "not implemented" error
- **s3SessionRepository** – fetches and parses JSON from S3, extracts the section for the requested market (uppercased), `SessionNotFoundError` on missing market, S3 error handling (`NoSuchKey`/404/Code), invalid JSON, missing bucket configuration
- **repositoryFactory** – builds the default instance and with overrides

---

## Security Scan

On every **push and pull request**, the GitHub Actions workflow automatically runs:

```bash
npm audit --audit-level=high
```

The job fails if **high** or **critical** severity vulnerabilities are detected in the dependencies.  
Results are visible in the "Security scan" step log in the **Actions** tab of the repository.

---

## Coverage report

The full HTML report is automatically generated and published as a **downloadable artifact** on GitHub Actions.

### How to access the report

1. Go to the GitHub repository → **Actions** tab
2. Click on the most recent workflow run
3. At the bottom of the page, **Artifacts** section
4. Download the artifact for the desired module (e.g. `coverage-agendaSoa`)
5. Extract the zip and open `lcov-report/index.html` in the browser

Artifacts are available for **30 days** from each run.

### Generate the report locally

```bash
cd agendaSoa
npm run test:coverage
# Open coverage/lcov-report/index.html in the browser
```

The command generates in the `coverage/` folder:
- `lcov-report/index.html` — navigable HTML report per file and line
- `cobertura-coverage.xml` — XML format for CI integration
- `coverage-summary.json` — JSON summary with percentages per module
