# 4 CURL per testare syncro-kafka-events Lambda

## ⚠️ Prerequisiti

1. **Lambda deve essere deployata** su AWS API Gateway
2. **Record deve esistere** in `woc.comunication_asyncro_djc` con stessa `job_card_id + push_timestamp`
   - La lambda NON crea record, solo li AGGIORNA
   - Il record deve essere creato da `isStellantisBrand` lambda PRIMA
3. **Sostituisci**:
   - `https://your-api-gateway.com/api/synch-status` → endpoint reale
   - `jobCardSrpId` → valori reali che esistono nel DB
   - `timestamp` → timestamp attuali (ISO 8601 format)

---

## 1️⃣ DMS_PUSH_SUCCESS_WITHOUT_UPDATE

**Scenario**: DMS ha processato il push senza modificare dati

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "jobCardSrpId": "JC-20260918-001",
    "timestamp": "2026-09-18T12:00:00Z"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Evento aggiornato con successo in Aurora",
  "response": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-001",
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "status": "SUCCESS_WITHOUT_UPDATE",
    "timestamp": "2026-09-18T12:00:00Z",
    "version": 2
  }
}
```

---

## 2️⃣ DMS_PUSH_SUCCESS_WITH_UPDATE

**Scenario**: DMS ha processato il push E ha modificato dati

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITH_UPDATE",
    "jobCardSrpId": "JC-20260918-002",
    "timestamp": "2026-09-18T12:05:00Z"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Evento aggiornato con successo in Aurora",
  "response": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-002",
    "eventType": "DMS_PUSH_SUCCESS_WITH_UPDATE",
    "status": "SUCCESS_WITH_UPDATE",
    "timestamp": "2026-09-18T12:05:00Z",
    "version": 2
  }
}
```

---

## 3️⃣ DMS_PUSH_REFUSAL

**Scenario**: DMS ha rifiutato il push (validazione fallita, regole di business violate, etc.)

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_REFUSAL",
    "jobCardSrpId": "JC-20260918-003",
    "timestamp": "2026-09-18T12:10:00Z"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Evento aggiornato con successo in Aurora",
  "response": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-003",
    "eventType": "DMS_PUSH_REFUSAL",
    "status": "REFUSAL",
    "timestamp": "2026-09-18T12:10:00Z",
    "version": 2
  }
}
```

---

## 4️⃣ DMS_PUSH_FAILURE

**Scenario**: DMS ha riscontrato un errore durante l'elaborazione

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_FAILURE",
    "jobCardSrpId": "JC-20260918-004",
    "timestamp": "2026-09-18T12:15:00Z"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Evento aggiornato con successo in Aurora",
  "response": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-004",
    "eventType": "DMS_PUSH_FAILURE",
    "status": "FAILURE",
    "timestamp": "2026-09-18T12:15:00Z",
    "version": 2
  }
}
```

---

## 🧪 TEST CASES AGGIUNTIVI

### Test con payload incompleto (❌ 400 Bad Request)

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE"
  }' | jq .
```

**Risposta**: 400 Bad Request (mancano jobCardSrpId e timestamp)

---

### Test con eventType non supportato (❌ 400 Bad Request)

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "INVALID_EVENT_TYPE",
    "jobCardSrpId": "JC-20260918-006",
    "timestamp": "2026-09-18T12:25:00Z"
  }' | jq .
```

**Risposta**: 400 Bad Request (eventType non nei 4 supportati)

---

### Test con record che non esiste (❌ 404 Not Found)

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "jobCardSrpId": "JC-NONEXISTENT",
    "timestamp": "2026-09-18T12:30:00Z"
  }' | jq .
```

**Risposta**: 404 Not Found (il record non esiste in woc.comunication_asyncro_djc)

```json
{
  "statusCode": 404,
  "success": false,
  "error": "Not Found",
  "message": "Record non trovato in woc.comunication_asyncro_djc",
  "details": {
    "jobCardId": "JC-NONEXISTENT",
    "timestamp": "2026-09-18T12:30:00Z",
    "suggestion": "Il record deve essere creato da un'altra lambda prima di essere aggiornato"
  }
}
```

---

## 📊 Campi Risposta

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `statusCode` | Integer | HTTP status code (200 per successo) |
| `success` | Boolean | Indica se la richiesta è andata a buon fine |
| `message` | String | Messaggio descrittivo del risultato |
| `response.responseId` | UUID | ID univoco della risposta generato dalla lambda |
| `response.jobCardId` | String | Job card identifier (da payload) |
| `response.eventType` | String | Tipo di evento ricevuto (uno dei 4 supportati) |
| `response.status` | ENUM | Stato della sincronizzazione: `SUCCESS_WITHOUT_UPDATE`, `SUCCESS_WITH_UPDATE`, `REFUSAL`, `FAILURE` |
| `response.timestamp` | ISO 8601 | Timestamp dell'evento (da payload) |
| `response.version` | Integer | Numero versione del record (incrementato ad ogni UPDATE) |

---

## 📝 Logging

La lambda logga:
1. **Request ricevuta da DJC** - all'inizio del processing
2. **Response inviata a DJC** - dopo l'aggiornamento in Aurora

Esempio di log:
```
📥 REQUEST DA DJC RICEVUTA: {
  "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
  "jobCardSrpId": "JC-20260918-001",
  "timestamp": "2026-09-18T12:00:00Z"
}

📤 RESPONSE INVIATA A DJC: {
  "statusCode": 200,
  "success": true,
  "message": "Evento aggiornato con successo in Aurora",
  "response": {
    "responseId": "550e8400-e29b-41d4-a716-446655440000",
    "jobCardId": "JC-20260918-001",
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "status": "SUCCESS_WITHOUT_UPDATE",
    "timestamp": "2026-09-18T12:00:00Z",
    "version": 2
  }
}
```

---

## 🔄 Flusso Completo

```
┌────────────────────────────┐
│   DJC (Sistema Esterno)   │
│ Invia 1 dei 4 eventi      │
└─────────────┬──────────────┘
              │ POST /api/synch-status
              │ Content-Type: application/json
              │ {eventType, jobCardSrpId, timestamp}
              ▼
┌────────────────────────────────────────────┐
│    syncro-kafka-events Lambda              │
│    (Node.js 24.x, 512MB, timeout 30s)     │
│                                            │
│  1. Parse e Valida payload                │
│  2. Verifica eventType ∈ [4 supportati]  │
│  3. Converte eventType → DB Status        │
│  4. Connette Aurora PostgreSQL            │
│  5. UPDATE in woc.comunication_asyncro_djc│
│  6. Ritorna 200 OK o errore HTTP          │
└─────────────┬──────────────────────────────┘
              │ INSERT/UPDATE
              ▼
┌────────────────────────────────────────┐
│  Aurora PostgreSQL                     │
│  Tabella: woc.comunication_asyncro_djc │
│  Chiave: (job_card_id, push_timestamp) │
└────────────────────────────────────────┘
```

---

## ℹ️ Informazioni Importanti

- **Nessun input di djc/ambito**: djc e ambito sono gestiti internamente dalla lambda
- **Nessun traceId nella risposta**: traceId è disponibile solo nei log AWS CloudWatch
- **UPDATE-only pattern**: La lambda NON crea record, solo li aggiorna
- **Record deve preesistere**: Il record deve essere creato da un'altra lambda (es. `isStellantisBrand`) PRIMA di essere aggiornato
- **Idempotency**: Stessa richiesta due volte incrementa il `version` del record

---

**Versione**: 1.1 (Senza djc, ambito, traceId)  
**Status**: ✅ Pronto per deployment  
**Ultimo aggiornamento**: 2026-09-18
