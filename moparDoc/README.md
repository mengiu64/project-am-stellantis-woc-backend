# moparDoc — Node.js MoparDoc / Job-Docs Connector client

Modulo Node.js autoconsistente che espone 3 azioni verso due gateway Stellantis/FCA
per la gestione della documentazione allegata alle job card (Mopar):

- **`createJobCard`** — crea una job card sul connector `job-docs` (PSA):
  `POST https://api-oidc-preprod.groupe-psa.com/job-docs/connector/v1/CreateJobCard`
- **`getUploadDocURL`** — richiede una URL pre-firmata per l'upload di un documento
  sul MoparDocs Browser API (FCA/Fiat):
  `POST https://lab-examaftersales.fiat.com/Mopardocs/MoparDocsApi/Browser/getUploadDocURL`
- **`uploadedDoc`** — notifica il completamento dell'upload di un documento:
  `POST https://lab-examaftersales.fiat.com/Mopardocs/MoparDocsApi/Browser/UploadedDoc`

Tutte e tre le chiamate usano lo stesso **Bearer token PingFederate** (stesso host/scope
`prd:dgt` di `jobcard`/`djc`, ma con un **client PingFederate dedicato** — client_id/secret
diversi, non condivisi) e le stesse credenziali **IBM API Connect** (`X-IBM-Client-Id` /
`X-IBM-Client-Secret`).

## Struttura

```
moparDoc/
├── index.js             ← CLI entry-point + Lambda handler (dispatcher per azione)
├── moparDocService.js    ← createJobCard / getUploadDocURL / uploadedDoc
├── authService.js        ← autenticazione PingFederate → token (client dedicato MoparDoc)
├── httpClient.js         ← wrapper HTTPS generico (redazione dati sensibili nei log)
├── config.js              ← credenziali/URL (PingFederate + job-docs + MoparDocs Browser API)
├── __tests__/
│   ├── moparDocService.test.js
│   ├── authService.test.js
│   ├── httpClient.test.js
│   └── index.test.js
├── package.json
├── .env.example           ← template variabili d'ambiente
└── .env                    ← configurazione locale (non committare)
```

## Setup

```bash
cd moparDoc
npm install
cp .env.example .env   # valorizzare con le credenziali reali
```

## Variabili d'ambiente

| Variabile                      | Descrizione                                                        |
|---------------------------------|----------------------------------------------------------------------|
| `MOPARDOC_PING_CLIENT_ID`       | Client id PingFederate dedicato a moparDoc (scope `prd:dgt`)         |
| `MOPARDOC_PING_CLIENT_SECRET`   | Client secret PingFederate dedicato a moparDoc                       |
| `MOPARDOC_IBM_CLIENT_ID`        | `X-IBM-Client-Id` (job-docs connector + MoparDocs Browser API)       |
| `MOPARDOC_IBM_CLIENT_SECRET`    | `X-IBM-Client-Secret` (job-docs connector + MoparDocs Browser API)   |

URL/basePath di PingFederate, job-docs e MoparDocs Browser API sono **hardcoded** in
`config.js` (stessa convenzione di `jobcard`/`djc`/`v360`) e non richiedono configurazione.

## API contract (Lambda handler)

L'azione è risolta da `event.action` (invocazione diretta) oppure dall'ultimo segmento
del path (integrazione API Gateway, es. `.../moparDoc/createJobCard`).

### `createJobCard`

```json
{
  "action": "createJobCard",
  "body": {
    "vin": "VF3CABHW6GT204366",
    "market": "IT",
    "source": "WOC",
    "UserName": "mario.rossi",
    "dealerCode": "0062230",
    "JobCard_Title": "Tagliando 30.000km",
    "TAMAccessCode": "ACC123"
  }
}
```

### `getUploadDocURL`

```json
{
  "action": "getUploadDocURL",
  "body": {
    "JobCardId": "JC123456",
    "Filename": "fattura.pdf",
    "ContentType": "application/pdf",
    "AccessToken": "eyJhbGciOi...",
    "Filetype": "pdf"
  }
}
```

### `uploadedDoc`

```json
{
  "action": "uploadedDoc",
  "body": {
    "JobCardId": "JC123456",
    "DocumentId": "DOC987654",
    "Action": "confirm",
    "AccessToken": "eyJhbGciOi..."
  }
}
```

Risposta: `200` con il body upstream (JSON) in caso di successo; `400` se manca un
campo obbligatorio; `502` per errori upstream/di rete.

## CLI

```bash
node index.js createJobCard   ./payload-createJobCard.json
node index.js getUploadDocURL ./payload-getUploadDocURL.json
node index.js uploadedDoc     ./payload-uploadedDoc.json
```

## Test

```bash
npm test              # jest
npm run test:coverage # jest --coverage (soglia globale 90%)
```
