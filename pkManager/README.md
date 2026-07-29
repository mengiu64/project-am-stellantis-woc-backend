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
└── .env              ← credenziali WS (non committare)
```

Carica automaticamente i `.env` dei moduli fratello (`pkEper`, `pkDocsoa`, `pkMenupricing`) senza sovrascrivere variabili già definite.

## Setup

```bash
cd pkManager
cp .env.example .env   # se disponibile, altrimenti crea .env manualmente
# edita .env con i valori reali per tutti e tre i WS
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

Suite Jest con mock dei client `WsIQPckEper`, `DocSOARestClient`, `MenuPricingSoapClient` (coverage ≥90% branches/functions/lines/statements, come negli altri moduli `jobcard`/`dms`/`v360`).

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
# Configurazione statica (getConfigPackages)
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
| `getConfigPackages`       | `market` `pkwstouse`               | Configurazione statica: mappa `{ CATEGORY: [codici] }` per il ws indicato                          |
| `getValidPackages`        | `market` `pkwstouse` `VIN`         | Intersezione tra config e pacchetti live dal WS: `{ CATEGORY: { [codice]: obj } }`                 |
| `getValidPackagesDetail`  | `market` `pkwstouse` `VIN`         | Chiama `getValidPackages` poi recupera in parallelo il dettaglio di ogni pacchetto: `{ [codice]: detail }` |
| `getPriceAndAvailability` | `market` `pkwstouse` `VIN`         | Arricchisce il dettaglio di `getValidPackagesDetail` con `AV_LOCAL`/`PRICE`/`SCONTO` per ogni riga  |
| `getPkList`               | `market` `pkwstouse` `VIN`         | Orchestratore end-to-end: `getValidPackagesDetail` + `getPriceAndAvailability`, poi **normalizza** ogni pacchetto allo stesso set di chiavi (vedi sotto), a prescindere dal `pkwstouse` di origine |

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
