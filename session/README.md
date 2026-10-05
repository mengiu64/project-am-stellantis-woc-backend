# Session — consumer REST interno

La risposta pubblica e gli override iniettabili di `MyPeopleDmsSessionRepository`
e `resolveHqMarketsList` restano invariati. Non sono importati moduli di altre
Lambda e non vengono creati pool PostgreSQL: il trasporto condiviso
`serviceClient` chiama route REST private, autenticate IAM SigV4.

Configurare `WOC_INTERNAL_API_URL`, `AWS_REGION` (oppure `AWS_DEFAULT_REGION`) e,
facoltativamente, `WOC_INTERNAL_TIMEOUT_MS` nel trasporto condiviso. Le credenziali
IAM provengono dalla catena AWS standard; non sono necessarie credenziali DB o
myPeople in questo consumer. `.env.example` mantiene solo le impostazioni REST,
S3 e cache DynamoDB proprie di session. Nessuna modifica infrastrutturale/deploy
è inclusa.

## Contratto

`await callService(service, operation, { args: [...] })` restituisce direttamente
il valore dominio originale, senza wrapper HTTP; rigetta errori di trasporto e
risposte non-2xx. Gli argomenti conservano ordine e forma delle funzioni originali,
escluso il pool posseduto dal receiver.

| Servizio | Operazione | `args` |
| --- | --- | --- |
| `mypeople` | `readUserProfiles` | `[{ username }]` |
| `dmlconfigsync` | `getDmsSettings`, `registerDealer` | `[{ country, brand, dealer }]` |
| `dmlconfigsync` | `getDmlConfiguration` | `[{ country, language }]` |
| `dbmanager` | `getCountryIsoCode` | `[{ market }]` |
| `dbmanager` | `getPhysicalSiteAndPdvId` | `[{ mainSincom, market, brand, oic }]` |
| `dbmanager` | `getBrandsByOics`, `getAddressByOics` | `[{ oics }]` |
| `dbmanager` | `getDisabledOics`, `getEnableSignatureByOics` | `[[{ market, oic }, ...]]` |
| `dbmanager` | `getBrandLogos` | `[{ codes }]` |
| `dbmanager` | `getMarkets` | `[]` (HQ centrale) oppure `[{ markets: [market] }]` (HQ mercato) |

La firma originale myPeople è `readUserProfiles(params = {})`, non una stringa
username. Sul wire JSON le letture brand/indirizzi/firma restituiscono array di
entry `[key, value]`, le disabilitazioni un array di valori `"market|oic"`.
I quattro loader REST ricostruiscono rispettivamente `Map` e `Set` prima
dell'orchestrazione; gli override iniettati mantengono i tipi nativi. `getBrandLogos`
restituisce un oggetto `codbrand -> logo_s3_key`, senza loghi null/vuoti; query e
filtri appartengono esclusivamente al receiver dbmanager.

## Errori e cache

Gli errori myPeople si propagano. Le letture di arricchimento e cache DML
conservano la degradazione intenzionale con log: liste vuote, valori null e
impostazioni DMS di default non bloccano la sessione. Solo un cache-miss DMS
registra il dealer; la registrazione è attesa prima della risposta e un suo
errore viene loggato senza bloccarla. Un errore di lettura DMS non viene trattato
come cache-miss e non registra il dealer.

`session/internal.js` (receiver distinto dal consumer pubblico) espone `getData`
e `getContext` usando la cache locale di sessione; questi contratti sono
`{ args: [username] }`. `src/index.js` instrada prima le richieste `/internal/`
al receiver; quest'ultimo usa direttamente la cache locale e non richiama il
dispatcher pubblico. Le richieste pubbliche conservano la validazione authorizer.

Test: `npm run test:coverage -- --runInBand`.

## English

Session consumes private IAM SigV4 REST routes through shared `serviceClient`,
never sibling Lambda source or DB pools. The table specifies exact operation
names and positional payloads (original function arguments minus the pool).
The transport returns the unwrapped value and rejects transport/non-2xx
failures. The four collection receivers encode Maps as entry arrays and Sets as
value arrays; REST loaders restore native collections before orchestration.
Injected functions still use native Map/Set fixtures. Dependency injection and public
responses remain unchanged. myPeople errors propagate; existing enrichment/DML
cache degradation remains explicitly logged. Only a DMS cache miss triggers an
awaited, best-effort dealer registration, not a failed cache read. Internal
`getData`/`getContext` receivers use session's own cache with `{ args: [username] }`.
