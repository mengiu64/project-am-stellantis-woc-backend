# wyz

Lambda wrapper REST verso il servizio esterno **Wyz – Tyre search** (OAuth2 `client_credentials` su IAM Keycloak).
Stessa architettura di `moparDoc` (`index.js` → `wyzService.js` → `authService.js`/`httpClient.js`, `config.js` + `secretsLoader.js`,
cache token su DynamoDB `TmpCacheTable`).

## Azioni

L'azione è l'ultimo segmento del path (es. `/api/wyz/searchQuote`) oppure `event.action`.

### `getSearchFilters` (GET con query string, oppure POST con body JSON)

Chiama in parallelo `vehicle-brands`, `vehicle-types`, `brands`, `seasons` e restituisce un unico oggetto normalizzato per le dropdown.

Input: `customerRrdiCode` (string, obbligatorio), `hubCode` (string, obbligatorio) — usati dall'endpoint `brands`.

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
| `WYZ_CLIENT_ID` | sì | — (preprod: `wi-advisor`) |
| `WYZ_CLIENT_SECRET` | sì | — |
| `WYZ_BASE_URL` | no | `https://api-preprod.wyzexchange.com` |
| `WYZ_IAM_BASE_URL` | no | `https://preprod-iam.wyzexchange.com` |
| `WYZ_TENANT` | no | `STA` |

In **stage/prod** impostare gli URL/tenant di produzione nel secret. Parametro SSM e secret vanno creati fuori banda.
Il parametro `partner=WIADVISOR` è aggiunto dalla lambda; `X-Correlation-Id` = `requestContext.requestId`.

## Sviluppo

```bash
npm ci && npm run test:coverage   # soglia 90%
cp .env.example .env              # esecuzione locale
node index.js getSearchFilters payload.json
```
