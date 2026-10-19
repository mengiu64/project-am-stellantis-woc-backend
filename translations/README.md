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
| `TRANSLATIONS_DEFAULT_LANG`    | Lingua di default quando `lang` non è passato **e usata come fallback quando il file della lingua richiesta non esiste su S3** | `en`       |

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
- `200` — JSON con le traduzioni. Se il file `locales/{lang}/translation.json`
  non esiste per la lingua richiesta, viene effettuato automaticamente un
  **fallback su `TRANSLATIONS_DEFAULT_LANG`** (`en` di default) e la risposta
  resta comunque `200` con le traduzioni inglesi.
- `404` — lingua non trovata nel bucket **e** non trovata nemmeno la lingua di
  fallback (`locales/{lang}/translation.json` assente per entrambe).
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

## Import S3 → Aurora e API su database (woc.translations)

### 1. Import (evento S3, nessuna rotta HTTP)
Trigger: `s3:ObjectCreated:*` (upload o sovrascrittura) su `locales/en/translation.json` del bucket
`s3-np-bsn0027990-<env>-translations`. Il codice accetta solo il bucket configurato e la chiave esatta.

- Il JSON annidato viene appiattito. `path` è dato dalle chiavi unite con `.`, `context` è il primo segmento e `language` vale `en`.
- Per ogni voce `en` vengono create 4 righe (`de`, `it`, `es`, `fr`) con lo stesso `path`/`context` e `translation = [path]`.
- L'upsert avviene in un'unica transazione su `(path, language)`. Per `en` aggiorna testo e contesto. Per le altre lingue **non sovrascrive** una traduzione già presente.
- **Nessuna DELETE**: le voci tolte dal file restano nel DB.
- In caso di errore: log strutturato, rollback e rilancio dell'eccezione (retry asincroni di Lambda).

### 2. `GET .../by-language?language=en`
`language` è obbligatorio. Restituisce il JSON ricostruito con la stessa struttura di `translation.json`.
Errori: 400 (input), 404 (nessun record), 500 (errore interno).

### 3. `GET .../search?path=&language=&context=` (o body JSON)
Serve almeno un filtro; i filtri sono combinati in AND. `path` corrisponde al path esatto o al sottoalbero
(es. `shell.layout`). Se il risultato contiene una sola lingua restituisce il JSON annidato,
altrimenti `{ "<lingua>": { ... } }`. Errori: 400 (input), 404 (nessun record), 500 (errore interno).

Routing: ultimo segmento del path (`by-language`, `search`) oppure `event.action`.

### Variabili aggiuntive
| Variabile | Descrizione |
|---|---|
| `DB_SECRET_ARN_PARAM` / `RDS_PROXY_ENDPOINT_PARAM` | Parametri SSM con l'ARN del secret e l'endpoint di RDS Proxy (vedi `shared/dbClient.js`) |
| `TRANSLATIONS_S3_READ_VERSION` | `true` (default): legge la versione S3 indicata dall'evento |
| `DB_LOCAL_MODE`, `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | Solo per lo sviluppo locale |

CLI: `node index.js by-language language=en` · `node index.js search context=shell language=it`
