# HQ Manager — consumer REST interno

`HqManager` conserva validazioni, azioni pubbliche, orchestrazione e sequenza
dell'audit. `repository.js` è un adapter REST verso `dbmanager`: non importa
altre Lambda e non crea pool, neppure fittizi. SQL, pool e letture S3 sono
responsabilità del receiver.

## Contratto

Ogni funzione della repository chiama:

```js
await callService('dbmanager', operation, { args: [...originalArgsWithoutPool] });
```

Il trasporto condiviso `../serviceClient` restituisce il valore dominio
originale non wrappato e rigetta errori di trasporto/non-2xx. Le operazioni
mantengono i nomi della repository, inclusi `setPkMarketEnable` e
`setPkMarketDisable` (le azioni pubbliche restano `setMarketEnable` e
`setMarketDisable`). `getAnagSection` e `getAnagAllocation` non avevano pool:
entrambe inviano `{ args: [] }`.

`initializeOicPkList` chiama separatamente e in sequenza
`checkIsPkMarketEnabled(market)`, se necessario
`checkIsPkOicConfigured(market, oic)` e `copyDomainFromMarket(market, oic)`,
poi `getPackageList(market, oic)`. I loop di configurazione conservano la
sequenza scrittura/audit per elemento; una scrittura REST fallita interrompe
le operazioni successive, senza rollback client o errori nascosti.

`importAppConfiguration(market, fileContentBase64)` importa in blocco le
righe di configurazione di abilitazione WOC/firma digitale
(`woc.hq_application_enabling`) lette dalla prima sheet di un file Excel
(XLSX) ricevuto codificato in Base64: il parsing (libreria `xlsx`, build
ufficiale SheetJS da `cdn.sheetjs.com`, non dal registro npm — la versione
pubblicata su npm ha una vulnerabilità HIGH non risolta) avviene qui, dove
risiede il file; l'array di righe risultante viene poi inviato in un'unica
chiamata REST a `dbmanager` (`HqRepository.js::importAppConfiguration`), che
esegue l'intera importazione in una sola transazione (rollback totale se
anche una sola riga fallisce la validazione/l'upsert, es. colonna `oic`
mancante).

`exportAppConfiguration(market)` è l'operazione simmetrica: legge (in
un'unica chiamata REST, `HqRepository.js::getAppConfigurationList`) le righe
di configurazione di abilitazione WOC/firma digitale del mercato indicato,
ordinate per `oic`, le serializza qui in un foglio XLSX
(`XLSX.utils.json_to_sheet`) e restituisce il file come stringa Base64
(nessuna scrittura su filesystem: la Lambda non ha accesso al filesystem del
chiamante).

La risoluzione del nome audit e del mercato usa
`callService('session', 'getData', { args: [username] })`, senza importare
session. È best-effort: errori REST vengono esplicitamente loggati e il nome
ricade sull'identificativo tecnico, il mercato su `""`. Con un authorizer
presente l'identità è **solo** `authorizer.sub`: se manca non viene mai usato
`body.username`. Quest'ultimo è ammesso esclusivamente senza authorizer
(invocazione diretta/CLI).

Configurare `WOC_INTERNAL_API_URL`, `AWS_REGION` (o `AWS_DEFAULT_REGION`) e
facoltativamente `WOC_INTERNAL_TIMEOUT_MS` nel trasporto condiviso. Le route
private usano IAM SigV4 e la catena di credenziali AWS standard. Il consumer
non richiede credenziali PostgreSQL, DMS o Ping: `.env.example` contiene solo
configurazione REST e regione AWS. Nessun deploy è incluso.

Test: `npm run test:coverage -- --runInBand`.

## English

HQ uses a local REST repository adapter and shared `serviceClient`, not sibling
Lambda source or fake DB pools. Each call preserves the repository's exact
operation name and positional arguments minus the receiver-owned pool.
`getAnagSection`/`getAnagAllocation` send empty argument arrays. Domain
orchestration, per-item write/audit ordering and initialization decisions remain
unchanged; failed DB REST calls propagate and stop subsequent writes. Session
lookups use `session/getData` with `{ args: [username] }`; failures are logged
before intentional best-effort fallback. A present authorizer without `sub`
never permits body-provided identity. Public actions and responses are unchanged.

`importAppConfiguration(market, fileContentBase64)` bulk-imports WOC/digital
signature enabling rows (`woc.hq_application_enabling`) parsed from the first
sheet of a Base64-encoded Excel (XLSX) file (parsing happens locally via the
`xlsx` package, using SheetJS's own `cdn.sheetjs.com` build rather than the
npm registry release, which has an unresolved HIGH severity vulnerability);
the resulting row array is sent in a single REST call to `dbmanager`
(`HqRepository.js::importAppConfiguration`), which performs the whole import
in one transaction (full rollback if even a single row fails validation/upsert,
e.g. a missing `oic` column).

`exportAppConfiguration(market)` is the symmetric operation: it reads (in a
single REST call, `HqRepository.js::getAppConfigurationList`) the WOC/digital
signature enabling rows for the given market, ordered by `oic`, serializes
them locally into an XLSX sheet (`XLSX.utils.json_to_sheet`) and returns the
file as a Base64 string (no filesystem writes: the Lambda has no access to
the caller's filesystem).
