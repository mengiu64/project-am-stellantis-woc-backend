# Syncro-Kafka-Events Lambda - SRP DL KAFKA Integration

## 📋 Sommario

Lambda `syncro-kafka-events` riceve **SOLTANTO 4 eventi specifici** da DJC e li registra in Aurora PostgreSQL secondo la specifica **SRP DL KAFKA Specification.md**.

### I 4 Eventi Supportati:
1. **DMS_PUSH_SUCCESS_WITHOUT_UPDATE** → Status DB: `SUCCESS_WITHOUT_UPDATE` (nessun errore)
2. **DMS_PUSH_SUCCESS_WITH_UPDATE** → Status DB: `SUCCESS_WITH_UPDATE` (nessun errore)
3. **DMS_PUSH_REFUSAL** → Status DB: `REFUSAL` (error_code: `DMS_PUSH_REFUSED`)
4. **DMS_PUSH_FAILURE** → Status DB: `FAILURE` (error_code: `DMS_PUSH_FAILED`)

---

## 🏗️ Architettura

```
┌────────────────────────────┐
│   DJC (Sistema Esterno)   │
│ Invia 1 dei 4 eventi      │
└─────────────┬──────────────┘
              │ POST /api/synch-status
              │ Content-Type: application/json
              ▼
┌────────────────────────────────────────────┐
│    syncro-kafka-events Lambda              │
│    (Node.js 24.x, 512MB, timeout 30s)     │
│                                            │
│  1. Parse e Valida payload                │
│  2. Verifica eventType ∈ [4 supportati]  │
│  3. Converte eventType → DB Status        │
│  4. Connette Aurora PostgreSQL            │
│  5. UPSERT in woc.comunication_asyncro_djc
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

## 📊 Schema Tabella Aurora

```sql
CREATE TABLE woc.comunication_asyncro_djc (
  response_id UUID PRIMARY KEY,
  job_card_id VARCHAR(50) NOT NULL,         -- jobCardSrpId dal payload
  push_timestamp TIMESTAMP NOT NULL,        -- timestamp dal payload
  djc_sync_status VARCHAR(50) NOT NULL,     -- SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE
  json_payload JSONB,                       -- Payload originale ricevuto da DJC
  json_modified JSONB,                      -- Metadati: receivedAt, eventType, additionalFields
  retry_count INTEGER DEFAULT 0,            -- Per future retry logic
  error_code VARCHAR(50),                   -- null per SUCCESS, 'DMS_PUSH_REFUSED' o 'DMS_PUSH_FAILED'
  error_message TEXT,                       -- Descrizione errore (se fallita)
  source_system VARCHAR(50) DEFAULT 'DJC',  -- Sistema che invia l'evento
  created_by VARCHAR(100) DEFAULT 'djc-system',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  version INTEGER DEFAULT 1,                -- Per optimistic locking
  UNIQUE (job_card_id, push_timestamp)      -- Idempotency: stessa richiesta → ON CONFLICT DO UPDATE
);
```

---

## 🔄 Flusso di Elaborazione

### 1️⃣ **Ricezione Payload**
```json
{
  "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
  "jobCardSrpId": "JCID-42",
  "timestamp": "2026-04-24T10:30:00Z",
  "jobCardLegacyId": "123456",              // Opzionale
  "dmsRepairOrderId": "1A45",               // Opzionale
  "xpDealerCode": "123456A",                // Opzionale
  "xfDealerCode": "987456",                 // Opzionale
  "pairedOicCode": "1478566994",            // Opzionale
  "marketCode": "1000"                      // Opzionale
}
```

### 2️⃣ **Validazione**
- ✅ `eventType` obbligatorio e ∈ [4 supportati]
- ✅ `jobCardSrpId` obbligatorio
- ✅ `timestamp` obbligatorio (ISO 8601)
- ❌ Se validazione fallisce: **400 Bad Request**

### 3️⃣ **Mapping Event Type → Status Database**

| Event Type | DB Status | error_code | error_message |
|---|---|---|---|
| `DMS_PUSH_SUCCESS_WITHOUT_UPDATE` | `SUCCESS_WITHOUT_UPDATE` | `null` | `null` |
| `DMS_PUSH_SUCCESS_WITH_UPDATE` | `SUCCESS_WITH_UPDATE` | `null` | `null` |
| `DMS_PUSH_REFUSAL` | `REFUSAL` | `DMS_PUSH_REFUSED` | "DMS ha rifiutato il push..." |
| `DMS_PUSH_FAILURE` | `FAILURE` | `DMS_PUSH_FAILED` | "DMS ha riportato fallimento..." |

### 4️⃣ **UPSERT in Aurora**
- **Chiave di conflitto**: `(job_card_id, push_timestamp)`
- **Se nuovo**: INSERT (version = 1)
- **Se duplicato**: UPDATE (version += 1, idempotency garantita)

### 5️⃣ **Risposta HTTP**

#### ✅ Successo (200 OK)
```json
{
  "statusCode": 200,
  "success": true,
  "message": "Evento DMS_PUSH_SUCCESS_WITHOUT_UPDATE registrato con successo",
  "response": {
    "responseId": "uuid-1234",
    "jobCardId": "JCID-42",
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "status": "SUCCESS_WITHOUT_UPDATE",
    "timestamp": "2026-04-24T10:30:00Z",
    "version": 1
  },
  "traceId": "trace-12345"
}
```

#### ❌ Errori

| HTTP Code | Motivo |
|---|---|
| **400** | Payload non valido (JSON, eventType, campi obbligatori) |
| **503** | Aurora non disponibile / Connessione fallita |
| **504** | Query database timeout (> 5s) |
| **500** | Errore generico database |

---

## 🧪 Test Suite

### Comandi

```bash
# Esegui tutti i test
npm test

# Esegui test specifico
npm test -- index.test.js --verbose

# Coverage report
npm test -- --coverage
```

### Test Cases Implementati

#### ✅ Validazione Payload (10 test)
- Accettazione dei 4 event types supportati
- Rifiuto di event types non supportati
- Campi obbligatori: eventType, jobCardSrpId, timestamp
- Validazione timestamp (ISO 8601)
- Campi opzionali accettati

#### ✅ Mapping Errore (4 test)
- error_code null per SUCCESS events
- error_code `DMS_PUSH_REFUSED` per REFUSAL
- error_code `DMS_PUSH_FAILED` per FAILURE
- error_message coerenti

#### ✅ Handler - Salvataggio Aurora (10 test)
- Registrazione dei 4 eventi
- Idempotency: stesso evento due volte → UPDATE con version++
- Gestione ON CONFLICT DO UPDATE
- Error handling: connessione, timeout, UPSERT fail

#### ✅ Error Handling (5 test)
- 400 Bad Request: payload non valido
- 503 Service Unavailable: Aurora offline
- 504 Gateway Timeout: query lenta
- 500 Internal Error: errore generico

#### ✅ Utility Functions (3 test)
- _buildResponse() con headers corretti
- SUPPORTED_EVENT_TYPES enum
- EVENT_TYPE_TO_DB_STATUS mapping

**Totale: 32 test cases** (Target coverage > 85%)

---

## 📝 Logging Strutturato

La lambda log a ogni step con traccia ID per correlazione:

```javascript
logger.info('🔔 Lambda syncro-kafka-events invocata', { traceId, method, path });
logger.info('📋 Payload ricevuto:', { payload });
logger.info('✅ Payload validato', { eventType, jobCardId, timestamp });
logger.info('🔗 Connessione Aurora PostgreSQL acquisita');
logger.info('✅ Evento registrato in Aurora', { responseId, jobCardId, eventType, version });

// Errori
logger.error('❌ Errore parsing JSON body', error);
logger.error('❌ Errore connessione Aurora', error);
logger.warn('⚠️  eventType non supportato', { received, supported });
```

---

## 🛡️ Gestione Errori

| Scenario | Handling |
|---|---|
| **Payload JSON invalido** | 400 Bad Request, log dettagliato |
| **eventType mancante/non supportato** | 400 Bad Request, elenco supportati in risposta |
| **Campi obbligatori mancanti** | 400 Bad Request, elenco campi richiesti |
| **Timestamp non ISO 8601** | 400 Bad Request, formato richiesto nella risposta |
| **Aurora connessione fallita** | 503 Service Unavailable, retry consigliato |
| **Query timeout (> 5s)** | 504 Gateway Timeout, retry consigliato |
| **UPSERT fallisce (nessuna riga)** | 500 Internal Server Error, indagare DB |
| **Eccezione non gestita** | 500 Internal Server Error, full stack trace in log |

---

## 🔐 Sicurezza & Idempotency

### Idempotency via Unique Constraint
```sql
UNIQUE (job_card_id, push_timestamp)
```

Se DJC invia lo stesso evento due volte:
1. **Prima richiesta**: INSERT (version = 1)
2. **Seconda richiesta**: ON CONFLICT → UPDATE (version = 2), nessun duplicato

### Chiavi Composte
- **Primary Key**: `response_id` (UUID univoco per ogni risposta lambda)
- **Unique Key**: `(job_card_id, push_timestamp)` (idempotency per richieste DJC duplicate)

---

## 🚀 Esecuzione

### Locale (con mock Aurora)
```bash
npm test
```

### Su AWS Lambda
1. Fare il deploy del codice
2. Configurare environment variables (Aurora connection string in Secrets Manager)
3. Configurare trigger API Gateway o ALB
4. Testare con curl:

```bash
curl -X POST https://api.example.com/api/synch-status \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "jobCardSrpId": "JCID-42",
    "timestamp": "2026-04-24T10:30:00Z"
  }'
```

---

## 📚 Riferimenti

- **Specifica**: [SRP DL KAFKA Specification.md](/docs/srp-dl-kafka-specification)
- **Walden Requirements**: [Walden Spec - syncro-kafka-events](/docs/walden-syncro-kafka-events-requirements)
- **Design**: [Design Document](/docs/design-syncro-kafka-events)
- **Database**: `shared/dbClient.js` (Pattern Aurora PostgreSQL)

---

## ✅ Checklist Pre-Commit

- [ ] Tutti i 32 test passano: `npm test`
- [ ] Coverage > 85%: `npm test -- --coverage`
- [ ] Supportati SOLO i 4 eventi da specifica
- [ ] Commenti in italiano su ogni riga critica
- [ ] Log ovunque necessario (parse, validazione, DB, errori)
- [ ] Error handling completo (400, 503, 504, 500)
- [ ] Idempotency via ON CONFLICT DO UPDATE
- [ ] Traccia ID incluso in tutti i log e response headers
- [ ] Version incrementato su ogni UPDATE
- [ ] JSON payload e json_modified salvati correttamente

---

**Versione**: 1.0 (SRP DL KAFKA Specification Compliant)  
**Status**: ✅ Pronto per deployment  
**Ultimo aggiornamento**: 2026-09-18
