# pkManager – Node.js

Orchestratore Node.js che gestisce la **configurazione e la validazione dei pacchetti** su più web service (ePer, DocSOA, MenuPricing). Determina quali pacchetti configurati sono effettivamente disponibili per un VIN e ne recupera il dettaglio.

## Struttura

```
pkManager/
├── index.js       ← CLI entry-point (dispatcher per metodo)
├── test.js        ← smoke-test locale
├── PkManager.js   ← classe orchestratore
├── package.json
└── .env           ← credenziali WS (non committare)
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

## Smoke-test locale

```bash
node test.js config eper
node test.js config docsoa
node test.js config menupricing 1000
node test.js valid  eper         ZAC5JABL9PJK00363
node test.js valid  docsoa       VF3CABHW6GT204366
node test.js valid  menupricing  W0VZT6GT7M1017935
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

### Metodi di dettaglio per ws

| `pkwstouse`    | Metodo di dettaglio chiamato              |
|----------------|-------------------------------------------|
| `eper`         | `WsIQPckEper.getPackageDetailsPR`         |
| `menupricing`  | `MenuPricingSoapClient.getJobDetails`     |
| `docsoa`       | `DocSOARestClient.ibxDetailForfaitService`|
