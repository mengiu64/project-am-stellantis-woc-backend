# pkManager – Node.js

Orchestratore Node.js che gestisce la **configurazione e la validazione dei pacchetti** su più web service (ePer, DocSOA, MenuPricing). Determina quali pacchetti configurati sono effettivamente disponibili per un VIN e ne recupera il dettaglio.

## Struttura

```
pkManager/
├── index.js          ← CLI entry-point (dispatcher per metodo)
├── test.js           ← smoke-test locale
├── PkManager.js       ← classe orchestratore
├── __tests__/
│   └── PkManager.test.js ← test automatici (Jest)
├── package.json
└── .env              ← configurazione locale (non committare)
```

Carica solo il proprio `.env`. Non importa codice né carica `.env` di altre
Lambda: tutte le integrazioni passano tramite `../serviceClient`, libreria
condivisa inclusa dal packaging (senza sorgenti delle Lambda sorelle).

## Integrazioni REST private

Le chiamate sono `POST /internal/<service>/<operation>` firmate IAM SigV4.
Configurare `WOC_INTERNAL_API_URL` (base HTTPS), `AWS_REGION` (oppure
`AWS_DEFAULT_REGION`) e, facoltativamente, `WOC_INTERNAL_TIMEOUT_MS`
(default 25000 ms). Le credenziali AWS provengono dalla provider chain/ruolo
Lambda; il ruolo deve avere `execute-api:Invoke` sulle sole rotte necessarie
e accesso di rete all'API privata.

| Servizio | Operazioni | Payload |
|----------|------------|---------|
| `dbmanager` | `getConfigPackages`, `getPkwstouse` | `{ args: [{ pkwstouse }] }`, `{ args: [{ codmarket, codbrand }] }` |
| `dms` | `resolveSender`, `inquiry` | `{ context: { username, vin }, overrides }`, corpo domain dell'inquiry |
| `pkeper` | `getCompletePkEperList`, `getPackageDetailsPR` | `{ params, config: { coddealer, codmarket } }` |
| `pkdocsoa` | `getCompletePkSOAList`, `ibxDetailForfaitService`, `ibxDetailtpService` | `{ params, config: {} }` |
| `pkmenupricing` | `getCompletePkMpList`, `getJobDetails` | `{ params, config: {} }` |

I parametri dei metodi sono invariati. Il client rimuove soltanto l'envelope
REST esterno `{ data }`: le risposte originali dei receiver (anche
`{ success, data, message }`) vengono interpretate qui come prima.
Token PingFederate e credenziali upstream restano esclusivamente nei receiver.
Non servono credenziali DB o upstream dei servizi remoti in questa Lambda.

Gli errori di trasporto/non-2xx si propagano; un errore di dettaglio resta
`{ error, category }` per il singolo pacchetto. `getPkList` conserva i pacchetti
se DMS fallisce e valorizza `dmlWarning`. La concorrenza dei dettagli è
controllata da `PK_DETAIL_FETCH_CONCURRENCY` (default 1).

Per il Sender, se l'evento ha un authorizer si usa solo `authorizer.sub`;
se manca `sub`, non si usa mai `body.username`. Il fallback al body è
ammesso esclusivamente senza authorizer (invocazione diretta/CLI).

## Setup

```bash
cd pkManager
cp .env.example .env   # se disponibile, altrimenti crea .env manualmente
# edita .env con endpoint REST privato, regione e override domain necessari
npm install
```

### Variabili d'ambiente

```
# ── ePer (FCA/Stellantis) ───────────────────────────────────────────
EPER_CODDEALER=
EPER_CODMARKET=
EPER_LINGUA=
# EPER_TICKET=

# ── DocSOA (PSA/Stellantis) ─────────────────────────────────────────
DOCSOA_CODBRAND=
DOCSOA_LDP=
DOCSOA_LANGUE=
DOCSOA_PAYS=
DOCSOA_CODEPDV=
# DOCSOA_TYPE_INTERNET=

# ── MenuPricing (Opel/Vauxhall) ─────────────────────────────────────
MP_LANGUAGE_CODE=
MP_COUNTRY_CODE=
MP_DEALER_IDENTIFICATION_CODE=
MP_MANUFACTURER=
```

## Test automatici

Suite Jest con mock di `../../serviceClient`, senza chiamate AWS/rete reali.
Verifica payload REST, parsing domain, errori remoti e identità
(coverage ≥90% branches/functions/lines/statements).

```bash
npm test               # esegue la suite Jest
npm run test:coverage  # esegue la suite con report di coverage (coverage/)
```

## Smoke-test locale

Lo script `test.js` è un tool manuale a riga di comando per verificare rapidamente le chiamate (non è la suite automatica).

```bash
npm run manual-test -- config eper
npm run manual-test -- config docsoa
npm run manual-test -- config menupricing 1000
npm run manual-test -- valid  eper         ZAC5JABL9PJK00363
npm run manual-test -- valid  docsoa       VF3CABHW6GT204366
npm run manual-test -- valid  menupricing  W0VZT6GT7M1017935
```

## Uso da CLI (index.js)

```bash
node index.js <metodo> [argomenti...]
```

Esempi:

```bash
# Configurazione pacchetti (getConfigPackages, letta da woc.config_packages)
node index.js pkwstouse eper
node index.js pkwstouse docsoa
node index.js pkwstouse menupricing 1000

# Pacchetti validi (intersezione config ↔ WS live)
node index.js getValidPackages eper         ZAC5JABL9PJK00363
node index.js getValidPackages docsoa       VF3CABHW6GT204366
node index.js getValidPackages menupricing  W0VZT6GT7M1017935 1000

# Dettaglio pacchetti validi (getValidPackages + chiamate dettaglio in parallelo)
node index.js getValidPackagesDetail eper         ZAC5JABL9PJK00363
node index.js getValidPackagesDetail docsoa       VF3CABHW6GT204366
node index.js getValidPackagesDetail menupricing  W0VZT6GT7M1017935 1000
```

## Metodi disponibili

| Metodo                    | Argomenti                          | Descrizione                                                                                         |
|---------------------------|------------------------------------|-----------------------------------------------------------------------------------------------------|
| `getConfigPackages`       | `pkwstouse`                        | Mappa `{ DEPARTMENT: [codici] }` per il ws indicato, letta da `woc.config_packages` tramite REST `dbmanager/getConfigPackages` |
| `getValidPackages`        | `market` `pkwstouse` `VIN`         | Intersezione tra config e pacchetti live dal WS: `{ CATEGORY: { [codice]: obj } }`                 |
| `getValidPackagesDetail`  | `market` `pkwstouse` `VIN`         | Chiama `getValidPackages` poi recupera in parallelo il dettaglio di ogni pacchetto: `{ [codice]: detail }` |
| `getPriceAndAvailability` | `documentId` `customerId` `vehicleId` `[market]` `[username]` | Interroga REST `dms/inquiry` (WL) usando `pkDetailList` e il Sender dinamico |
| `getPkList`               | `codbrand` `documentId` `customerId` `vehicleId` `[market]` `[dealerIdentificationCode]` `[username]` | Risolve `pkwstouse` da `HQ_PKCONFIG` tramite REST `dbmanager/getPkwstouse`, recupera dettagli e prezzo/disponibilità, arricchisce le righe con `AV_LOCAL`/`PRICE`/`SCONTO`, poi **normalizza** ogni pacchetto allo stesso set di chiavi (vedi sotto) |

### Metodi di dettaglio per ws

| `pkwstouse`    | Metodo di dettaglio chiamato                                                        |
|----------------|--------------------------------------------------------------------------------------|
| `eper`         | `WsIQPckEper.getPackageDetailsPR`                                                    |
| `menupricing`  | `MenuPricingSoapClient.getJobDetails`                                                |
| `docsoa`       | `DocSOARestClient.ibxDetailForfaitService`, con fallback a `ibxDetailtpService` (`getIbxDetailTp`) quando il forfait non viene trovato — usando `rowData.ref` come `refTp` (fallback su `code` solo se `ref` non è presente) |

### `isFixedPrice` / `packageType`

Ogni dettaglio pacchetto (da `getValidPackagesDetail` e `getPkList`) riporta questi due campi:

| `pkwstouse`    | `isFixedPrice`                                                                 | `packageType`                        |
|----------------|----------------------------------------------------------------------------------|---------------------------------------|
| `eper`         | sempre `"0"`                                                                     | sempre `"QE"`                        |
| `menupricing`  | `"1"` se prezzo fisso da promozione ("Lex"), altrimenti `"0"`                    | `"FP"` se `isFixedPrice==="1"`, altrimenti `"QE"` |
| `docsoa`       | `"1"` se trovato come forfait, `"0"` se trovato via fallback tempario (tp)       | `"FP"` se `isFixedPrice==="1"`, altrimenti `"QE"` |

### Normalizzazione `getPkList` (`_normalizePkDetail`)

A differenza di `getValidPackagesDetail` (shape "grezza", dipendente dal `pkwstouse`), ogni elemento restituito da `getPkList` viene normalizzato allo **stesso set di chiavi**:

```
{ result, codice, descrizione, pkPrice, isFixedPrice, packageType, niveau, listaOperazioni, listaRicambi, category }
```

In caso di errore nel recupero del dettaglio di un singolo pacchetto, l'elemento NON viene normalizzato e riporta invece `{ error, category }`. Nota: il campo `2DigitCode` (presente in alcune risposte grezze) viene volutamente scartato in fase di normalizzazione a favore di `niveau`.
