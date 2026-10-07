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

## Errori

Risposta: `{ "success": false, "message": "...", "errorCode"?, "contextCode"?, "details"? }`.
Mai 401/403 (riservati all'auth di piattaforma). Mapping: input non valido → 400; `CUSTOMER_NOT_FOUND` → 404;
upstream 400/404/422 → stesso status; timeout → 504; altri errori upstream/auth/rete → 502; imprevisti → 500 (messaggio generico).

## Configurazione

| Variabile | Note |
|---|---|
| `WYZ_PARAM_NAME` | Parametro SSM (`/app/np-BSN0027990-<env>/wyz`, prod `/app/BSN0027990/wyz`) con l'ARN del secret |
| `DYNAMO_CACHE_TABLE_NAME` | Tabella cache token (`TmpCacheTable`) |

Secret Manager (`sm-np-bsn0027990-<env>-wyz`, prod `sm-bsn0027990-wyz`), JSON:

| Chiave | Obbligatoria | Default |
|---|---|---|
| `WYZ_IBM_CLIENT_ID` | sì | — (preprod: `wi-advisor`) |
| `WYZ_IBM_CLIENT_SECRET` | sì | — |
| `WYZ_BASE_URL` | no | `https://api-preprod.wyzexchange.com` |
| `WYZ_IAM_BASE_URL` | no | `https://preprod-iam.wyzexchange.com` |
| `WYZ_TENANT` | no | `STA` |

In locale, usare gli stessi nomi `WYZ_IBM_CLIENT_ID` e `WYZ_IBM_CLIENT_SECRET` nel file `.env` o nelle variabili d'ambiente.

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
