# project-am-stellantis-woc-backend

Stellantis – WOC BackEnd: raccolta di Lambda Node.js per l'integrazione con i servizi Stellantis (AgendaSOA, NAGA, DMS, JobCard, V360).

![Unit Tests](https://github.com/DevExpPlatform/project-am-stellantis-woc-backend/actions/workflows/unit-tests.yml/badge.svg)

---

## Indice

1. [Struttura del progetto](#struttura-del-progetto)
2. [Moduli](#moduli)
   - [agendaSoa](#agendasoa)
   - [agendaSoaNaga](#agendasoaNaga)
   - [dms](#dms)
   - [jobcard](#jobcard)
   - [v360](#v360)
3. [Installazione](#installazione)
4. [Variabili d'ambiente](#variabili-dambiente)
5. [Unit Test](#unit-test)

---

## Struttura del progetto

```
project-am-stellantis-woc-backend/
├── agendaSoa/          # Lambda – pianificazione appuntamenti (AgendaSOA REST)
├── agendaSoaNaga/      # Lambda – creazione/aggiornamento appuntamenti NAGA
├── dms/                # Lambda – DMS Settings (Stellantis DML API)
├── jobcard/            # Lambda – JobCard list/details (Stellantis DGT API)
├── v360/               # Lambda – OTA Compatibility & Vehicle Details (ASV360 API)
├── examples/           # Esempi di riferimento (non deployati)
├── language/           # (riservato)
└── traslate/           # (riservato)
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

Lambda per il recupero delle **impostazioni DMS** tramite l'API Stellantis DML, con autenticazione PingFederate (Bearer token).

#### Funzioni principali

| Modulo | Funzione | Descrizione |
|---|---|---|
| `authService` | `getBearerToken()` | Ottiene/rinnova il Bearer token PingFederate (cache su file) |
| `dmsService` | `getDmsSettings(token, params)` | Chiama GET `/dms/settings?country=&brand=&dealer=` |
| `httpClient` | `httpsRequest(options, body)` | Client HTTPS nativo Node.js |

#### Utilizzo CLI

```bash
node index.js settings <country> <brand> <dealer>
# es: node index.js settings fr FT 0062230
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
| `includeOtaHistoryData` | ❌ | `"true"` / `"false"` |
| `locale` | ❌ | Es. `"fr_FR"` |

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

## Installazione

Ogni modulo è indipendente. Installare le dipendenze separatamente:

```bash
cd agendaSoa    && npm install
cd agendaSoaNaga && npm install
cd dms          && npm install
cd jobcard      && npm install
cd v360         && npm install
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
PING_CLIENT_ID=...                 # Client ID PingFederate
PING_CLIENT_SECRET=...             # Client Secret PingFederate
DML_IBM_CLIENT_ID=...              # X-IBM-Client-Id per le API DML
DML_IBM_CLIENT_SECRET=...          # X-IBM-Client-Secret per le API DML
DML_X_TARGET_ENV=stage             # Ambiente target (stage / prod)
```

### jobcard

```env
PING_CLIENT_ID=...                 # Client ID PingFederate
PING_CLIENT_SECRET=...             # Client Secret PingFederate
DGT_CLIENT_ID=...                  # X-IBM-Client-Id per le API DGT
DGT_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API DGT
```

### v360

```env
PING_CLIENT_ID=...                 # Client ID PingFederate
PING_CLIENT_SECRET=...             # Client Secret PingFederate
ASV_CLIENT_ID=...                  # X-IBM-Client-Id per le API ASV360
ASV_CLIENT_SECRET=...              # X-IBM-Client-Secret per le API ASV360
```

> **Nota:** `authService` implementa un meccanismo di cache su file (`.token.cache.json`) per evitare di richiedere un nuovo token ad ogni invocazione. Il token viene rinnovato automaticamente 30 secondi prima della scadenza.

---

## Unit Test

### Framework

Tutti i moduli usano **[Jest](https://jestjs.io/)** come framework di test.  
I test sono completamente isolati: nessuna chiamata reale a servizi esterni (tutto mockato con `jest.mock()`).

### Eseguire i test

```bash
# Singolo modulo
cd agendaSoa    && npm test
cd agendaSoaNaga && npm test
cd dms          && npm test
cd jobcard      && npm test
cd v360         && npm test
```

### Riepilogo copertura

| Modulo | Test Suites | Tests | File testati |
|---|:---:|:---:|---|
| **agendaSoa** | 7 | 63 | `index`, `agendaSOAClient`, `clientFactory`, `handlers/*` |
| **agendaSoaNaga** | 4 | 35 | `index`, `agendaNagaClient`, `handlers/*` |
| **dms** | 3 | 23 | `httpClient`, `authService`, `dmsService` |
| **jobcard** | 3 | 26 | `httpClient`, `authService`, `jobCardService` |
| **v360** | 3 | 29 | `httpClient`, `authService`, `v360Service` |
| **Totale** | **20** | **176** | |

### Struttura dei test

```
<modulo>/
└── __tests__/
    ├── index.test.js           # Dispatcher Lambda (routing, 400 su action sconosciuta)
    ├── agendaSOAClient.test.js # Client REST: tutti i metodi pubblici + _processResponse
    ├── clientFactory.test.js   # Factory: env vars, overrides
    └── handlers/
        ├── appointment.test.js   # 200/502/500, merge params
        ├── availableHours.test.js # 400 se id mancante, 200/502/500
        ├── cCSList.test.js       # 400 se id mancante, mapping campi
        └── data.test.js          # 400 se id mancante, plaDtoList
```

### Cosa viene testato

#### agendaSoa
- **index** – routing verso tutti i handler, fallback `httpMethod`, 400 per action sconosciuta/assente
- **agendaSOAClient** – costruttore, `_basicAuthHeader`, `_processResponse` (2xx/4xx/5xx), tutti i metodi pubblici (`appointment`, `availableHours`, `cCSList`, `data`, `getAvHoursForRec`), padding orari, mapping CCS, filtro slot occupati
- **clientFactory** – costruzione da env vars, override config
- **handlers** – merge parametri (queryString + body + params), 200/502/500, validazione parametri obbligatori

#### agendaSoaNaga
- **index** – routing `createnaga`/`updatenaga`, fallback `httpMethod`, 400 per action sconosciuta
- **agendaNagaClient** – `_basicAuthHeader`, `_processResponse`, `createnaga` (path/body), `updatenaga` (path con apptId, aggiunta `authUser`)
- **handlers** – parsing body, fallback su `params`, 400 se `apptId` mancante, 200/502/500, JSON non valido → 500

#### dms / jobcard / v360
- **httpClient** – parsing JSON/testo, concatenamento chunk, scrittura body, reject su errore di rete
- **authService** – cache valida (no HTTP call), cache scaduta/assente (rinnovo), scrittura cache, errore HTTP, `access_token` assente, `expires_in` default
- **dmsService / jobCardService / v360Service** – validazione parametri obbligatori, headers corretti (Authorization, IBM credentials, x-trace-id), query string/body, risposta 200, errori HTTP

