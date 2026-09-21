# DDL: Tabella comunication_asyncro_djc (Aurora PostgreSQL)

**Data**: 2026-09-18  
**Versione**: 2.0 (Aggiornata post-refactor synch-status)  
**Schema**: `woc`  
**Database**: Aurora PostgreSQL  

---

## 📋 Overview

La tabella `woc.comunication_asyncro_djc` registra tutti gli **eventi Kafka ricevuti** da DJC tramite la lambda `synch-status`.

Ogni evento rappresenta una comunicazione asincrona tra DJC e il sistema WOC, tracciando:
- Stato dell'evento (SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE)
- Timestamp di creazione/aggiornamento
- Payload originale e metadati elaborati
- Codici errore e messaggi (se applicabile)

---

## 🏗️ Struttura Tabella

### CREATE TABLE

```sql
CREATE TABLE IF NOT EXISTS woc.comunication_asyncro_djc (
  -- ─────────────────────────────────────────────────────────────────────
  -- 🔑 PRIMARY KEY e IDENTITÀ RECORD
  -- ─────────────────────────────────────────────────────────────────────
  
  response_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ID univoco di ogni risposta della Lambda
  -- Generato come UUID v4 durante INSERT
  -- Usato per correlazione tra richiesta Lambda e record database
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 🎯 CHIAVE DI IDEMPOTENCY (Composite Unique Key)
  -- ─────────────────────────────────────────────────────────────────────
  
  job_card_id VARCHAR(50) NOT NULL,
  -- Identificatore del job card proveniente da DJC (jobCardSrpId nel payload)
  -- Es: "JCID-12345", "JC-2026-09-18-001"
  -- Obbligatorio per identificare il job card
  
  push_timestamp TIMESTAMP NOT NULL,
  -- Timestamp dell'evento Kafka (dal payload, campo "timestamp")
  -- In ISO 8601 formato: "2026-04-24T10:30:00Z"
  -- Obbligatorio per identificare univocamente l'evento
  -- NOTA: (job_card_id, push_timestamp) è coppia unica→idempotency
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 📊 STATO DELL'EVENTO
  -- ─────────────────────────────────────────────────────────────────────
  
  djc_sync_status VARCHAR(50) NOT NULL,
  -- Stato dell'evento nella comunicazione DJC→WOC
  -- Valori possibili:
  --   'SUCCESS_WITHOUT_UPDATE'  → DMS ha completato senza modificare dati
  --   'SUCCESS_WITH_UPDATE'     → DMS ha completato e aggiornato dati
  --   'REFUSAL'                 → DMS ha rifiutato la richiesta
  --   'FAILURE'                 → DMS ha riportato un fallimento
  -- Non NULL per ogni evento registrato
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 📦 PAYLOAD ORIGINALE E METADATI
  -- ─────────────────────────────────────────────────────────────────────
  
  json_payload JSONB,
  -- Payload originale ricevuto da DJC nella richiesta POST
  -- Contiene i campi originali:
  --   eventType (es: "DMS_PUSH_SUCCESS_WITHOUT_UPDATE")
  --   jobCardSrpId (es: "JCID-42")
  --   timestamp (es: "2026-04-24T10:30:00Z")
  --   jobCardLegacyId (opzionale)
  --   dmsRepairOrderId (opzionale)
  --   xpDealerCode (opzionale)
  --   xfDealerCode (opzionale)
  --   pairedOicCode (opzionale)
  --   marketCode (opzionale)
  -- Utile per audit e debugging
  
  json_modified JSONB,
  -- Metadati aggiuntivi elaborati dalla Lambda
  -- Struttura:
  --   {
  --     "eventType": "DMS_PUSH_SUCCESS_WITHOUT_UPDATE",
  --     "receivedAt": "2026-09-18T08:30:00.000Z",
  --     "traceId": "trace-uuid-xyz",
  --     "additionalFields": { /* job_card_legacy_id, dms_repair_order_id, ... */ }
  --   }
  
  -- ─────────────────────────────────────────────────────────────────────
  -- ⚠️  ERRORE (se fallita)
  -- ─────────────────────────────────────────────────────────────────────
  
  error_code VARCHAR(50),
  -- Codice errore (NULL se successo)
  -- Valori possibili:
  --   NULL                 → Evento SUCCESS (senza errore)
  --   'DMS_PUSH_REFUSED'   → Evento REFUSAL (rifiutato da DMS)
  --   'DMS_PUSH_FAILED'    → Evento FAILURE (fallimento DMS)
  -- Usato per query/filtering su errori
  
  error_message TEXT,
  -- Messaggio errore leggibile (NULL se successo)
  -- Esempi:
  --   NULL (per SUCCESS)
  --   "DMS ha rifiutato il push del job card (validazione fallita)"
  --   "DMS ha riportato un fallimento durante il push del job card"
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 🏢 TRACCIAMENTO SORGENTE E CREATORE
  -- ─────────────────────────────────────────────────────────────────────
  
  source_system VARCHAR(50) DEFAULT 'DJC',
  -- Sistema che ha originato l'evento
  -- Default: 'DJC' (sempre, nella specifica SRP DL KAFKA)
  -- Usato per supportare future estensioni (es: GCT)
  
  created_by VARCHAR(100) DEFAULT 'djc-system',
  -- Identità del creatore del record
  -- Default: 'djc-system' (oppure estratto da Bearer token)
  -- Per audit trail e tracking
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 🕐 TIMESTAMPS DI SISTEMA
  -- ─────────────────────────────────────────────────────────────────────
  
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Timestamp di creazione del record (INSERT)
  -- Immutabile dopo creazione
  
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Timestamp dell'ultimo aggiornamento (UPDATE via ON CONFLICT)
  -- Aggiornato ogni volta che lo stesso evento arriva (retry DJC)
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 🔄 RETRY E VERSIONING
  -- ─────────────────────────────────────────────────────────────────────
  
  retry_count INTEGER DEFAULT 0,
  -- Contatore retry per future logica di retry
  -- Iniziale: 0 (non usato nella v2.0, riservato per future)
  
  version INTEGER DEFAULT 1,
  -- Numero versione del record (optimistic locking)
  -- Iniziale: 1 (INSERT)
  -- Incremento: version = version + 1 (ON CONFLICT DO UPDATE)
  -- Usato per tracking numero aggiornamenti
  
  -- ─────────────────────────────────────────────────────────────────────
  -- 🔐 VINCOLI
  -- ─────────────────────────────────────────────────────────────────────
  
  PRIMARY KEY (response_id),
  -- Chiave primaria: UUID univoco per ogni risposta lambda
  
  UNIQUE (job_card_id, push_timestamp)
  -- Chiave di idempotency: composita (job_card_id, push_timestamp)
  -- Garantisce: stesso evento (stesso job card + timestamp) → UPDATE, non duplicato
  -- Usata per ON CONFLICT DO UPDATE nella Lambda
);
```

---

## 📑 Colonne Dettagliate

| Colonna | Tipo | Nullable | Default | Descrizione |
|---------|------|----------|---------|-------------|
| `response_id` | UUID | NO | gen_random_uuid() | PK: ID univoco risposta Lambda |
| `job_card_id` | VARCHAR(50) | NO | — | Identificatore job card (da payload) |
| `push_timestamp` | TIMESTAMP | NO | — | Timestamp evento Kafka (da payload) |
| `djc_sync_status` | VARCHAR(50) | NO | — | Stato evento (SUCCESS_*, REFUSAL, FAILURE) |
| `json_payload` | JSONB | YES | NULL | Payload originale ricevuto da DJC |
| `json_modified` | JSONB | YES | NULL | Metadati elaborati (eventType, receivedAt, etc.) |
| `retry_count` | INTEGER | NO | 0 | Contatore retry (futuro) |
| `error_code` | VARCHAR(50) | YES | NULL | Codice errore (NULL se successo) |
| `error_message` | TEXT | YES | NULL | Messaggio errore (NULL se successo) |
| `source_system` | VARCHAR(50) | NO | 'DJC' | Sistema di provenienza evento |
| `created_by` | VARCHAR(100) | NO | 'djc-system' | Identità creatore record |
| `created_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | Timestamp creazione record |
| `updated_at` | TIMESTAMP | NO | CURRENT_TIMESTAMP | Timestamp ultimo aggiornamento |
| `version` | INTEGER | NO | 1 | Versione record (optimistic locking) |

---

## 🔑 Indici e Vincoli

### PRIMARY KEY
```sql
PRIMARY KEY (response_id)
```
- Identificatore univoco di ogni risposta lambda
- Auto-generato da `gen_random_uuid()`
- Usato per lookup diretto di un singolo evento

### UNIQUE CONSTRAINT (Idempotency)
```sql
UNIQUE (job_card_id, push_timestamp)
```
- **Questa è la chiave di idempotency**
- Se lo stesso evento arriva due volte (same `job_card_id` + `push_timestamp`):
  - **Prima richiesta**: INSERT con `version = 1`
  - **Seconda richiesta**: ON CONFLICT → UPDATE con `version = 2`
- Nessun duplicato: stesso evento ritorna sempre lo stesso `response_id` aggiornato

### Indici Consigliati
```sql
-- Ricerca veloce per job_card_id
CREATE INDEX idx_communication_asyncro_djc_job_card_id 
  ON woc.comunication_asyncro_djc(job_card_id);

-- Ricerca veloce per status
CREATE INDEX idx_communication_asyncro_djc_status 
  ON woc.comunication_asyncro_djc(djc_sync_status);

-- Ricerca veloce per errori
CREATE INDEX idx_communication_asyncro_djc_error_code 
  ON woc.comunication_asyncro_djc(error_code) 
  WHERE error_code IS NOT NULL;

-- Ricerca per intervallo temporale
CREATE INDEX idx_communication_asyncro_djc_created_at 
  ON woc.comunication_asyncro_djc(created_at);
```

---

## 🔄 Pattern UPSERT (Usato dalla Lambda)

### Operazione 1: Primo Evento (INSERT)
```sql
INSERT INTO woc.comunication_asyncro_djc (
  response_id, job_card_id, push_timestamp, djc_sync_status, 
  json_payload, json_modified, error_code, error_message, ...
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, ...)
ON CONFLICT (job_card_id, push_timestamp)
DO UPDATE SET
  response_id = $1,
  djc_sync_status = $4,
  json_modified = $6,
  updated_at = $12,
  version = version + 1
RETURNING response_id, djc_sync_status, version;
```

**Risultato**: 
- ✅ Nuovo record creato con `version = 1`
- Response: `{ "statusCode": 200, "response": { "responseId": "uuid-1", "version": 1 } }`

### Operazione 2: Stesso Evento Arriva di Nuovo (UPDATE via ON CONFLICT)
```sql
-- Stessa query, stesso (job_card_id, push_timestamp)
```

**Risultato**:
- ✅ Record AGGIORNATO: `version = 2`, `updated_at = NOW()`
- ❌ **NESSUN duplicato** creato
- Response: `{ "statusCode": 200, "response": { "responseId": "uuid-1" (STESSO), "version": 2 } }`

---

## 📊 Valori Enum djc_sync_status

| Valore | Evento Kafka | error_code | error_message | Significato |
|--------|--------------|-----------|---------------|-------------|
| `SUCCESS_WITHOUT_UPDATE` | `DMS_PUSH_SUCCESS_WITHOUT_UPDATE` | NULL | NULL | DMS ha completato senza modificare dati |
| `SUCCESS_WITH_UPDATE` | `DMS_PUSH_SUCCESS_WITH_UPDATE` | NULL | NULL | DMS ha completato e modificato dati |
| `REFUSAL` | `DMS_PUSH_REFUSAL` | `DMS_PUSH_REFUSED` | "DMS ha rifiutato..." | DMS ha rifiutato il push (validazione fallita) |
| `FAILURE` | `DMS_PUSH_FAILURE` | `DMS_PUSH_FAILED` | "DMS ha riportato..." | DMS ha segnalato un fallimento |

---

## 🔍 Query Esempi

### 1. Selezionare tutti gli eventi per un job card
```sql
SELECT response_id, djc_sync_status, version, created_at, updated_at
FROM woc.comunication_asyncro_djc
WHERE job_card_id = 'JCID-42'
ORDER BY created_at DESC;
```

### 2. Contare i fallimenti/rifiuti
```sql
SELECT 
  djc_sync_status, 
  COUNT(*) as count
FROM woc.comunication_asyncro_djc
WHERE error_code IS NOT NULL
GROUP BY djc_sync_status;
```

### 3. Trovare record duplicati (stessi (job_card_id, push_timestamp))
```sql
SELECT job_card_id, push_timestamp, COUNT(*) as duplicate_count
FROM woc.comunication_asyncro_djc
GROUP BY job_card_id, push_timestamp
HAVING COUNT(*) > 1;
-- Dovrebbe sempre ritornare 0 grazie al UNIQUE constraint
```

### 4. Trovare event ritentati (version > 1)
```sql
SELECT response_id, job_card_id, version, created_at, updated_at
FROM woc.comunication_asyncro_djc
WHERE version > 1
ORDER BY version DESC;
```

### 5. Traccia audit per un response
```sql
SELECT 
  response_id, 
  json_payload->>'eventType' as eventType,
  djc_sync_status,
  version,
  created_at,
  updated_at
FROM woc.comunication_asyncro_djc
WHERE response_id = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';
```

---

## 🗑️ Cleanup/Archivio (Opzionale)

Dopo 90 giorni, archiviarsi record in tabella storica:

```sql
-- Creare tabella di archivio
CREATE TABLE woc.comunication_asyncro_djc_archive AS 
SELECT * FROM woc.comunication_asyncro_djc WHERE 1=0;

-- Archiviare record vecchi
INSERT INTO woc.comunication_asyncro_djc_archive
SELECT * FROM woc.comunication_asyncro_djc
WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';

-- Cancellare dal principale
DELETE FROM woc.comunication_asyncro_djc
WHERE created_at < CURRENT_TIMESTAMP - INTERVAL '90 days';
```

---

## 📝 Note Tecniche

### Aurora PostgreSQL
- **Engine**: Aurora PostgreSQL 13.x+
- **JSONB Support**: ✅ Nativo (usato per json_payload, json_modified)
- **UUID**: ✅ Nativo (usato per response_id)
- **DEFAULT CURRENT_TIMESTAMP**: ✅ Supportato

### Performance
- **Unique Constraint**: Indicizzato automaticamente
- **Indici consigliati**: Aggiunti per job_card_id, djc_sync_status, error_code, created_at
- **Partitioning** (Futuro): Considerare partitioning per time-series (per mese) se volume cresce

### Disaster Recovery
- **Backup**: Aurora automated backup (retention: 35 giorni default)
- **Point-in-time restore**: ✅ Supportato
- **Replication**: ✅ Aurora multi-AZ (standby automatico)

---

## ✅ Checklist Pre-Deployment

- [ ] Schema `woc` esiste su Aurora PostgreSQL
- [ ] Creare tabella con DDL completo
- [ ] Verificare indici sono stati creati
- [ ] Grant permessi lambda user (INSERT, UPDATE, SELECT)
- [ ] Testare UPSERT con stessi (job_card_id, push_timestamp) due volte
- [ ] Verificare `version` incrementa su UPDATE
- [ ] Verificare idempotency: stesso `response_id` per stesso evento
- [ ] Verificare Unique constraint impedisce duplicati
- [ ] Testare query di audit/ricerca
- [ ] Monitorare performance con dati reali

---

## 📚 Referenze

- **Specifica**: SRP DL KAFKA Specification.md (4 eventi supportati)
- **Lambda**: synch-status/index.js (query UPSERT)
- **Test**: synch-status/__tests__/index.test.js (test ON CONFLICT)
- **Database Pattern**: isStellantisBrand/shared/dbClient.js (Aurora connection)

---

**Versione**: 2.0 (SRP DL KAFKA Compliant)  
**Status**: ✅ Allineato con refactor synch-status (commit: 05d945d)  
**Data Aggiornamento**: 2026-09-18  
**Prossimo Review**: Post-integration test su Aurora reale
