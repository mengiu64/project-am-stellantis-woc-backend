# pkDocsoa — Node.js client per DocSOARestClient (DocSOA Stellantis PSA)

Client Node.js autoconsistente che replica le chiamate del servizio REST `DocSOA` (pacchetti manutenzione/forfait PSA), originariamente implementato in PHP, tramite richieste SOAP-over-HTTP incapsulate in `axios`.

## Struttura

```
pkDocsoa/
├── DocSOARestClient.js   # Classe principale + helper vinParts (scomposizione VIN)
├── index.js              # Lambda entry-point + demo CLI (node index.js)
├── test.js                # CLI di test per singola chiamata a riga di comando
├── __tests__/             # Test Jest
└── package.json
```

## Installazione

```bash
cd pkDocsoa
npm install
```

## Configurazione

I parametri di connessione e le credenziali vanno impostati in un file `.env` (non committare):

| Variabile | Descrizione |
|---|---|
| `DOCSOA_HOST` | Base URL del servizio DocSOA (es. `https://api.inetpsa.com`) |
| `DOCSOA_USERNAME` | Username di autenticazione |
| `DOCSOA_PASSWORD` | Password di autenticazione |
| `DOCSOA_CLIENT_ID` | Client ID applicativo |
| `PROXY_HOST` | (opzionale) Host proxy HTTP |
| `PROXY_PORT` | (opzionale) Porta proxy HTTP (default `8080`) |
| `VIN` | VIN di test usato da `index.js`/`test.js` quando non passato da CLI |
| `LANGUE` | Lingua di test (es. `fr`) |
| `PAYS` | Paese di test (es. `FR`) |
| `MARQUE` | Marca di test (es. `AP`) |
| `CODPDV` | Codice punto vendita di test |
| `LCDV` | LCDV di test (i primi 4 caratteri sono usati come `ldp`) |
| `FONCTION_ID_LISTE` | Lista `id` funzione separati da virgola (test) |
| `TYPE_INTERNET` | Tipo internet (test) |
| `CODE_FF` | Codice forfait di default per `ibxDetailForfaitService` |
| `REF_TP` | Riferimento TP di default per `ibxDetailtpService` |
| `TYPEDOC` | Lista tipi documento separati da virgola (test) |

## Utilizzo (libreria)

```js
const { DocSOARestClient, vinParts } = require('./DocSOARestClient');

const client = new DocSOARestClient();

// 1. Lista funzioni disponibili per VIN
const functions = await client.functionsService({ langue: 'fr', pays: 'FR', marque: 'AP', mode: 'MODE_XML', typedoc: ['4'], ...vinParts(VIN) });

// 2. Lista forfait (pacchetti)
const forfaits = await client.forfaitService({ langue: 'fr', pays: 'FR', marque: 'AP', mode: 'MODE_XML', codePdv, ldp, fonctionIdListe, ...vinParts(VIN) });

// 3. Dettaglio di un forfait
const detail = await client.ibxDetailForfaitService({ langue: 'fr', pays: 'FR', marque: 'AP', mode: 'MODE_XML', codePdv, codeFF: 'FF123456', ...vinParts(VIN) });

// 4. Parametraggio IBX
const params = await client.ibxParametrageService({ langue: 'fr', pays: 'FR', marque: 'AP', mode: 'MODE_XML', FonctionIdListe: fonctionIdListe, ...vinParts(VIN) });

// 5. Dettaglio tempario (tp)
const tp = await client.ibxDetailtpService({ langue: 'fr', pays: 'FR', marque: 'AP', mode: 'MODE_XML', codePdv, refTp: 'TP789', ...vinParts(VIN) });
```

## Test da console (`test.js`)

Chiamata singola a riga di comando: i parametri base (`VIN`, `LANGUE`, `PAYS`, `MARQUE`, ecc.) sono letti dal `.env`, alcuni metodi accettano un argomento CLI aggiuntivo.

```bash
node test.js functionsService
node test.js forfaitService
node test.js ibxDetailForfaitService FF123456
node test.js ibxParametrageService
node test.js ibxDetailtpService TP789
```

Debug delle chiamate SOAP grezze:
```bash
DEBUG_SOAP=1 node test.js functionsService
```

## Demo rapida (`index.js`)

```bash
node index.js
```
Esegue una chiamata di esempio a `functionsService` usando i valori da `.env`.

## Uso come Lambda

Il file `index.js` espone `exports.handler`, che instrada l'evento in base al campo `action`:

```json
{
  "action": "functionsService | forfaitService | ibxDetailForfaitService | ibxParametrageService | ibxDetailtpService",
  "body": { "vin": "VF3CABHW6GT204366", "langue": "fr", "pays": "FR", "marque": "AP" }
}
```

Se `body.vin` è presente, viene automaticamente arricchito con `vinParts(vin)` (scomposizione VIN nei campi richiesti dal servizio).

## Test automatici

```bash
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```
