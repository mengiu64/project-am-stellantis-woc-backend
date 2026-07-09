# translations — Lambda per il recupero delle traduzioni

Lambda Node.js che espone il recupero dei file di traduzione tramite:

```
GET /translations?lang=en
```

Il file JSON viene letto da un bucket S3 al path `locales/{lang}/translation.json`
(es. `locales/en/translation.json`, `locales/it/translation.json`).

> ℹ️ In futuro la sorgente dei dati potrà essere sostituita da un database senza
> impattare l'handler HTTP: vedi la sezione [Architettura](#architettura).

## Struttura

```
translations/
├── index.js                              # Entry point Lambda + CLI
├── src/
│   ├── errors.js                         # TranslationNotFoundError
│   ├── repositoryFactory.js              # Composition root (punto unico da cambiare per passare a DB)
│   ├── repositories/
│   │   ├── TranslationsRepository.js     # Interfaccia astratta
│   │   └── S3TranslationsRepository.js   # Implementazione basata su S3 (attuale)
│   └── handlers/
│       └── translations.js               # Handler HTTP: risolve "lang" e chiama il repository
├── __tests__/                            # Test Jest (copertura ≥90%)
├── package.json
└── README.md
```

## Architettura

Per permettere in futuro di sostituire S3 con un database (come richiesto),
l'accesso ai dati è isolato dietro l'interfaccia `TranslationsRepository`
(`getTranslations(lang)`). L'handler HTTP (`src/handlers/translations.js`) non
conosce i dettagli implementativi: ottiene l'istanza da `repositoryFactory.js`,
l'unico punto da modificare quando si vorrà introdurre una
`DbTranslationsRepository` al posto di `S3TranslationsRepository`.

## Configurazione (variabili d'ambiente)

| Variabile                     | Descrizione                                             | Default    |
|--------------------------------|----------------------------------------------------------|------------|
| `TRANSLATIONS_BUCKET_NAME`     | Nome del bucket S3 con i file di traduzione               | *(nessuno, obbligatoria)* |
| `TRANSLATIONS_KEY_PREFIX`      | Prefisso della key S3 (`{prefix}/{lang}/translation.json`)| `locales`  |
| `TRANSLATIONS_DEFAULT_LANG`    | Lingua di default quando `lang` non è passato             | `en`       |

## Utilizzo (Lambda)

Invocazione diretta:

```json
{ "action": "translations", "queryStringParameters": { "lang": "en" } }
```

Tramite API Gateway (REST/HTTP API proxy):

```
GET /translations?lang=en
```

Risposte:
- `200` — JSON con le traduzioni.
- `404` — lingua non trovata nel bucket (`locales/{lang}/translation.json` assente).
- `502` — errore tecnico (es. bucket non raggiungibile).

## CLI

```bash
node index.js translations lang=en
```

## Test

```bash
npm install
npm test
npm run test:coverage
```

## Bucket S3

Il bucket (`s3-np-bsn0027990-${Environment}-translations`) viene creato dal
template SAM (`template.yaml`). Questa Lambda si limita a **leggere** il file
`locales/{lang}/translation.json` dal bucket e a restituirlo come JSON: il
caricamento/la gestione dei contenuti di traduzione nel bucket è a carico di
un altro processo, esterno a questa Lambda e alla sua pipeline CI/CD.
