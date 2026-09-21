# 4 CURL per testare synch-status Lambda

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
    "timestamp": "2026-09-18T12:00:00Z",
    "djc": "Y",
    "ambito": "SALES"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "message": "Evento aggiornato con successo in Aurora",
  "data": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-001",
    "timestamp": "2026-09-18T12:00:00Z",
    "djcFlag": "Y",
    "ambito": "SALES",
    "djcSyncStatus": "SUCCESS_WITHOUT_UPDATE",
    "version": 2,
    "traceId": "..."
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
    "timestamp": "2026-09-18T12:05:00Z",
    "djc": "Y",
    "ambito": "SERVICE"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "message": "Evento aggiornato con successo in Aurora",
  "data": {
    "responseId": "uuid-univoco",
    "jobCardId": "JC-20260918-002",
    "djcSyncStatus": "SUCCESS_WITH_UPDATE",
    "version": 2,
    ...
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
    "timestamp": "2026-09-18T12:10:00Z",
    "djc": "Y",
    "ambito": "SALES"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "message": "Evento aggiornato con successo in Aurora",
  "data": {
    "responseId": "uuid-univoco",
    "djcSyncStatus": "REFUSAL",
    "version": 2,
    ...
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
    "timestamp": "2026-09-18T12:15:00Z",
    "djc": "Y",
    "ambito": "SERVICE"
  }' | jq .
```

**Risposta attesa** (200 OK):
```json
{
  "message": "Evento aggiornato con successo in Aurora",
  "data": {
    "responseId": "uuid-univoco",
    "djcSyncStatus": "FAILURE",
    "version": 2,
    ...
  }
}
```

---

## 🧪 TEST CASES AGGIUNTIVI

### Test con djc="N" (djc_sync_status sarà NULL)

```bash
curl -X POST "https://your-api-gateway.com/api/synch-status" \
  -H "Content-Type: application/json" \
  -d '{
    "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
    "jobCardSrpId": "JC-20260918-005",
    "timestamp": "2026-09-18T12:20:00Z",
    "djc": "N",
    "ambito": "SALES"
  }' | jq .
```

**Risultato**: `djcSyncStatus: null` (evento non sincronizzato con DJC)

---

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
    "timestamp": "2026-09-18T12:25:00Z",
    "djc": "Y",
    "ambito": "SALES"
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
    "timestamp": "2026-09-18T12:30:00Z",
    "djc": "Y",
    "ambito": "SALES"
  }' | jq .
```

**Risposta**: 404 Not Found (il record non esiste in woc.comunication_asyncro_djc)

```json
{
  "error": "Not Found",
  "message": "Record non trovato in woc.comunication_asyncro_djc - verificare che il record sia stato creato precedentemente",
  "details": {
    "jobCardId": "JC-NONEXISTENT",
    "timestamp": "2026-09-18T12:30:00Z",
    "suggestion": "Il record deve essere creato da un'altra lambda prima di essere aggiornato"
  },
  "traceId": "..."
}
```

---

## 📊 Risposta Completa (200 OK)

```json
{
  "message": "Evento aggiornato con successo in Aurora",
  "data": {
    "responseId": "550e8400-e29b-41d4-a716-446655440000",
    "jobCardId": "JC-20260918-001",
    "timestamp": "2026-09-18T12:00:00Z",
    "djcFlag": "Y",
    "ambito": "SALES",
    "djcSyncStatus": "SUCCESS_WITHOUT_UPDATE",
    "version": 2,
    "traceId": "trace-xxx-yyy-zzz"
  }
}
```

### Campi risposta

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `responseId` | UUID | ID univoco della risposta generato dalla lambda |
| `jobCardId` | String | Job card identifier (da payload) |
| `timestamp` | ISO 8601 | Timestamp dell'evento (da payload) |
| `djcFlag` | Y/N | Flag djc normalizzato |
| `ambito` | String | Ambito/contesto dell'evento (da payload) |
| `djcSyncStatus` | ENUM | Stato della sincronizzazione: `SUCCESS_WITHOUT_UPDATE`, `SUCCESS_WITH_UPDATE`, `REFUSAL`, `FAILURE`, `null` |
| `version` | Integer | Numero versione del record (incrementato ad ogni UPDATE) |
| `traceId` | String | ID univoco della traccia per debugging |

---

## 🔄 Flusso Completo

1. **Lambda `isStellantisBrand`** → **INSERT** record in `woc.comunication_asyncro_djc`
   - Crea il record con stato iniziale
   - `created_at` impostato da trigger

2. **DJC** → invia uno dei 4 eventi Kafka

3. **Lambda `synch-status`** → **UPDATE** record
   - Ricerca il record per `job_card_id + push_timestamp`
   - Aggiorna `djc_sync_status` in base all'evento ricevuto
   - Incrementa `version` per optimistic locking
   - `updated_at` impostato da trigger

---

## 🛠️ Troubleshooting

### ❌ 404 Not Found
- **Causa**: Record non esiste in `woc.comunication_asyncro_djc`
- **Soluzione**: Verificare che `isStellantisBrand` lambda abbia creato il record PRIMA
- **Check**: 
  ```sql
  SELECT * FROM woc.comunication_asyncro_djc 
  WHERE job_card_id = 'JC-20260918-001' 
  AND push_timestamp = '2026-09-18T12:00:00Z';
  ```

### ❌ 400 Bad Request
- **Causa**: Payload incompleto o malformato
- **Soluzione**: Verificare che siano presenti:
  - `eventType` (uno dei 4 supportati)
  - `jobCardSrpId`
  - `timestamp` (ISO 8601)
  - `ambito`

### ❌ 503 Service Unavailable
- **Causa**: Errore connessione Aurora
- **Soluzione**: Verificare che Aurora sia accessible e credenziali corrette

### ❌ 504 Gateway Timeout
- **Causa**: Query database ha superato timeout (5 secondi)
- **Soluzione**: Verificare che Aurora sia responsive

---

## 📝 Note

- Tutti i timestamp devono essere in formato ISO 8601 (e.g., `2026-09-18T12:00:00Z`)
- `djc` default è `Y` se omesso
- `ambito` è campo obbligatorio
- La lambda è **STATELESS** e riprova automaticamente in caso di errore transitorio
