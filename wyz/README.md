# wyz

Lambda wrapper REST verso il servizio esterno **Wyz – Tyre search** (OAuth2 `client_credentials` su IAM Keycloak).
Stessa architettura di `moparDoc` (`index.js` → `wyzService.js` → `authService.js`/`httpClient.js`, `config.js` + `secretsLoader.js`,
cache token su DynamoDB `TmpCacheTable`).

## Azioni

L'azione è l'ultimo segmento del path (es. `/api/wyz/searchQuote`) oppure `event.action`.

### `getSearchFilters` (GET con query string, oppure POST con body JSON)

Chiama in parallelo `vehicle-brands`, `vehicle-types`, `brands`, `seasons` e restituisce un unico oggetto normalizzato per le dropdown.

Input: `customerRrdiCode` (string, obbligatorio), `hubCode` (string, obbligatorio) — inoltrati come query parameter agli endpoint `brands` e `vehicle-types`.

```json
{
  "success": true,
  "filters": {
    "vehicleBrands":     [{ "id": "uuid", "name": "Fiat" }],
    "vehicleTypes":      [{ "id": "uuid", "name": "TO", "groupId": "uuid", "groupName": "TC4" }],
    "vehicleTypeGroups": [{ "id": "uuid", "name": "TC4", "types": [{ "id": "uuid", "name": "TO" }] }],
    "tyreBrands":        [{ "id": "uuid", "name": "Continental", "segment": "PREMIUM", "rank": 1 }],
    "seasons":           [{ "id": "uuid", "name": "Ete", "i18nKey": "season.summer" }]
  }
}
```

- `tyreBrands` è ordinato per `rank`.
- Se **anche una sola** delle 4 chiamate fallisce, l'azione fallisce: status della prima chiamata fallita (mapping sotto) e
  `details.failedCalls: [{ call, status, message, errorCode? }]` con tutte le chiamate fallite.

### `searchQuote` (POST, body JSON)

Chiama `POST /api/tyres/search/quote`. Risposta: `{ "success": true, "data": { "items": [...] } }`.

Obbligatori: `customerRrdiCode`, `hubCode`, `width`, `height`, `diameter` (numeri > 0), `quantity` (intero ≥ 1),
`vehicleTypes` e `vehicleBrands` (array non vuoti, UUID da `getSearchFilters`).
Opzionali: `loadIndexes`, `speedIndexes`, `seasons`, `brands`, `runFlat`. Altri campi sono scartati.

Post-elaborazione: gli item con `tyre.status === 'EMPTY_STOCK'` sono rimossi; per gli altri, `tyre` viene arricchito
con `wyzPrice` (stock `Hub` prevale su `Tyre producer`; `sellingPrice` vuoto → `bf`), `StockPrixBuyingPrice`
(`priceTTC` di `getStockPrix`), `maxAllowableDiscount` (`max(0, StockPrixBuyingPrice - wyzPrice)`) e `availability`
(primo `BinLocation.QuantityAvailable` da `dms/inquiry`), tutti `null` se il dato non è disponibile. Dati sessione
(`session/getData`, `getContext`) letti via REST interno con `username = authorizer.sub` (il body è ammesso solo
senza authorizer). Dealer, header DMS e VIN di `getStockPrix`/`inquiry` sono temporaneamente fissi.

### `getStockPrix` (POST, body JSON)

Wrapper dell'operazione SOAP `getStockPrixKBRW` di **StockPrixService** (Panier SOA PSA): stock e prezzi dei ricambi per dealer.
A differenza delle altre azioni richiede **mutual TLS**: certificato e chiave client sono gli stessi secret di `agendaSoa`
(`sm-np-bsn0027990-<env>-apic-cert` / `-apic-key`), letti tramite il layer AWS Parameters and Secrets Lambda Extension;
Basic Auth, `client_id`, URL dell'endpoint e porta della Extension (default 2773) sono nel secret wyz.

| Ambiente | Valore di `WYZ_STOCKPRIX_BASE_URL` nel secret |
|---|---|
| dev / stage | `https://api-cert-preprod.groupe-psa.com` |
| prod | `https://api-cert.groupe-psa.com` |

Il metodo aggiunge il path SOAP del gateway: `/api/cert-aai/applications/panier-soa/ws/StockPrixService/v1` in dev/stage e `/applications/panier-soa/ws/StockPrixService/v1` in prod.

Input:

| Campo | Obbligatorio | Note |
|---|---|---|
| `customerDMSHeader` | sì | 2-40 caratteri `[0-9A-Za-z-]` |
| `country` | sì | ISO alpha-2 (es. `FR`) |
| `brand` | sì | 2 caratteri (es. `AC`, `AP`, `DS`, `OV`) |
| `vin` | no | 17 caratteri alfanumerici |
| `partLines` | sì | 1..100 righe `{ partReference, quantity, partReferenceManfacture?, triGramManfacture?, idManufacturer? }`, `quantity` intero ≥ 1 |
| `dealerId` | sì | Inviato dal client; 7-10 caratteri alfanumerici (`[0-9A-Za-z]`), come richiesto dall'XSD StockPrixService |

Risposta:

```json
{
  "success": true,
  "data": {
    "items": [
      { "partReference": "00001109AK", "inStockQuantity": 0, "priceHT": 13.734, "priceTTC": 16.62,
        "discountPercent": 40, "availabilityStatus": "NON_DISPO", "discountCodePanier": "N" }
    ]
  }
}
```

Mapping dei campi SOAP: `inStockqt` → `inStockQuantity`, `remise` → `discountPercent`, `statusOfAvailibilityDMS` → `availabilityStatus`.

Errori specifici: input non valido o `dealerId` assente/non conforme → 400; dealer sconosciuto (`UNKNOWN_DEALER`) → 404;
SOAP Fault `Client` (`INVALID_REQUEST`) → 422; fault del gateway IBM, es. credenziali/certificato rifiutati (`GATEWAY_FAULT`),
handshake TLS fallito (`TLS_HANDSHAKE_FAILED`) o fault server → 502; timeout → 504; secret/certificato non configurati → 500.

## Errori

Risposta: `{ "success": false, "message": "...", "errorCode"?, "contextCode"?, "details"? }`.
Mai 401/403 (riservati all'auth di piattaforma). Mapping: input non valido → 400; `CUSTOMER_NOT_FOUND` → 404;
upstream 400/404/422 → stesso status; timeout → 504; altri errori upstream/auth/rete → 502; imprevisti → 500 (messaggio generico).

## Configurazione

| Variabile | Note |
|---|---|
| `WYZ_PARAM_NAME` | Parametro SSM (`/app/np-BSN0027990-<env>/wyz`, prod `/app/BSN0027990/wyz`) con l'ARN del secret |
| `DYNAMO_CACHE_TABLE_NAME` | Tabella cache token (`TmpCacheTable`) |
| `WYZ_CERT_SECRET_ID` / `WYZ_KEY_SECRET_ID` | Secret mTLS `sm-np-bsn0027990-<env>-apic-cert` / `-apic-key` |

Secret Manager (`sm-np-bsn0027990-<env>-wyz`, prod `sm-bsn0027990-wyz`), JSON:

| Chiave | Obbligatoria | Default |
|---|---|---|
| `WYZ_IBM_CLIENT_ID` | sì | — (preprod: `wi-advisor`) |
| `WYZ_IBM_CLIENT_SECRET` | sì | — |
| `WYZ_BASE_URL` | no | `https://api-preprod.wyzexchange.com` |
| `WYZ_IAM_BASE_URL` | no | `https://preprod-iam.wyzexchange.com` |
| `WYZ_TENANT` | no | `STA` |
| `STOCKPRIX_USERNAME` | solo per `getStockPrix` | — (Basic Auth Panier SOA) |
| `STOCKPRIX_PASSWORD` | solo per `getStockPrix` | — |
| `STOCKPRIX_CLIENT_ID` | solo per `getStockPrix` | — (`client_id` IBM API Connect, diverso tra preprod e prod) |
| `WYZ_STOCKPRIX_BASE_URL` | solo per `getStockPrix` | — (base URL per ambiente, v. tabella sopra) |
| `WYZ_STOCKPRIX_HTTP_PORT` | no | `2773` (porta della Secrets Extension) |

In locale, usare gli stessi nomi `WYZ_IBM_CLIENT_ID` e `WYZ_IBM_CLIENT_SECRET` nel file `.env` o nelle variabili d'ambiente.
Per `getStockPrix` in locale valorizzare anche `STOCKPRIX_*`, `WYZ_STOCKPRIX_BASE_URL`, `WYZ_STOCKPRIX_HTTP_PORT` e i percorsi dei file PEM `WYZ_CERT_FILE` / `WYZ_KEY_FILE`.

In **stage/prod** impostare gli URL/tenant di produzione nel secret. Parametro SSM e secret vanno creati fuori banda.
Il parametro `partner=WIADVISOR` è aggiunto dalla lambda; `X-Correlation-Id` = `requestContext.requestId`.

## Eventi di test nella console AWS Lambda

Creare eventi di test nella console Lambda usando il contenuto dei JSON in `events/`.
Sono invocazioni dirette, senza simulare API Gateway e senza credenziali nel payload.

| Evento | Esito atteso |
|---|---|
| [getSearchFilters.json](events/getSearchFilters.json) | `statusCode: 200`, `success: true`, `filters` |
| [searchQuote.json](events/searchQuote.json) | `statusCode: 200`, `success: true`, `data` |
| [getSearchFilters-missingHubCode.json](events/getSearchFilters-missingHubCode.json) | `statusCode: 400`, campo `hubCode` mancante |
| [searchQuote-invalidQuantity.json](events/searchQuote-invalidQuantity.json) | `statusCode: 400`, `quantity` non valida |
| [getStockPrix.json](events/getStockPrix.json) | `statusCode: 200`, `success: true`, `data.items` |
| [getStockPrix-emptyPartLines.json](events/getStockPrix-emptyPartLines.json) | `statusCode: 400`, `partLines` vuoto |

Per i test positivi sostituire `REPLACE_WITH_CUSTOMER_RRDI_CODE` e `REPLACE_WITH_HUB_CODE`
con valori validi dell'ambiente Wyz. Eseguire prima `getSearchFilters`, poi usare gli ID
di `filters.vehicleTypes` e `filters.vehicleBrands` al posto di `REPLACE_WITH_VEHICLE_TYPE_ID`
e `REPLACE_WITH_VEHICLE_BRAND_ID` in `searchQuote`. Gli esiti positivi richiedono secret,
permessi AWS e connettivita verso Wyz correttamente configurati.
I due eventi negativi vengono rifiutati prima di chiamare Wyz e non richiedono la sostituzione dei segnaposto.
Controllare `statusCode` e il JSON nella stringa `body`: l'esecuzione Lambda puo risultare riuscita anche per risposte HTTP 400.

## Sviluppo

```bash
npm ci && npm run test:coverage   # soglia 90%
cp .env.example .env              # esecuzione locale
node index.js getSearchFilters payload.json
```
