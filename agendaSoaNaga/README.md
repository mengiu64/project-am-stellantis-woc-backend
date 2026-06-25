# AgendaSOA Naga Lambda – Node.js

Client Node.js autoconsistente per le operazioni **NAGA** (creazione e aggiornamento appuntamenti) del servizio **AgendaSOA REST**, strutturato come AWS Lambda.

## Struttura

```
agendaSoaNaga/
├── index.js                      ← entry-point Lambda (dispatcher)
├── package.json
├── .env.example                  ← copia in .env e compila le credenziali
└── src/
    ├── agendaNagaClient.js       ← client HTTP per endpoint NAGA
    ├── clientFactory.js          ← factory che legge le variabili d'ambiente
    ├── test.js                   ← smoke-test locale
    └── handlers/
        ├── createnaga.js         ← POST appointmentrest/rdvs/v1/createnaga
        └── updatenaga.js         ← POST appointmentrest/rdvs/v1/updatenaga/{apptId}
```

## Setup

```bash
cd agendaSoaNaga
cp .env.example .env
# edita .env con host, username, password reali
npm install
```

## Smoke-test locale

```bash
npm test
# oppure
node src/test.js createnaga
node src/test.js updatenaga apptId=MY_APPT_ID
```

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
