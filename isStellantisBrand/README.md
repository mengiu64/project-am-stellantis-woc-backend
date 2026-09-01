# isStellantisBrand

Lambda multi-azione (Node.js) che espone due gruppi di funzionalità distinte
su un'unica funzione, entrambe basate su Aurora PostgreSQL (via RDS Proxy):

1. **`isStellantisBrand`** — verifica se un codice brand ARCAD (`ar_codbrand`)
   appartiene al gruppo Stellantis, restituendo anche l'eventuale chiave S3
   del logo del brand.
2. **CRUD firme dealer** (`createUserSign`, `getUserSign`, `updateUserSign`,
   `deleteUserSign`) — gestisce le immagini di firma (JPEG, trasportate come
   base64) associate a un `dealer_login_userid`, memorizzate nella tabella
   `woc.dealer_sign`.

## File principali

- `index.js` — handler Lambda e router delle azioni; contiene inline la
  logica di `isStellantisBrand` e delega le azioni CRUD a
  `userSignsService.js`.
- `userSignsService.js` — implementazione delle operazioni CRUD sulla tabella
  `woc.dealer_sign`.
- `shared/dbClient.js` — pool di connessione `pg` condiviso (warm start),
  con recupero di endpoint/credenziali da SSM Parameter Store e AWS Secrets
  Manager, oppure connessione locale se `DB_LOCAL_MODE=true`.

## Dispatch delle azioni

L'handler risolve `{ action, body }` in due modalità:

1. **Invocazione diretta**: `{ "action": "nomeAzione", "body": {...} }`.
2. **Integrazione proxy API Gateway**: l'azione è l'ultimo segmento del path
   (`rawPath`/`path`/`pathParameters.proxy`); il body è il merge tra
   `queryStringParameters` e il body JSON parsato.

Azioni valide (`VALID_ACTIONS`): `isStellantisBrand`, `createUserSign`,
`getUserSign`, `updateUserSign`, `deleteUserSign`. Un'azione non riconosciuta
o assente produce una risposta `400`.

## Azione: `isStellantisBrand`

Verifica l'appartenenza di un brand a Stellantis interrogando
`woc.anag_brand`.

**Parametri** (nel body):
- `ar_codbrand` — obbligatorio.
- `oicsBrands` — opzionale, stringa di `codbrand` OICS separati da virgola
  (es. `"AR,FI,JE"`), usata per il controllo `inMandate` descritto sotto.

**Validazioni** (in ordine, ognuna produce `400` se fallisce):
1. `ar_codbrand` obbligatorio (non `undefined`/`null`/stringa vuota o solo
   whitespace).
2. Lunghezza massima 2 caratteri.
3. Solo caratteri alfabetici (`a-z`, `A-Z`).

Il valore viene poi normalizzato in maiuscolo e usato nella query:

```sql
SELECT logo_s3_key,codbrand FROM woc.anag_brand WHERE ar_codbrand = $1 LIMIT 1
```

Se il brand viene trovato, il `codbrand` restituito dalla query viene
confrontato (dopo `trim`) con i valori della stringa CSV `oicsBrands`
(anch'essi trimmati): se presente, `inMandate` è `true`, altrimenti `false`.
Se `oicsBrands` non è fornito, `inMandate` è sempre `false`.

**Risposte:**
- `200 { success: true, isStellantisBrand: true, logoS3Key, inMandate }` —
  brand trovato (`logoS3Key` è `null` se il campo è vuoto; `inMandate`
  indica se il `codbrand` del brand è presente in `oicsBrands`).
- `200 { success: true, isStellantisBrand: false }` — brand non trovato
  (nessun `inMandate`, non essendoci un `codbrand` da verificare).
- `400` — validazione fallita.
- `500` — errore interno.

## Azioni CRUD firme dealer (`woc.dealer_sign`)

Tutte le operazioni usano `dealer_login_userid` come chiave di ricerca
(colonna con vincolo `UNIQUE`); l'immagine (`sign_image`) è trasportata come
stringa base64 e convertita in `Buffer` (`BYTEA`) al confine col database.

### `createUserSign`
- **Body**: `{ dealer_login_userid, sign_image }` (entrambi obbligatori;
  `dealer_login_userid` max 50 caratteri).
- Esegue `INSERT INTO woc.dealer_sign (...) RETURNING dealer_sign_id`.
- **Risposte**: `201` con `dealer_sign_id` creato; `400` validazione fallita;
  `409` se esiste già una firma per quel `dealer_login_userid` (violazione
  vincolo univoco, codice Postgres `23505`); `500` errore interno.

### `getUserSign`
- **Body**: `{ dealer_login_userid }` (obbligatorio).
- Esegue `SELECT dealer_sign_id, dealer_login_userid, sign_image,
  created_at, updated_at FROM woc.dealer_sign WHERE dealer_login_userid = $1`.
- **Risposte**: `200` con `data` (immagine codificata in base64); `400`
  validazione fallita; `404` record non trovato; `500` errore interno.

### `updateUserSign`
- **Body**: `{ dealer_login_userid, sign_image }` (entrambi obbligatori;
  unico campo aggiornabile è `sign_image`).
- Esegue `UPDATE woc.dealer_sign SET sign_image = $1 WHERE
  dealer_login_userid = $2 RETURNING dealer_sign_id`.
- **Risposte**: `200` conferma aggiornamento; `400` validazione fallita;
  `404` record non trovato; `500` errore interno.

### `deleteUserSign`
- **Body**: `{ dealer_login_userid }` (obbligatorio).
- Esegue `DELETE FROM woc.dealer_sign WHERE dealer_login_userid = $1
  RETURNING dealer_sign_id`.
- **Risposte**: `200` conferma eliminazione; `400` validazione fallita;
  `404` record non trovato; `500` errore interno.

## Connessione al database (`shared/dbClient.js`)

- Pool `pg` riutilizzato tra invocazioni (warm start), con `max: 1`
  connessione per invocazione Lambda e `connectionTimeoutMillis: 5000`.
- **Modalità normale**: endpoint RDS Proxy e credenziali recuperati da SSM
  Parameter Store (`DB_SECRET_ARN_PARAM`, `RDS_PROXY_ENDPOINT_PARAM`) e AWS
  Secrets Manager, con SSL abilitato e cache dei valori tra invocazioni.
- **Modalità locale** (`DB_LOCAL_MODE=true`): bypassa SSM/Secrets Manager e
  usa `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` (con default
  utili per test locali), SSL controllato da `DB_SSL`.
- In caso di errore di connessione o di errore runtime sul pool, la cache
  viene invalidata per forzare una riconnessione alla chiamata successiva.
- `invalidatePool()` è esposta per uso nei test.

## Variabili d'ambiente

| Variabile                  | Descrizione                                              |
|-----------------------------|-----------------------------------------------------------|
| `DB_SECRET_ARN_PARAM`       | Nome parametro SSM con l'ARN del secret DB (Secrets Manager) |
| `RDS_PROXY_ENDPOINT_PARAM`  | Nome parametro SSM con l'endpoint RDS Proxy               |
| `DB_LOCAL_MODE`             | `true` per bypassare SSM/Secrets Manager (uso locale/test) |
| `DB_HOST`, `DB_PORT`        | Host/porta DB in modalità locale                          |
| `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Credenziali DB in modalità locale                  |
| `DB_SSL`                    | Abilita SSL in modalità locale                            |

## Logging

Ogni operazione produce log JSON strutturati (`level`, `awsRequestId`,
`operation`, `message`, dati contestuali) su CloudWatch. Gli errori non
espongono mai dettagli interni al client: la risposta è sempre generica
(`Errore interno del server`), mentre il dettaglio (`errorType`, `message`)
resta solo nei log.

## Test

```bash
npm install
npm test              # esegue la suite Jest (__tests__/)
npm run test:coverage # Jest con report di copertura
```

Soglia di copertura richiesta (globale): 90% per statements, branches,
functions e lines, come da `coverageThreshold` in `package.json`.

## Deploy (SAM)

Definita in `template.yaml` come `IsStellantisBrandFunction`
(`AWS::Serverless::Function`, `CodeUri: isStellantisBrand/`). Non richiede
`BuildMethod: makefile` poiché non ha dipendenze da cartelle sibling: usa
solo il proprio `package.json` e `shared/dbClient.js`.
