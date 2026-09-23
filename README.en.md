# project-am-stellantis-woc-backend

> 🇮🇹 [Leggi in italiano](README.md) &nbsp;|&nbsp; 🇬🇧 English

Stellantis – WOC BackEnd: collection of Node.js Lambdas for integration with Stellantis services (AgendaSOA, NAGA, DMS, JobCard, V360, pkEper, pkDocsoa, pkMenupricing, pkManager, translations, session, isStellantisBrand, synch-status, dmlConfigSync).

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
   - [isStellantisBrand](#isstellantisbrand)
   - [synch-status](#synch-status)
   - [dmlConfigSync](#dmlconfigsync)
   - [auroraAutoStart](#auroraautostart)
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
├── session/            # Lambda – session data (codmarket, oic, sincom, ...)
├── isStellantisBrand/  # Lambda – Stellantis brand verification (Aurora PostgreSQL via RDS Proxy)
├── synch-status/       # Lambda – DJC synchronization status update (4 Kafka events) on Aurora PostgreSQL via RDS Proxy; security delegated to the IBM APIC gateway
├── dmlConfigSync/      # Lambda – daily sync (EventBridge Schedule) of DML company-types/customer-titles + dms/settings per market/dealer -> Aurora cache, read by session
└── auroraAutoStart/    # Lambda – weekday morning auto-start (EventBridge Schedule, stage only) of the Aurora cluster if stopped by the Stellantis startstop tool

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
| `company-types` | `getCompanyTypes(token, params)` | Retrieves DML company types configuration list |
| `customer-titles` | `getCustomerTitles(token, params)` | Retrieves DML customer titles configuration list |
| `inquiry` | `postDmsInquiry(token, body)` | Submits a DML inquiry request (LFP / WL / MP) |

#### Main functions

| Module | Function | Description |
|---|---|---|
| `authService` | `getBearerToken()` | Gets/renews the PingFederate bearer token (file cache) |
| `dmsService` | `getDmsSettings(token, params)` | GET `/dms/settings?country=&brand=&dealer=` |
| `dmsService` | `getCompanyTypes(token, params)` | GET `/configurations/company-types?country=&language=` |
| `dmsService` | `getCustomerTitles(token, params)` | GET `/configurations/customer-titles?country=&language=` |
| `dmsService` | `postDmsInquiry(token, body)` | POST `/inquiry/DML/1.0/inquiry` – types: `LFP` \| `WL` \| `MP` |
| `dmsService` | `buildTypeSection(type)` | Helper: generates the type-specific payload section (LFP/WL/MP) |
| `httpClient` | `httpsRequest(options, body)` | Native Node.js HTTPS client |

#### `getCompanyTypes` / `getCustomerTitles` parameters

Same credentials/authentication as `settings` (PingFederate bearer token, `X-IBM-Client-Id`/`X-IBM-Client-Secret`, `X-Target-Env`) — only the path and query contract differ.

| Field | Required | Description |
|---|---|---|
| `country` | ✅ | Country code (e.g. `FR`) |
| `language` | ✅ | Language code (e.g. `fr`) |

#### `postDmsInquiry` parameters

| Field | Required | Description |
|---|---|---|
| `PartsInquiryHeader.MessageType` | ✅ | Request type: `LFP` \| `WL` \| `MP` |
| `PartsInquiryHeader.DocumentID` | ❌ | Unique Repair Order number. Content is optional (can be unknown/omitted, e.g. for `LFP` when the repair order doesn't exist yet), but the DML still requires the key to be present: if missing/`null`/`undefined`, it's sent as an empty string `''` |
| `PartsInquiryHeader.CustomerIdDms` | ❌ | Customer ID in DMS. Like `DocumentID`, content is optional: if missing/`null`/`undefined`, it's sent as `null` (key always present) |
| `PartsInquiryHeader.VehicleID` | ✅ | Vehicle VIN |
| `ApplicationArea` | ✅ | Sender, timestamp and BODID (UUID). If omitted, it's built internally by `buildApplicationArea()` using `config.sender` (static env defaults) overridden per-request by `sender` (see below), if provided |
| `sender` | ❌ | Shortcut: subset of `config.sender` fields (`dealerNumberId`, `dealerNumberIdSource`, `dealerCountryCode`, `languageCode`, `physicalSiteId`, `serviceId`, `currencyId`, `brand`, `componentId`, plus `market` — see note below) to override for this request, so `ApplicationArea.Sender` reflects the caller's real dealer/brand/market (`jobcard`/`pkManager`/`pkFavorite` — see the respective sections), resolved **automatically and never supplied by the frontend** (see the "Automatic resolution" note below), instead of only the static env defaults. Ignored when `ApplicationArea` is already provided. Not sent as-is to the DML |
| `UpSelling.Packages` | ❌ | Used for `LFP` |
| `WorkLines` | ❌ | Used for `WL` |
| `SpareParts.PartsItem` | ❌ | Used for `MP` |

> **Centralized dynamic Sender (`buildApplicationArea`)**: resolving
> `physicalSiteId`/`dealerNumberIdSource` via a `woc.ang_snowflakes` lookup
> (`dbManager/AnagSnowflakesRepository.js::getPhysicalSiteAndSincom`) is now
> **entirely centralized here**, in `dms/dmsService.js::buildApplicationArea`,
> so every caller (`jobcard`, `pkManager`, `pkFavorite`) shares the exact same
> mechanism/criteria instead of each duplicating the query on its own. When the
> `sender` passed to `postDmsInquiry` contains **all three** of `dealerNumberId`
> (the `mainSincom`), `market` and `brand`, `buildApplicationArea` performs the
> lookup (key `mainSincom`+`market`+`brand`) and — if a row is found — overrides
> `physicalSiteId`/`dealerNumberIdSource`; **`market` is never forwarded to the
> DML**: it's only used as the lookup key, it's not a field of
> `ApplicationArea.Sender`. The `mainSincom` match is done **with an OR**
> between the `cd_main_sincom_code` and `gn_legal_entity` columns (same
> logical data, populated in different columns depending on the source/
> extraction). `brand` is always searched with a **single, uniform criterion**,
> the 2-letter ARCAD/RefTech code (`cd_contract_brand_arcad_code`): if the
> caller passes a brand in another format (typically a numeric WebDAC code,
> e.g. `55`, `00`, `83`) it is first transformed into the corresponding ARCAD
> code by querying the same table
> (`AnagSnowflakesRepository.js::resolveArcadBrandCode`). The lookup is
> **best-effort**: if even one of the
> three fields is missing, or the query fails, the flow continues without
> modifying `physicalSiteId`/`dealerNumberIdSource` (just a log warning) — it
> never blocks the call to the DML gateway. Because of this, every Lambda
> function that bundles `dms/` in-process (`JobCardFunction`,
> `PkManagerFunction`, `PkFavoriteFunction`) as well as `DmsFunction` itself
> also requires the `dbManager/` source code (built via
> `Metadata: BuildMethod: makefile`, see `Makefile`) and the `DBMANAGER_DB_*`
> environment variables (same Aurora "wiadvisor" as
> `PkManagerFunction`/`SessionFunction`).
>
> **`DealerNumberIDSource` per "brand owner" (`config/brandowner.json`)**: the
> `dealerNumberIdSource` resolved above from `woc.ang_snowflakes`
> (`CD_SINCOM_CODE`) is the correct value for brands whose **owner** is `XF`
> (default behaviour, unchanged). For brands with owner `XP`,
> `CD_DEALER_ARCAD_CODE` is used instead (column already read from the same
> `woc.ang_snowflakes` row, exposed by `getPhysicalSiteAndSincom` as
> `dealerArcadCode`). The owner is determined by looking up the brand's
> 2-letter ARCAD code (`arcadBrand`, the same one already resolved internally
> by `getPhysicalSiteAndSincom`/`resolveArcadBrandCode` for the query above, so
> the match works regardless of the format — ARCAD or WebDAC — of the received
> `brand`) in the static `config/brandowner.json` registry on S3 (bucket
> `TranslationsBucket`, same file/format already used by
> `v360/v360Service.js::enrichWithBrandOwnerAndEnergyType`), read via a
> dedicated `v360/s3ConfigRepository.js::S3ConfigRepository` instance
> (in-memory cache local to `dms/dmsService.js`, independent from `v360`'s own
> cache — the business logic stays in `dms`/`jobcard`/`pkManager`, `v360` only
> provides the S3 read/parse utility). This lookup is also **best-effort**: if
> `dealerArcadCode` is missing, the brand is not present in the registry, or
> S3 is unreachable, `dealerNumberIdSource` stays whatever was already
> resolved (`CD_SINCOM_CODE`) — just a log warning, never an exception that
> blocks the call to the DML gateway.
>
> **`Sender.DealerNumberID`/`Sender.DealerNumberIDSource` swapped**: in the
> final Sender mapping, `Sender.DealerNumberID` receives the value resolved
> above (internal `dealerNumberIdSource`: `CD_SINCOM_CODE` or, for owner `XP`,
> `CD_DEALER_ARCAD_CODE`), while `Sender.DealerNumberIDSource` receives the
> caller-supplied `mainSincom` (internal `dealerNumberId`, or the static
> `config.sender` default if not overridden) — **swapped compared to the
> internal names** used for the DB/XF-XP resolution above.
>
> **`pairedOicCode` (optional filter on `cd_paired_oic_code`)**: when the
> `sender` passed to `postDmsInquiry` also includes `pairedOicCode`, the
> `getPhysicalSiteAndSincom` query adds the condition
> `AND cd_paired_oic_code = pairedOicCode`, to disambiguate between multiple
> rows that would otherwise match on `mainSincom`+`market`+`brand` but belong
> to different physical sites/OICs. It's a **lookup-only** field (like
> `market`): never forwarded to the DML. Today only
> `jobcard/jobCardService.js::buildDmsSender` supplies it, from
> `jobCardDetail.roInfo.pairedOicCode` of an already-available jobCardDetails
> (fetched via DGT or from the shared DynamoDB cache `TmpCacheTable`, see the
> `jobcard` section); `pkManager`/`pkFavorite` don't know it and keep working
> exactly as before (no additional filter on the query) — backward compatible.
>
> **Automatic resolution of `dealerNumberId`/`market`/`brand`/language/country
> (`resolveDynamicSenderFields`)**: `mainSincom`, `market`, `language`,
> `dealerCountryCode` and `brand` **must never be supplied by the frontend**
> (none of the callers treat them as "trusted" FE-supplied data any more): they
> are resolved automatically, with the same criteria for `jobcard`/
> `pkManager`/`pkFavorite`, by
> `dms/dmsService.js::resolveDynamicSenderFields({ username, vin }, overrides)`,
> called by each `buildDmsSender`/`_buildDmsSender` BEFORE `postDmsInquiry`:
> - `mainSincom`/`market`/`language`/`dealerCountryCode` ← `username`
>   (`event.requestContext.authorizer.sub`), via
>   `session/src/sessionContextCache.js::getCachedSessionContext` — the same
>   myPeople resolution as the `session` lambda, with a best-effort cache in
>   DynamoDB (`TmpCacheTable`, key `session:context:<username>`, TTL
>   configurable via `SESSION_CONTEXT_CACHE_TTL_MS`, default 5 min);
> - `brand` ← the current request's `vin`, via
>   `v360/v360Service.js::getCachedBrand` (the `data.brandCode` field of the
>   v360 `getdetails` response, with a best-effort cache in DynamoDB
>   (`TmpCacheTable`, key `v360:getdetails:<vin>`, TTL 1h via
>   `SESSION_CACHE_TTL_SECONDS`)) — the **vehicle's** brand, not the
>   dealer/session default (a multi-brand dealer may service a vehicle of a
>   different brand than its own).
>
> Any value already known to the caller (`overrides`, e.g. `pkManager`'s
> `this.wsConfig`) always takes priority over the auto-resolved values: the
> function only fills in the fields that are missing. It is entirely
> **best-effort** (try/catch + `console.warn`, never an exception that blocks
> building the Sender): if `username`/`vin` are missing, or session/myPeople/
> v360 aren't reachable, the unresolved fields simply stay absent and
> `config.sender`'s static defaults apply for those fields. Because of this,
> besides `dbManager/`, every Lambda that bundles `dms/` in-process
> (`JobCardFunction`, `PkManagerFunction`, `PkFavoriteFunction`) must also
> bundle `session/` (+ `myPeople/` and `dmlConfigSync/`, which `session`
> depends on) and `v360/` as sibling folders (see `Makefile`), and declare the
> same `MYPEOPLE_*`/`DMLCONFIGSYNC_DB_*`/`V360_PING_*`/`ASV_*`/
> `CONFIG_BUCKET_NAME` variables already used by `SessionFunction`/
> `V360Function` in `template.yaml`. The `dms` lambda itself **never calls**
> `resolveDynamicSenderFields` from its own handler: it stays "lightweight"
> (it doesn't bundle `session`/`myPeople`/`dmlConfigSync`/`v360`), even though
> the function lives in this file — it's meant to be called by `postDmsInquiry`
> callers.

#### CLI usage

```bash
# DMS settings
node index.js settings <country> <brand> <dealer>
# e.g.: node index.js settings fr FT 0062230

# Company types
node index.js company-types <country> <language>
# e.g.: node index.js company-types FR fr

# Customer titles
node index.js customer-titles <country> <language>
# e.g.: node index.js customer-titles fr fr

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

#### `getJobCardDetails` response enrichment

Before being returned, the response is enriched by `sanitizeJobCardDetails` with computed fields not present in the original DGT API response:

- **`jobs[].packageType` / `jobs[].packageCharge`** — added to each job (placed before `partInfo`/`laborInfo` when present), derived from `jobType`/`packageCode`: `jobType="MFP"` → `FP`/`CUSTOMER`; `jobType="STD"` with `packageCode` set → `QE`/`CUSTOMER`; `jobType="LFP"` → `LFP`/`CUSTOMER`; `jobType="STD"` without `packageCode` (or missing/empty/`null` `jobType`) → `GC`/`CUSTOMER`; any other non-empty `jobType` → `GC`/`INTERNAL`. If the job has `paymentType` set, it always overrides `packageCharge` (`packageType` stays unchanged).
- **`roInfo.roSource`** — added right after `roInfo.sourceApplication`, with the same value.

See `jobcard/README.md` for the full rule table.

#### `getCartPriceAndAvailability` (`dml` action) — dynamic Sender

`getCartPriceAndAvailability` (invoked by the `dml` action in `index.js`, via
`getDataFromDMLFromTmp`/`getDataFromDML`) queries the DML gateway
(`dms/dmsService.js::postDmsInquiry`, `MessageType=WL`) for parts/labor
price and availability, following the same pattern as
`pkManager/PkManager.js::getPriceAndAvailability` and `pkFavorite/index.js`
(see [dms](#dms) → `postDmsInquiry`). The `dml` action is always called
**after** the caller has already entered the repair order detail, so it
already has both session data and the freshly-retrieved `jobCardDetail`. The
**frontend does not (and must not) supply mainSincom/market/brand/language/
country**: `jobCardService.js::buildDmsSender(jobCardDetail, sessionContext)`
extracts only the VIN from
`jobCardDetail.vehicleInfo.identification.vin` and delegates the dynamic
resolution of everything else to
`dms/dmsService.js::resolveDynamicSenderFields({ username, vin }, sessionContext)`
— the SAME centralized mechanism used by `pkManager`/`pkFavorite` too (see the
"Automatic resolution" note in the [dms](#dms) section):

- `dealerNumberId` ← `resolved.mainSincom` (from `sessionContext.mainSincom` if already known, otherwise resolved from `username` via `session/src/sessionContextCache.js`)
- `serviceId` ← `username` (resolved from `event.requestContext.authorizer.sub`, falling back to `body.username` only when there's no `requestContext.authorizer` — local/CLI use)
- `languageCode` / `dealerCountryCode` ← `resolved.language`/`resolved.dealerCountryCode` (same, from session if not already known)
- `brand` ← `resolved.brand` (from `sessionContext.brand` if already known, otherwise resolved from the VIN via `v360/v360Service.js::getCachedBrand` — the vehicle's brand, not the dealer's)
- `market` ← `resolved.market` (only a lookup key on the `dms` side, never an actual `Sender` field)
- `physicalSiteId`/`dealerNumberIdSource`/`componentId`/`currencyId` stay the static env defaults (`dms/config.js`), unless `dms` resolves them dynamically (see `buildApplicationArea` above)

Resolution is entirely **best-effort**: if `sessionContext`/`vin` are missing
or session/myPeople/v360 aren't reachable, the unresolved fields simply stay
absent from the `sender` — never an exception that blocks
`getCartPriceAndAvailability`. `JobCardFunction` therefore requires, in
addition to `../dms/authService`/`../dms/dmsService`/`../dbManager` (already
present for `buildApplicationArea`'s `physicalSiteId`/`dealerNumberIdSource`
lookup), also the `../session` source (+ `../myPeople` and
`../dmlConfigSync`, which `session` depends on) and `../v360` (built via
`Metadata: BuildMethod: makefile`, see `Makefile`), with the same
`MYPEOPLE_*`/`DMLCONFIGSYNC_DB_*`/`V360_PING_*`/`ASV_*`/`CONFIG_BUCKET_NAME`
variables already used by `SessionFunction`/`V360Function` in
`template.yaml` — not because `jobCardService.js` accesses these folders
directly, but because
`dms/dmsService.js::resolveDynamicSenderFields`/`buildApplicationArea`,
bundled **in-process**, need them for the centralized resolution.

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
| `offering` | ❌ | E.g. `"Vehicle Description, campaign, warranty"` |
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

Orchestrator Lambda that manages **package configuration and validation** across multiple web services (ePer, DocSOA, MenuPricing), determining which configured packages are actually available for a VIN and fetching their details. It requires the source code of the three sibling modules (`pkEper`, `pkDocsoa`, `pkMenupricing`) via relative paths, plus `dbManager` (used by `getPkList` to resolve `pkwstouse` from `HQ_PKCONFIG`, given `codbrand` + `market`/`codmarket`): in AWS it is therefore built with a custom `Makefile` (`Metadata: BuildMethod: makefile` in `template.yaml`) that recreates the same sibling folder structure inside the Lambda package.

#### Available handlers

| `event.action` | Manager method | Description |
|---|---|---|
| `getConfigPackages` | `manager.getConfigPackages(pkwstouse)` | Package configuration for the given ws, read from `woc.config_packages` (Aurora PostgreSQL) via `dbManager/ConfigPackagesRepository.js` |
| `getValidPackages` | `manager.getValidPackages(market, pkwstouse, VIN)` | Intersection between config and live packages from the WS |
| `getValidPackagesDetail` | `manager.getValidPackagesDetail(market, pkwstouse, VIN)` | `getValidPackages` + detail of each package in parallel |
| `getPriceAndAvailability` | `manager.getPriceAndAvailability(market, pkwstouse, VIN)` | `getValidPackagesDetail` + `AV_LOCAL`/`PRICE`/`SCONTO` enrichment for each `listaOperazioni`/`listaRicambi` row |
| `getPkList` | `manager.getPkList(codbrand, documentId, customerId, VIN, market, dealerIdentificationCode)` | End-to-end orchestrator: resolves `pkwstouse` from `HQ_PKCONFIG` via `dbManager.getPkwstouse(pool, { codmarket: market, codbrand })`, then behaves like `getPriceAndAvailability`, but **normalizes** every package to the same set of keys (`result, codice, descrizione, pkPrice, isFixedPrice, packageType, niveau, listaOperazioni, listaRicambi, category`), regardless of the resolved `pkwstouse` |

`pkwstouse` accepts the values: `eper`, `docsoa`, `menupricing`.

Every package detail also reports `isFixedPrice`/`packageType`: always `"0"`/`"QE"` for `eper`; for `menupricing`/`docsoa`, `"1"`/`"FP"` if the package is fixed-price (promotional "Lex" for menupricing, forfait `ibxDetailForfaitService` for docsoa), otherwise `"0"`/`"QE"`. For `docsoa`, if the forfait isn't found, a fallback to `ibxDetailtpService` (tempario) is attempted. See `pkManager/README.md` for the full details.

> **Dynamic Sender (`getPriceAndAvailability`)**: `PkManager.js::_buildDmsSender(market,
> vehicleId, username)` derives the DML inquiry Sender (see the `sender` table
> in [dms](#dms) → `postDmsInquiry`) from `this.wsConfig` (eper/docsoa/
> menupricing) as **explicit** overrides (`mainSincom` from
> `menupricing.dealerIdentificationCode`/`eper.coddealer`/`docsoa.codePdv`,
> `dealerCountryCode`/`language` from menupricing/docsoa, `brand` from
> `docsoa.codbrand`), then delegates to
> `dms/dmsService.js::resolveDynamicSenderFields({ username, vin: vehicleId }, overrides)`
> — the SAME centralized mechanism used by `jobcard`/`pkFavorite` too (see the
> "Automatic resolution" note in the [dms](#dms) section): only the fields
> `wsConfig` doesn't provide are resolved automatically from `username`
> (session/myPeople) and `vehicleId` (brand via v360). `physicalSiteId` stays
> `docsoa.codePdv` (static default); `market` is passed through as-is (same
> parameter as `getPkList`/`getPriceAndAvailability`, both now extended with a
> `username` parameter propagated to `_buildDmsSender`). `_buildDmsSender()` is
> **asynchronous and never touches `dbManager` directly**: the dynamic
> `physicalSiteId`/`dealerNumberIdSource` lookup on `woc.ang_snowflakes` stays
> centralized in `dms/dmsService.js::buildApplicationArea` (see the
> "Centralized dynamic Sender" note in the [dms](#dms) section): if the passed
> `sender` contains `dealerNumberId`+`market`+`brand`, `dms` performs the
> lookup and overrides the "synthetic" values (`docsoa.codePdv` / the same
> `dealerNumberId`) with the real ones. `username` is resolved by
> `pkManager/index.js::resolveUsername(event, body)` (same authorizer.sub/
> `body.username` fallback pattern as `jobcard`/`pkFavorite`).

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

Lambda that returns **session data** (`codmarket`, `marketIso`, `oic`, `sincom`, `physicalsite`, `pdvId`, part preferences, max discounts, etc.) for a given market, read from a single JSON file on S3 (`session/session_data.json`, same bucket used by `translations`). The file contains an object keyed by 4-character market code (e.g. `"1000"`); the only accepted input parameter is the **market code** (`codmarket`, 4 characters): if not provided, the default `1000` is used. If the requested market is not present in the file, the Lambda responds with `404`. Data access is isolated behind a `SessionRepository` interface, implemented by `S3SessionRepository`, to allow replacing S3 in the future without impacting the HTTP handler (same architecture as the `translations` module).

> **Note (`username` flow):** behind API Gateway, identity comes from the Lambda Authorizer (`event.requestContext.authorizer.sub`), never from a client-supplied parameter. The authorizer's `roles` (CSV) are also always included in the 200 response body as `userroles` (array, `[]` if absent), added by the handler on top of the repository's data, right after the `profile` key (appended at the end if `profile` is missing), preceded by 3 numeric `0`/`1` flags — `hqCentral`, `hqMarket`, `dealer` — derived from those same roles via `resolveRoleFlags(roles)` (`src/index.js`), with only one flag set to `1` at a time (priority `hqCentral` > `hqMarket` > `dealer`): `hqCentral = 1` if a role contains the substring `HQCENTRAL` (case-insensitive, e.g. `WRT.WOC.NONPROD.HQCENTRAL`, `Z` prefix and `NONPROD`/`PROD` environment vary and are ignored); otherwise `hqMarket = 1` if a role contains `HQNSC` followed by 4 digits, the market code (e.g. `ZWRT.WOC.NONPROD.HQNSC3109`); otherwise (default, including an empty `userroles`) `dealer = 1`. Right after `dealer` and before `userroles`, the response also always includes `hqMarketsList` (array of `{ market, description }` objects, e.g. `[{ "market": "3109", "description": "France" }]`), computed by `resolveHqMarketsList` (`src/hqMarketsResolver.js`) from those same flags and **never** client-controlled: `[]` for a `dealer` (no query executed); **all** distinct markets from `woc.ang_snowflakes` (`cd_market_code`, same `fl_is_deleted_flag = 0` filter as the other queries on this table) for `hqCentral = 1`; the **single** market extracted from the `HQNSC<4 digits>` role (e.g. `ZWRT.WOC.NONPROD.HQNSC3109` → market `"3109"`) for `hqMarket = 1` (`[]` if no role matches the pattern). The `gn_country_name` column does **not** exist on `woc.ang_snowflakes`: `description` is resolved via a `LEFT JOIN` on `woc.addr_snowflakes` (same `cd_market_code`, `fl_is_deleted_flag = 0`), so it is `null` for a market present in `ang_snowflakes` without a matching address row (never an error). Same fault-tolerant behaviour as the other DB reads below: any query error is caught and `hqMarketsList` simply falls back to `[]`, never blocking the session response. With a `sub` available, the Lambda calls `myPeople` (`readUserProfiles`) and then reads, in parallel, seven Aurora caches/tables maintained by the `dmlConfigSync`/`dbManager` modules (no more live calls to `dms/*` from `session`): `woc.dms_settings` (for `isdml`/`dmlcustomerupdate`/`dmldiscount`, keyed by `country`+`brand`+`dealer`), `woc.dml_configurations` (for `companytypes`/`customertitles`, keyed by `country`+`language`), `woc.anag_brand` (for `oics[].brandLogos`, see below), `woc.ang_snowflakes` (for `marketIso`, the dealer's country ISO code, given `codmarket`, via `dbManager.getCountryIsoCode`, and for `oics[].brands`, see below), `woc.hq_application_enabling` (to filter out OICs disabled for WOC, see below), and `woc.addr_snowflakes` (for `oics[].address`/`oics[].zipcode`/`oics[].city`, see below). The cache reads never throw: on any error or missing row they simply return the safe defaults (`isdml:false`/`null`/`null`, `[]` for companytypes/customertitles, `[]` for `brandLogos`, `null` for `marketIso`, the original myPeople `brands` CSV as fallback, myPeople's own address fields as fallback, no OIC excluded), so the session response is never broken for this reason. On a first-ever cache-miss for a country+brand+dealer combination, `session` also registers (best-effort, awaited) that combination into `woc.dms_settings_enabled_dealers`, so the next day's scheduled sync populates it. Each element of `oics` also includes a `brandLogos` array right after `brands`, resolving the CSV brand codes to their `logo_s3_key` paths via the `woc.anag_brand` table (same table already used by `isStellantisBrand`), resolved in a single batched query; same fault-tolerant behaviour — `[]` if `brands` is missing/empty or the DB query fails. The `brands` CSV itself is now overridden (per OIC, via a single batched query) with the distinct `cd_contract_brand_webdac_code` values from `woc.ang_snowflakes` matching the OIC's `CODE` against `cd_paired_oic_code` (`dbManager.getBrandsByOics`), falling back to myPeople's original `brands` CSV when the DB has no rows for that OIC. Likewise, `address`/`zipcode`/`city` are overridden (per OIC, via a single batched query joining `woc.ang_snowflakes`/`woc.addr_snowflakes`) with `gn_address_1`/`cd_zip_code`/`gn_town` (`dbManager.getAddressByOics`), falling back to myPeople's own `ADDRESS`/`ZIPCODE`/`CITY` fields (`null` if neither source has data) when the DB has no rows for that OIC; these fields are inserted even if missing from the original myPeople OIC object. OICs with an explicit `enablewoc = 0` row in `woc.hq_application_enabling` (matched by `market`+`oic`, via `dbManager.getDisabledOics`, also a single batched query) are removed from the `oics` array; an OIC with no configuration row stays enabled by default (opt-out), unlike the `hqManager`/`dbManager.getEnablingConfiguration` admin endpoint which defaults to disabled when no row exists. See the Italian `README.md` for the full field mapping table.

> **Note (`woc.ang_snowflakes`, logically deleted rows):** **all** `dbManager` queries on `woc.ang_snowflakes` (`getCountryIsoCode`, `getPhysicalSiteAndSincom`, `getPhysicalSiteAndPdvId`, `resolveArcadBrandCode`, `getBrandsByOics` in `AnagSnowflakesRepository.js`; `getEnablingConfiguration`, `getAddressByOics` in `HqRepository.js`) filter `fl_is_deleted_flag = 0`, excluding rows logically deleted at the Snowflake source (`fl_is_deleted_flag = 1`, SMALLINT 0/1 column, see `sql/create_table_ang_snowflakes.sql`). This specifically prevents `oics[].brands` (the brands shown for each OIC in the session response) from including brand codes from rows already deactivated/deleted at the source.

> **Note (HQ users):** myPeople only models dealer-network profiles (IURSMA usernames): for an HQ user (Stellantis staff, not a dealer, e.g. `"SF48816"`) it responds with `RC=121`, `STATUS="HQ users are not allowed for this feature."`, `User={}`. This is **not** treated as a 404 (reserved for `RC` other than `0`/`121`, or a missing `User`): `MyPeopleDmsSessionRepository.getSessionData` returns a 200 "empty" session instead (same shape/keys as the historical JSON, all dealer-specific fields `null`/`[]`, `usertype: "HQ"`), so a legitimate HQ user can still access the app without errors.

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
│   ├── hqMarketsResolver.js                   # resolveHqMarketsList(): computes hqMarketsList (HQ markets) from woc.ang_snowflakes
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

### isStellantisBrand

Lambda for **Stellantis brand verification**, exposed as a `GET /api/isStellantisBrand` endpoint. Receives an ARCAD brand code (`ar_codbrand`) and checks whether it exists in the `woc.anag_brand` table of the "wiadvisor" Aurora PostgreSQL database via RDS Proxy.

#### Endpoint

| Method | Path | Parameter | Description |
|---|---|---|---|
| `GET` | `/api/isStellantisBrand` | `ar_codbrand` (query, required, max 2 chars, A-Z only) | Checks if a brand belongs to Stellantis |

#### Responses

| Status | Body | Description |
|---|---|---|
| 200 | `{ "success": true, "isStellantisBrand": true }` | Brand found in registry |
| 200 | `{ "success": true, "isStellantisBrand": false }` | Brand not found |
| 400 | `{ "success": false, "message": "..." }` | Input validation error |
| 500 | `{ "success": false, "message": "Errore interno del server" }` | Internal error (DB, Secrets Manager, etc.) |

#### Structure

```
isStellantisBrand/
├── index.js                    # Lambda handler (validation + query)
├── package.json                # Dependencies (pg, @aws-sdk/client-secrets-manager)
├── openapi.yaml                # OpenAPI 3.0 specification
├── infrastructure.csv          # CSV row for infrastructure team
├── shared/
│   └── dbClient.js             # Shared DB connection library (reusable pg pool)
└── __tests__/                  # Jest unit tests + property-based tests (fast-check)
```

#### Input validation

1. `ar_codbrand` missing/null/empty/whitespace → 400 `"ar_codbrand è obbligatorio"`
2. Length > 2 characters → 400 `"ar_codbrand deve essere di massimo 2 caratteri"`
3. Non-alphabetic characters → 400 `"ar_codbrand deve contenere solo caratteri alfabetici"`
4. Converted to uppercase before querying

#### DB connection (shared/dbClient.js)

- Credentials retrieved from **Secrets Manager** (`DB_SECRET_ARN`)
- `pg` pool with TLS to **RDS Proxy** (`RDS_PROXY_ENDPOINT`)
- Pool reused across invocations (warm start), invalidated on error
- Connection timeout: 5 seconds

---

### synch-status

Lambda for **updating the DJC synchronization status** of a job card. It receives from DJC one of the 4 Kafka events defined by the SRP DL KAFKA Specification and updates (**UPDATE-only**, never INSERT) the `djc_sync_status` field of the record already present in the `woc.comunication_asyncro_djc` table of the "wiadvisor" Aurora PostgreSQL database, reached via **RDS Proxy**.

> **Security:** this Lambda's security is **fully delegated to the IBM API Connect (APIC) gateway**, including authentication and **token validation**. The Lambda assumes every incoming invocation is already authorized and performs **no token check** (no `authService`): it only handles payload parsing/validation, updating the status in Aurora, logging and tracing.

#### Endpoint (IBM APIC gateway)

Exposed on the IBM APIC gateway. In **DEV** the endpoint is:

```
https://emea-aws.dev.np-api.stellantis.com/ps-dev/extra/woc/job-card/v1/synch-status
```

> Environment naming rule (same as for role/SSM-parameter/secret names and ARNs): in **stage** `ps-dev`/`dev.np-api` become `ps-stage`/`stage.np-api`; in **prod** there is no `np-` segment (nor the `np-` prefix on AWS resource names).

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/synch-status` | `eventType`, `jobCardId` (or `jobCardSrpId`), `timestamp` (ISO 8601) | Updates `djc_sync_status` of the existing record |

The 4 supported `eventType` values (mapped to the corresponding DB status):

| eventType | djc_sync_status |
|---|---|
| `DMS_PUSH_SUCCESS_WITHOUT_UPDATE` | `SUCCESS_WITHOUT_UPDATE` |
| `DMS_PUSH_SUCCESS_WITH_UPDATE` | `SUCCESS_WITH_UPDATE` |
| `DMS_PUSH_REFUSAL` | `REFUSAL` |
| `DMS_PUSH_FAILURE` | `FAILURE` |

#### Responses

| Status | Body | Description |
|---|---|---|
| 200 | `{ "success": true, "response": { "responseId", "jobCardId", "eventType", "status", "timestamp" } }` | Record updated successfully |
| 400 | `{ "success": false, "error": "Bad Request", ... }` | Body not valid JSON or payload validation failed |
| 404 | `{ "success": false, "error": "Not Found", ... }` | Record not present (must be created first by another Lambda) |
| 503 | `{ "success": false, "error": "Service Unavailable", ... }` | Cannot connect to Aurora |
| 504 | `{ "success": false, "error": "Gateway Timeout", ... }` | DB query exceeded the timeout |
| 500 | `{ "success": false, "error": "Internal Server Error", ... }` | Internal error |

#### Structure

```
synch-status/
├── index.js                    # Lambda handler (parsing + validation + Aurora UPDATE)
├── config.js                   # Centralized configuration
├── validator.js                # Payload validation
├── logger.js                   # Structured logging + traceId
├── package.json                # Dependencies (pg, @aws-sdk/client-secrets-manager, @aws-sdk/client-ssm, ...)
├── shared/
│   └── dbClient.js             # Shared DB connection library (reusable pg pool — identical to isStellantisBrand)
└── __tests__/                  # Jest unit tests
```

#### Permissions and IAM role

Same permissions as `isStellantisBrand` (VPC access, X-Ray, `ssm:GetParameter` on the two DB parameters, `secretsmanager:GetSecretValue`, `kms:Decrypt`). Unlike `isStellantisBrand` — which uses SAM-managed inline policies — this Lambda references in `template.yaml` a **pre-existing IAM role** provided by the infra team. In DEV:

```
arn:aws:iam::237024525379:role/stla-rol-np-bsn0027990-dev-synch-status
```

> Same naming rule: `-dev` in dev, `-stage` in stage, in **prod** no `np-` and no environment suffix (`stla-rol-bsn0027990-prod-synch-status`). Permissions equivalent to `isStellantisBrand` must already be attached to that role (when `Role` is set, SAM ignores `Policies`).

#### DB connection (shared/dbClient.js)

- Credentials retrieved from **Secrets Manager** (ARN read from the SSM parameter `DB_SECRET_ARN_PARAM`)
- `pg` pool with TLS to **RDS Proxy** (endpoint read from the SSM parameter `RDS_PROXY_ENDPOINT_PARAM`)
- Pool reused across invocations (warm start), invalidated on error
- Connection timeout: 5 seconds

---

### dmlConfigSync

**Scheduled** Lambda (EventBridge Schedule, `cron(0 8 * * ? *)` — daily at 08:00 UTC, see `template.yaml`) that syncs, once a day, two independent caches on Aurora PostgreSQL, so `session` can read them from a DB cache instead of calling the DML services live on every session request:

1. **company-types/customer-titles** for enabled markets;
2. **dms/settings** for enabled `country`+`brand`+`dealer` combinations (used for `isdml`/`dmlcustomerupdate`/`dmldiscount`).

Both share the same PingFederate bearer token, fetched once per run. Markets: reads `woc.dml_enabled_markets` (`country`, `language`, `active`) and calls `dms.getCompanyTypes`/`dms.getCustomerTitles` in parallel for each market, then upserts the result (`company_types`/`customer_titles` as JSONB, `[]` if the service returns 404/no data) into `woc.dml_configurations` (PK `country`+`language`). Dealers: reads `woc.dms_settings_enabled_dealers` (`country`, `brand`, `dealer`, `active`) — populated **automatically** by `session` on the first cache-miss for a never-seen combination, no manual seeding needed — and calls `dms.getDmsSettings` for each combination, then upserts the result (`success` as boolean, `data` as JSONB) into `woc.dms_settings` (PK `country`+`brand`+`dealer`). Each market/dealer is processed in isolation (`Promise.allSettled`): a failing element does not block the sync of the others; the summary returned is `{success, results, dealerResults}`.

#### CLI usage

```bash
node index.js sync
```

---

### auroraAutoStart

**Scheduled** Lambda (EventBridge Schedule, `cron(0 6 ? * MON-FRI *)` — 06:00 UTC on weekdays, see `template.yaml`) whose sole purpose is to **automatically start the stage Aurora cluster every morning if it is stopped**.

**Context:** a centralized Stellantis tool ("Stellantis startstop tool", external to this repository) stops the Aurora cluster `rds-np-bsn0027990-${Environment}-aurora` every evening for cost savings on the non-prod environment (visible via the `stla_scheduler_action` tag on the cluster and RDS events around 19:12 UTC), but does **not** provide any automatic morning restart — confirmed via CloudTrail: before this Lambda, every historical `StartDBCluster` call was a manual operator invocation.

On each run: reads the cluster's current status (`rds:DescribeDBClusters`); if `"stopped"`, calls `rds:StartDBCluster`; for any other status (`available`, `starting`, `backing-up`, ...) it does nothing — idempotent, safe to re-run even if the cluster was already started manually before the schedule fires.

> **Note:** deployed **only for the `stage` environment** (`Condition: IsStage` in `template.yaml`) — `dev` stays always on (no automatic shutdown observed) and `prod` is not managed by this scheduler. No new CloudFormation parameter: the cluster name follows the same existing naming convention (`rds-np-bsn0027990-${Environment}-aurora`).

#### CLI usage

```bash
node index.js
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
cd isStellantisBrand && npm install
cd synch-status   && npm install
cd dmlConfigSync  && npm install
cd auroraAutoStart && npm install
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
# For the centralized (best-effort) lookup of physicalSiteId/
# dealerNumberIdSource on woc.ang_snowflakes in buildApplicationArea() — same
# variables/same "wiadvisor" Aurora as PkManagerFunction/SessionFunction
DBMANAGER_DB_HOST=...
DBMANAGER_DB_PORT=5432
DBMANAGER_DB_NAME=...
DBMANAGER_DB_SECRET_ID=...
```

### jobcard

```env
JOBCARD_PING_CLIENT_ID=...          # PingFederate Client ID (jobcard-dedicated)
JOBCARD_PING_CLIENT_SECRET=...      # PingFederate Client Secret (jobcard-dedicated)
DGT_CLIENT_ID=...                  # X-IBM-Client-Id for DGT APIs
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret for DGT APIs
# Required because the dms/ source code is bundled in-process (Makefile):
# dms/dmsService.js::buildApplicationArea performs the best-effort lookup of
# physicalSiteId/dealerNumberIdSource on woc.ang_snowflakes — same
# variables/same "wiadvisor" Aurora as PkManagerFunction/SessionFunction.
# jobCardService.js no longer accesses dbManager directly.
DBMANAGER_DB_HOST=...
DBMANAGER_DB_PORT=5432
DBMANAGER_DB_NAME=...
DBMANAGER_DB_SECRET_ID=...
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

> **Note:** `authService` implements a Bearer token cache mechanism on DynamoDB (`TmpCacheTable` table, env `DYNAMO_CACHE_TABLE_NAME` — see `dynamoCache.js`) to avoid requesting a new token on every invocation, shared across Lambda instances/functions (unlike the previous file-based `/tmp` cache, which was lost on every cold start and never shared across different functions). The token is automatically renewed 30 seconds before expiry and is invalidated if scope/client_id no longer match the configured ones.

### session

```env
SESSION_BUCKET_NAME=...              # S3 bucket name with session data (required)
SESSION_DATA_KEY=session/session_data.json  # (optional) S3 key of the session data JSON file
SESSION_DEFAULT_MARKET=1000          # (optional) default market when "codmarket" is not passed
```

> **Note:** session data is read from a single JSON file on S3 (`session/session_data.json`, same bucket as `translations`), keyed by 4-character market code. If the requested market is not present in the file, the Lambda responds with `404`.

> **Note (`username` flow):** requires all `dms`/`myPeople` environment variables listed above, plus `DMLCONFIGSYNC_DB_*` (`woc.dms_settings`/`woc.dml_configurations` cache) and `DBMANAGER_DB_*` (`woc.ang_snowflakes` table, for `marketIso`/`oics[].brands`, `woc.hq_application_enabling`, for the disabled-OIC filter, and `woc.addr_snowflakes`, for `oics[].address`/`oics[].zipcode`/`oics[].city`) — see `dmlConfigSync`/`dbManager` sections below (same Aurora cluster/secret as `pkFavorite`, no new CloudFormation parameter).

### isStellantisBrand

```env
DB_SECRET_ARN=arn:aws:secretsmanager:...   # ARN of the Secrets Manager secret with DB credentials (sm-np-bsn0027990-${Environment}-aurora-app)
RDS_PROXY_ENDPOINT=...                     # RDS Proxy endpoint for Aurora PostgreSQL connection
```

> **Note:** the Secrets Manager secret contains a JSON payload with keys `dbname` ("wiadvisor"), `engine` ("postgres"), `password`, `port` (5432), `username` ("wiadvisor_app"). Connection uses TLS via RDS Proxy. The Lambda runs inside the VPC.

### synch-status

```env
DB_SECRET_ARN_PARAM=/app/np-BSN0027990-dev/DB_SECRET_ARN          # SSM parameter with the ARN of the DB credentials secret
RDS_PROXY_ENDPOINT_PARAM=/app/np-BSN0027990-dev/RDS_PROXY_ENDPOINT # SSM parameter with the RDS Proxy endpoint
```

> **Note:** same two environment variables (and same values) as `isStellantisBrand`. The Lambda reads the secret ARN and RDS Proxy endpoint from SSM, then the credentials from Secrets Manager; TLS connection via RDS Proxy, inside the VPC. Naming rule: `-dev` in dev, `-stage` in stage, in prod no `np-` nor environment suffix (`/app/BSN0027990/...`).

### dmlConfigSync

```env
DMLCONFIGSYNC_DB_HOST=rdsproxy-np-bsn0027990-dev.proxy-xxxx.eu-west-1.rds.amazonaws.com  # RDS Proxy host (required)
DMLCONFIGSYNC_DB_PORT=5432                    # (optional) default 5432
DMLCONFIGSYNC_DB_NAME=wiadvisor               # (optional) default wiadvisor
DMLCONFIGSYNC_DB_SECRET_ID=sm-np-bsn0027990-dev-aurora-app  # (optional) secret id with user/password/dbname/port
DMLCONFIGSYNC_DB_SSL=true                     # (optional) default true
```

> **Note:** same Aurora cluster/RDS Proxy and same Secrets Manager secret as `pkFavorite` (in `template.yaml` it reuses the `PkFavoriteDbHost`/`PkFavoriteDbSecretId` parameters, no new CloudFormation parameter). Also requires **all** the `dms` environment variables above (`DMS_PING_CLIENT_ID`, `DMS_PING_CLIENT_SECRET`, `DML_IBM_CLIENT_ID`, `DML_IBM_CLIENT_SECRET`, `DML_X_TARGET_ENV`), needed to call `dms.getCompanyTypes`/`dms.getCustomerTitles`/`dms.getDmsSettings`.

---

### auroraAutoStart

```env
AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER=rds-np-bsn0027990-stage-aurora  # (optional in Lambda: set by template.yaml; required only for local CLI/tests)
AWS_REGION=eu-west-1                                                  # (optional in Lambda: already set automatically by AWS)
```

> **Note:** in Lambda, `AURORAAUTOSTART_DB_CLUSTER_IDENTIFIER` is automatically set by `template.yaml` (`!Sub "rds-np-bsn0027990-${Environment}-aurora"`), no DB secret/credential required (uses only the RDS management API via IAM, no database connection).

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
| **pkDocsoa** | 2 | 40 | `DocSOARestClient`, `certService` |
| **pkMenupricing** | 1 | 14 | `MenuPricingSoapClient` |
| **pkManager** | 1 | 27 | `PkManager` |
| **translations** | 5 | 42 | `index`, `errors`, `repositoryFactory`, `handlers/translations`, `repositories/S3TranslationsRepository` |
| **session** | 7 | 74 | `index` (handler + CLI), `errors`, `repositoryFactory`, `repositories/sessionRepository`, `repositories/s3SessionRepository`, `repositories/myPeopleDmsSessionRepository` (+ lazy-load) |
| **synch-status** | 3 | 87 | `index` (handler + `_validatePayload`/`_buildResponse`), `config`, `validator` |
| **dmlConfigSync** | 4 | 50 | `index` (handler + CLI + `runSync`/`syncMarket`/`syncDealer`), `db`, `DmlConfigRepository`, `DmsSettingsRepository` |
| **auroraAutoStart** | 2 | 8 | `index` (handler), `services/auroraClusterService` |
| **Total** | **44+** | **491+** | |

### Code coverage

| Module | Statements | Branches | Functions | Lines |
|---|:---:|:---:|:---:|:---:|
| **agendaSoa** | 100% ✅ | 96.96% ✅ | 100% ✅ | 100% ✅ |
| **agendaSoaNaga** | 100% ✅ | 92.68% ✅ | 100% ✅ | 100% ✅ |
| **dms** | 100% ✅ | 96.55% ✅ | 100% ✅ | 100% ✅ |
| **jobcard** | 100% ✅ | 96.66% ✅ | 100% ✅ | 100% ✅ |
| **v360** | 100% ✅ | 93.18% ✅ | 100% ✅ | 100% ✅ |
| **pkEper** | 98.66% ✅ | 91.11% ✅ | 100% ✅ | 98.64% ✅ |
| **pkDocsoa** | 97.61% ✅ | 93.70% ✅ | 100% ✅ | 98.97% ✅ |
| **pkMenupricing** | 100% ✅ | 98.52% ✅ | 100% ✅ | 100% ✅ |
| **pkManager** | 99.01% ✅ | 90.47% ✅ | 100% ✅ | 100% ✅ |
| **translations** | 98.94% ✅ | 94.64% ✅ | 100% ✅ | 98.9% ✅ |
| **session** | 98.19% ✅ | 94.17% ✅ | 100% ✅ | 99.52% ✅ |
| **synch-status** | 94.85% ✅ | 94% ✅ | 100% ✅ | 94.76% ✅ |
| **dmlConfigSync** | 97.46% ✅ | 92.43% ✅ | 96.77% ✅ | 97.18% ✅ |
| **auroraAutoStart** | 100% ✅ | 100% ✅ | 100% ✅ | 100% ✅ |

> Minimum enforced threshold: **90%** on all criteria. CI automatically fails if not reached.
>
> **Note (`synch-status`):** all 3 suites (`__tests__/config.test.js`, `validator.test.js`, `index.test.js`) pass (87 tests). Aggregate coverage is above 90% on all criteria (branch 94%, `config.js` at 100% branch); the per-file thresholds defined in `synch-status/package.json` (index 90/85, config 80/70, validator 100) are comfortably met.

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
- **dmsService** – required parameter validation `getDmsSettings` (country/brand/dealer), `postDmsInquiry` (MessageType/VehicleID required; `DocumentID`/`CustomerIdDms` optional content but always present in the payload, sent as `''` and `null` respectively when omitted), inquiry types (LFP/WL/MP), `buildTypeSection`, correct headers (Authorization, IBM credentials), HTTP errors
- **jobCardService / v360Service** – required parameter validation, all optional filters (date range, pagination, sorting), correct headers (Authorization, IBM credentials, x-trace-id), HTTP errors; for `jobCardService`: `jobs[].packageType`/`packageCharge` enrichment (all `jobType`/`packageCode`/`paymentType` combinations), placement before `partInfo`/`laborInfo`, `roInfo.roSource` added right after `sourceApplication` (including missing `roInfo`/`sourceApplication`)

#### pkEper / pkDocsoa / pkMenupricing / pkManager
- **WsIQPckEper / DocSOARestClient / MenuPricingSoapClient** – SOAP/REST envelope/request construction, response parsing, HTTP/SOAP error handling, all public client methods
- **PkManager** – constructor (config from env vars), `getConfigPackages` (map per ws, read from `woc.config_packages` via `dbManager/ConfigPackagesRepository.js`), `getValidPackages` (config/live WS intersection), `getValidPackagesDetail` (parallel detail fetch, `isFixedPrice`/`packageType` per ws), `getPriceAndAvailability`, `getPkList` (normalization via `_normalizePkDetail`, error-item handling), docsoa forfait→tempario fallback (`ibxDetailtpService`, using `rowData.ref` as `refTp`), `_fetchDetail`/`_fetchLiveMap` with mocks of the three sibling clients

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
- **myPeopleDmsSessionRepository** – `username` flow: full myPeople→cache DB→session JSON mapping (`oics`/`applications`, `oics[].brandLogos` via `woc.anag_brand`, `oics[].brands` overridden from `woc.ang_snowflakes` via `getBrandsByOics` with fallback to myPeople's CSV, `oics[].address`/`oics[].zipcode`/`oics[].city` overridden from `woc.addr_snowflakes` via `getAddressByOics` with fallback to myPeople's own fields (`null` if neither source has data), disabled OICs (`enablewoc = 0` in `woc.hq_application_enabling`, via `getDisabledOics`) removed from `oics`, `companytypes`/`customertitles` from `woc.dml_configurations`), `isdml`/`dmlcustomerupdate`/`dmldiscount` read from the `woc.dms_settings` cache (never a live call), cache-miss auto-registers the `country`+`brand`+`dealer` combination into `woc.dms_settings_enabled_dealers` (best-effort, awaited, never blocks the session response), all DB reads fault-tolerant (safe defaults on error, no 502); see the Italian `README.md` for the full test list
- **repositoryFactory** – builds the default instance and with overrides, for both `buildRepository` (S3) and `buildMyPeopleDmsRepository` (myPeople/DB cache)

#### synch-status
- **index (handler)** – parses the `body` (JSON string or object), 400 on invalid JSON body; payload validation (required fields `eventType`/`jobCardId`|`jobCardSrpId`/`timestamp`, `eventType` among the 4 supported, `timestamp` ISO 8601) with 400 and error details; `eventType` → `djc_sync_status` mapping; **UPDATE-only** on `woc.comunication_asyncro_djc` (never INSERT) with `version` increment; 404 when the record does not exist (must be created first by another Lambda); 503 on Aurora connection error, 504 on query timeout, 500 on generic error; no token validation (security delegated to the IBM APIC gateway)
- **config** – `getInstance()`/`reset()` singleton pattern, configuration structure (AWS/OAuth/APIC/Logging/Timeouts/API endpoints sections), environment resolution from env (`ENVIRONMENT`, default `dev`), `getByPath()` (nested paths, `null` when not found), log level handling
- **validator** – payload and event validation rules (required fields, supported `eventType` values, ISO 8601 `timestamp`, min/max sizing, collecting all errors)

#### dmlConfigSync
- **index (syncMarket/syncDealer)** – parallel `getCompanyTypes`/`getCustomerTitles` calls with upsert into `woc.dml_configurations`; `getDmsSettings` call with upsert into `woc.dms_settings`
- **index (runSync)** – no market/dealer enabled → early return without calling `getBearerToken`; wrapped error on `getBearerToken` failure; parallel sync of all enabled markets/dealers (single shared bearer token); per-market/per-dealer failure isolation (`Promise.allSettled`)
- **index (handler/main CLI)** – delegates to `runSync`, unknown CLI command, `sync` command success/failure exit codes, lazy-loading of `dms/authService`/`dms/dmsService`
- **db** – `pg` pool creation/caching (direct env vars vs Secrets Manager), `connectionTimeoutMillis`
- **DmlConfigRepository** / **DmsSettingsRepository** – see the Italian `README.md` for the full test list (market/dealer listing, upsert with validation and safe defaults, cache read with `null` on never-seen combination, best-effort dealer registration)

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
