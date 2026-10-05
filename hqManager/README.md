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
