# pkFavorite

Lambda per la gestione dei pacchetti/forfait **preferiti** che il dealer marca su un
veicolo (VIN), tipicamente a partire dalla lista `UpSelling.Packages[]` restituita
dalla lambda `dms` (chiamata DJC/LFP).

Dati salvati in Aurora PostgreSQL (database `wiadvisor`), tabella `PKFAVORITE`
(vedi `sql/create_tables.sql`):

| Colonna        | Descrizione                                                         |
|----------------|----------------------------------------------------------------------|
| `ID`           | Identificativo univoco (auto-incrementale)                          |
| `USERNAME`     | Username del dealer (**sempre** da `event.requestContext.authorizer.sub`) |
| `VIN`          | VIN del veicolo                                                     |
| `PACKAGE_CODE` | Codice del pacchetto (`UpSelling.Packages[].Code`)                   |
| `CREATED_AT`   | Data/ora di creazione                                                |

Vincolo `UNIQUE(USERNAME, VIN, PACKAGE_CODE)`: non possono esistere due righe
identiche per lo stesso dealer/veicolo/pacchetto.

## Operazioni esposte

### GET — elenco preferiti

Elenca **tutti** i codici pacchetto preferiti del dealer autenticato (ricerca
per solo `USERNAME`, indipendentemente dal VIN); il `vin` passato in query
viene usato solo per arricchire ciascun preferito con i dati DML.

```
GET /api/pkfavorite?vin=VF3CABHW6GT204366
```

Risposta:

```json
{
  "success": true,
  "username": "0062230.d001",
  "vin": "VF3CABHW6GT204366",
  "favorites": [
    { "package": "42001AER01FR0201", "createdAt": "2026-01-01T09:00:00.000Z" }
  ]
}
```

### POST — toggle preferito (crea o elimina)

Se il pacchetto **non** è già tra i preferiti (per quel dealer+VIN) lo crea
(`action: "added"`); se è già presente lo elimina (`action: "removed"`).

```
POST /api/pkfavorite
Content-Type: application/json

{ "vin": "VF3CABHW6GT204366", "package": "42001AER01FR0201" }
```

Risposta (creazione):

```json
{ "success": true, "username": "0062230.d001", "vin": "VF3CABHW6GT204366", "package": "42001AER01FR0201", "action": "added", "id": 1, "createdAt": "2026-01-01T09:00:00.000Z" }
```

Risposta (rimozione, stessa chiamata ripetuta):

```json
{ "success": true, "username": "0062230.d001", "vin": "VF3CABHW6GT204366", "package": "42001AER01FR0201", "action": "removed" }
```

## Identità del dealer (`username`)

Come in `session/src/index.js`, l'identità arriva **sempre** da
`event.requestContext.authorizer.sub` (Lambda Authorizer), mai da un valore
fornito dal chiamante: un client potrebbe altrimenti passare uno username
diverso dal proprio e leggere/modificare i preferiti di un altro dealer.
Se l'evento non ha `requestContext.authorizer` (invocazione diretta Lambda o
CLI di test), si accetta un `username` passato esplicitamente, solo per
comodità di test locali.

Se `authorizer.sub` è mancante nella richiesta reale, la lambda risponde `401`.

## Database (Aurora PostgreSQL via RDS Proxy)

- Host: endpoint dell'**RDS Proxy** (non l'endpoint diretto del cluster Aurora),
  per beneficiare del pooling di connessioni condiviso tra le invocazioni Lambda.
- Credenziali: utente applicativo least-privilege `wiadvisor_app`, lette da
  AWS Secrets Manager tramite la AWS Parameters and Secrets Lambda Extension
  (stesso meccanismo già usato da `myPeople`/`pkDocsoa`/`session`).
- Vedi `template.yaml` (`PkFavoriteFunction`) per le variabili d'ambiente e la
  policy IAM (`secretsmanager:GetSecretValue` sul secret `PkFavoriteDbSecretId`).

## CLI (test locale)

```
node index.js list   <username> <vin>
node index.js toggle <username> <vin> <packageCode>
```

Richiede un file `.env` (vedi `.env.example`) con `PKFAVORITE_DB_HOST` e, se non
si vuole passare da Secrets Manager/estensione Lambda, anche
`PKFAVORITE_DB_USER`/`PKFAVORITE_DB_PASSWORD` diretti.

## Test

```
npm test
```
