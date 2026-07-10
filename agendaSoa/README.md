# AgendaSOA Lambda – Node.js

Client Node.js autoconsistente per il servizio **AgendaSOA REST**, strutturato come AWS Lambda.

## Struttura

```
lambda/
├── index.js                      ← entry-point Lambda (dispatcher)
├── package.json
├── .env                          ← credenziali e config (non versionato)
└── src/
    ├── agendaSOAClient.js        ← client HTTP (specchio di AgendaSOARestClient.php)
    ├── clientFactory.js          ← factory che legge le variabili d'ambiente
    ├── certService.js            ← scarica il certificato mTLS da S3 e costruisce l'https.Agent
    ├── test.js                   ← smoke-test locale
    └── handlers/
        ├── appointment.js        ← GET  planningrest/planning/v1/appointment/data/
        ├── availableHours.js     ← GET  vendorrest/pdvs/v1/{id}/availablehours/
        ├── cCSList.js            ← GET  vendorrest/pdvs/v1/{id}/ccslist/
        ├── data.js               ← GET  appointmentrest/rdvs/v1/{id}/data/
        └── getAvHoursForRec.js   ← orari liberi per un ricevitore (CCS), incrociando availableHours + appointment
```

## Setup

```bash
cd lambda
# crea/edita .env con host, username, password reali (vedi tabella "Variabili d'ambiente")
npm install
```

## Smoke-test locale

```bash
npm test
# oppure
node src/test.js
```

Aggiungi in `.env` le variabili opzionali:
```
TEST_PDV_ID=IT_12345
TEST_APPT_ID=APPT_67890
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
  "action": "availableHours",
  "queryStringParameters": {
    "id": "IT_12345",
    "startDate": "2025-01-01"
  }
}
```

## Metodi disponibili

| Metodo               | HTTP | Endpoint                                          |
|----------------------|------|---------------------------------------------------|
| `appointment`        | GET  | `planningrest/planning/v1/appointment/data/`      |
| `availableHours`     | GET  | `vendorrest/pdvs/v1/{id}/availablehours/`        |
| `cCSList`            | GET  | `vendorrest/pdvs/v1/{id}/ccslist/`               |
| `data`               | GET  | `appointmentrest/rdvs/v1/{id}/data/`             |
| `getAvHoursForRec`   | —    | Combina `availableHours` + `appointment` per calcolare gli orari liberi di un ricevitore (CCS) |
