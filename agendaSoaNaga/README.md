# AgendaSOA Naga Lambda – Node.js

Client Node.js autoconsistente per le operazioni **NAGA** (creazione e aggiornamento appuntamenti) del servizio **AgendaSOA REST**, strutturato come AWS Lambda.

## Struttura

```
agendaSoaNaga/
├── index.js                      ← entry-point Lambda (dispatcher)
├── package.json
└── src/
    ├── .env                       ← credenziali e config (non versionato)
    ├── agendaNagaClient.js       ← client HTTP per endpoint NAGA
    ├── clientFactory.js          ← factory che legge le variabili d'ambiente
    ├── certService.js            ← scarica il certificato mTLS da S3 e costruisce l'https.Agent
    ├── test.js                   ← smoke-test locale
    └── handlers/
        ├── createnaga.js         ← POST appointmentrest/rdvs/v1/createnaga
        └── updatenaga.js         ← POST appointmentrest/rdvs/v1/updatenaga/{apptId}
```

## Setup

```bash
cd agendaSoaNaga
# crea/edita src/.env con host, username, password reali (vedi tabella "Variabili d'ambiente")
npm install
```

## Smoke-test locale

```bash
npm test
# oppure
node src/test.js createnaga
node src/test.js updatenaga apptId=MY_APPT_ID
```

## Certificato client mTLS

Il servizio AgendaSOA richiede un certificato client (mutual TLS). Certificato (`.cer`) e chiave
privata (`.key`) **non sono inclusi nel deployment package**: vengono scaricati da S3 al primo
utilizzo e l'`https.Agent` risultante viene mantenuto in cache in memoria per tutta la vita
dell'istanza Lambda (invocazioni "warm" successive non ri-scaricano da S3).

| Variabile                     | Descrizione                                              |
|--------------------------------|-----------------------------------------------------------|
| `AGENDA_SOA_CERT_BUCKET`      | Bucket S3 che contiene il certificato (es. `s3-np-bsn0027990-dev-translations`) |
| `AGENDA_SOA_CERT`             | Key S3 del file `.cer` (es. `certs/mwpaga0a.cer`)          |
| `AGENDA_SOA_KEY`              | Key S3 del file `.key` (es. `certs/mwpaga0a.key`)          |
| `AGENDA_SOA_KEY_PASSPHRASE`   | (opzionale) passphrase della chiave privata, se cifrata    |

Se `AGENDA_SOA_CERT_BUCKET` non è configurato, la Lambda continua a funzionare senza mTLS
(nessun certificato client viene inviato). La Lambda necessita dei permessi `s3:GetObject` sul
bucket indicato (vedi `S3ReadPolicy` in `template.yaml`).

## Uso come Lambda dispatcher

Il file `index.js` instrada l'evento al corretto handler in base al campo `action`:

```json
{
  "action": "createnaga",
  "body": "{ ... }"
}
```

## Metodi disponibili

| Metodo        | HTTP | Endpoint                                        |
|---------------|------|-------------------------------------------------|
| `createnaga`  | POST | `appointmentrest/rdvs/v1/createnaga`            |
| `updatenaga`  | POST | `appointmentrest/rdvs/v1/updatenaga/{apptId}`   |
