# AgendaSOA Lambda – Node.js

Client Node.js autoconsistente per il servizio **AgendaSOA REST**, strutturato come AWS Lambda.

## Struttura

```
lambda/
├── index.js                      ← entry-point Lambda (dispatcher)
├── package.json
├── .env.example                  ← copia in .env e compila le credenziali
└── src/
    ├── agendaSOAClient.js        ← client HTTP (specchio di AgendaSOARestClient.php)
    ├── clientFactory.js          ← factory che legge le variabili d'ambiente
    ├── test.js                   ← smoke-test locale
    └── handlers/
        ├── appointment.js        ← GET  planningrest/planning/v1/appointment/data/
        ├── availableHours.js     ← GET  vendorrest/pdvs/v1/{id}/availablehours/
        ├── cCSList.js            ← GET  vendorrest/pdvs/v1/{id}/ccslist/
        └── data.js               ← GET  appointmentrest/rdvs/v1/{id}/data/
```

## Setup

```bash
cd lambda
cp .env.example .env
# edita .env con host, username, password reali
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
