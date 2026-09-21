# Stored Procedure: `insert_or_update_comunication_asyncro_djc`

## 📋 Sommario

Stored procedure PostgreSQL per **inserire o aggiornare** record nella tabella `woc.comunication_asyncro_djc`.

Implementa la logica **INSERT con ON CONFLICT (UPSERT)** con automazione del flag `djc_sync_status`:
- **`djc = 'Y'`** → `djc_sync_status = 'PENDING'` (dati pushati verso DJC)
- **`djc = 'N'`** → `djc_sync_status = 'NOT_PENDING'` (dati modificati, NON pushati verso DJC)
- **`djc = NULL`** → Normalizzato a `'Y'` (comportamento default)

---

## 🚀 Utilizzo dalla Lambda

### Typescript/Node.js - Connessione Aurora PostgreSQL

```javascript
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: true
});

// Calling the stored procedure
const result = await pool.query(
  `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
    $1, $2, $3, $4, $5, $6
  )`,
  [
    jobCardId,           // p_job_card_id
    ambito,              // p_ambito
    timestamp,           // p_push_timestamp
    djcFlag,             // p_djc ('Y', 'N', or null)
    JSON.stringify(payload),        // p_json_payload
    JSON.stringify(jsonModified)    // p_json_modified
  ]
);

const { response_id, djc_sync_status, version } = result.rows[0];
```

---

## 📊 Parametri di Input

| Parametro | Tipo | Obbligatorio | Default | Descrizione |
|-----------|------|---|---|---|
| `p_job_card_id` | VARCHAR(50) | ✅ Sì | - | Identificatore della job card |
| `p_ambito` | VARCHAR(100) | ✅ Sì | - | Ambito/contesto dell'evento (es. 'PAINT_COLOR_CHANGE') |
| `p_push_timestamp` | TIMESTAMP | ✅ Sì | - | Timestamp del push verso DJC (ISO 8601) |
| `p_djc` | VARCHAR(1) | ❌ No | 'Y' | Flag Y/N: 'Y' = push verso DJC, 'N' = NON pushato |
| `p_json_payload` | JSONB | ✅ Sì | - | Payload JSON originale con i dati modificati |
| `p_json_modified` | JSONB | ✅ Sì | - | Metadati JSON dell'evento (eventType, receivedAt, ...) |

---

## 📤 Ritorno (RETURN)

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| `response_id` | UUID | ID univoco del record (generato al primo INSERT, immutabile) |
| `djc_sync_status` | ENUM | Stato sincronizzazione: `PENDING` o `NOT_PENDING` |
| `version` | INTEGER | Numero versione (per optimistic locking; incrementato ad ogni UPDATE) |

---

## 🧪 Esempi

### Esempio 1: Primo INSERT - Dati pushati verso DJC (`djc='Y'`)

```javascript
// Lambda che fa il push dei dati modificati verso DJC
const result = await pool.query(
  `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
    $1, $2, $3, $4, $5, $6
  )`,
  [
    'JC-20260918-001',                    // job_card_id
    'PAINT_COLOR_CHANGE',                 // ambito
    '2026-09-18T12:00:00Z',              // push_timestamp
    'Y',                                  // djc (pushato verso DJC)
    JSON.stringify({                      // json_payload
      jobCardId: 'JC-20260918-001',
      changes: ['color'],
      newColor: 'RED'
    }),
    JSON.stringify({                      // json_modified
      eventType: 'PAINT_MODIFIED',
      receivedAt: '2026-09-18T12:00:00Z'
    })
  ]
);

console.log(result.rows[0]);
// Output:
// {
//   response_id: '550e8400-e29b-41d4-a716-446655440000',
//   djc_sync_status: 'PENDING',
//   version: 1
// }
```

---

### Esempio 2: Primo INSERT - Dati NON pushati verso DJC (`djc='N'`)

```javascript
// Lambda che ha modificato i dati ma NON li ha pushati verso DJC
const result = await pool.query(
  `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
    $1, $2, $3, $4, $5, $6
  )`,
  [
    'JC-20260918-002',                    // job_card_id
    'INTERIOR_COLOR_CHANGE',              // ambito
    '2026-09-18T13:00:00Z',              // push_timestamp
    'N',                                  // djc (NON pushato verso DJC)
    JSON.stringify({                      // json_payload
      jobCardId: 'JC-20260918-002',
      changes: ['interior_color'],
      newInteriorColor: 'BEIGE'
    }),
    JSON.stringify({                      // json_modified
      eventType: 'INTERIOR_MODIFIED',
      receivedAt: '2026-09-18T13:00:00Z'
    })
  ]
);

console.log(result.rows[0]);
// Output:
// {
//   response_id: '660e8400-e29b-41d4-a716-446655440001',
//   djc_sync_status: 'NOT_PENDING',
//   version: 1
// }
```

---

### Esempio 3: INSERT - Flag `djc=NULL` (normalizzato a 'Y' → PENDING)

```javascript
// Nessun flag specificato → default 'Y' → PENDING
const result = await pool.query(
  `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
    $1, $2, $3, $4, $5, $6
  )`,
  [
    'JC-20260918-003',                    // job_card_id
    'ENGINE_OPTION',                      // ambito
    '2026-09-18T14:00:00Z',              // push_timestamp
    null,                                 // djc (NULL → normalizzato a 'Y')
    JSON.stringify({                      // json_payload
      jobCardId: 'JC-20260918-003',
      changes: ['engine']
    }),
    JSON.stringify({                      // json_modified
      eventType: 'ENGINE_MODIFIED',
      receivedAt: '2026-09-18T14:00:00Z'
    })
  ]
);

console.log(result.rows[0]);
// Output:
// {
//   response_id: '770e8400-e29b-41d4-a716-446655440002',
//   djc_sync_status: 'PENDING',  // NULL → 'Y' → PENDING
//   version: 1
// }
```

---

### Esempio 4: UPDATE (UPSERT) - Record esistente con stessa chiave

```javascript
// Stessa richiesta o cambio di stato
// (job_card_id='JC-20260918-001', push_timestamp='2026-09-18T12:00:00Z' esiste già)
const result = await pool.query(
  `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
    $1, $2, $3, $4, $5, $6
  )`,
  [
    'JC-20260918-001',                    // job_card_id (stesso del primo insert)
    'PAINT_COLOR_CHANGE',                 // ambito
    '2026-09-18T12:00:00Z',              // push_timestamp (stesso del primo insert)
    'N',                                  // djc (cambia da 'Y' a 'N')
    JSON.stringify({                      // json_payload (rimane quello originale)
      jobCardId: 'JC-20260918-001',
      changes: ['color'],
      newColor: 'RED'
    }),
    JSON.stringify({                      // json_modified (aggiornato)
      eventType: 'PAINT_MODIFIED',
      receivedAt: '2026-09-18T12:00:00Z',
      updated: true
    })
  ]
);

console.log(result.rows[0]);
// Output:
// {
//   response_id: '550e8400-e29b-41d4-a716-446655440000',  // STESSO (PK invariato)
//   djc_sync_status: 'NOT_PENDING',                        // AGGIORNATO a NOT_PENDING
//   version: 2                                             // INCREMENTATO da 1 a 2
// }
```

---

## 🔴 IMPORTANTE - Comportamento ON CONFLICT (UPSERT)

### Primo INSERT (record non esiste)
- ✅ Crea nuovo record con `response_id` generato (UUID)
- ✅ Imposta `djc_sync_status` = `'PENDING'` (se `djc='Y'`) o `'NOT_PENDING'` (se `djc='N'`)
- ✅ `created_at` = NOW() (impostato dal trigger INSERT)
- ✅ `version` = 1 (default)
- ✅ Ritorna: `(response_id, djc_sync_status, version)`

### UPDATE (record esiste: chiave UNIQUE violata)
- ✅ Aggiorna: `djc_sync_status`, `djc`, `json_modified`, `version`
- ✅ `version` incrementato di 1 (optimistic locking)
- ✅ `updated_at` aggiornato dal trigger BEFORE UPDATE
- ❌ `response_id` rimane INVARIATO (è la PK)
- ❌ `created_at` rimane INVARIATO (è immutabile)
- ❌ `json_payload` rimane INVARIATO (storico dei dati originali)
- ✅ Ritorna: `(response_id ORIGINALE, djc_sync_status AGGIORNATO, version INCREMENTATO)`

---

## 🔧 Gestione della Validazione

### Validazione del flag `djc`

La stored procedure valida il flag `djc`:

```javascript
IF v_djc_flag NOT IN ('Y', 'N') THEN
  RAISE EXCEPTION 'Errore validazione: djc deve essere ''Y'' o ''N'', ricevuto: %', v_djc_flag;
END IF;
```

**Comportamento:**
- ✅ `'Y'` → Valido (→ `djc_sync_status = 'PENDING'`)
- ✅ `'N'` → Valido (→ `djc_sync_status = 'NOT_PENDING'`)
- ✅ `NULL` → Normalizzato a `'Y'` (→ `djc_sync_status = 'PENDING'`)
- ❌ Altro → EXCEPTION (lancio errore con messaggio)

### Gestione Errori

```javascript
try {
  const result = await pool.query(
    `SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(...)`,
    [...]
  );
  const { response_id, djc_sync_status, version } = result.rows[0];
  logger.info('Record inserito/aggiornato con successo', {
    response_id,
    djc_sync_status,
    version
  });
} catch (error) {
  if (error.message.includes('djc deve essere')) {
    logger.error('Errore validazione: flag djc non valido', { error: error.message });
  } else {
    logger.error('Errore durante INSERT/UPDATE', { error });
  }
  throw error;
}
```

---

## 📊 Logica Deterministica di `djc_sync_status`

```
INPUT: p_djc (VARCHAR(1))
  │
  ├─ NULL?
  │  └─ YES → Normalizza a 'Y'
  │
  └─ NO → Valida ('Y' o 'N')
     │
     ├─ Valido?
     │  ├─ 'Y' → djc_sync_status = 'PENDING'
     │  └─ 'N' → djc_sync_status = 'NOT_PENDING'
     │
     └─ Non valido → EXCEPTION

OUTPUT: djc_sync_status (ENUM)
```

---

## 🔄 Ciclo di Vita di un Record

```
1. Lambda XXX crea il record (primo INSERT)
   ├─ djc = 'Y' → djc_sync_status = 'PENDING'
   ├─ response_id = gen_random_uuid()
   ├─ created_at = NOW() (trigger)
   ├─ version = 1
   └─ json_payload = payload originale (immutabile d'ora in poi)

2. Stessa lambda richiama (UPDATE) con stessa chiave (job_card_id, push_timestamp)
   ├─ djc_sync_status aggiornato (se necessario)
   ├─ djc aggiornato (se necessario)
   ├─ json_modified aggiornato
   ├─ version incrementato a 2
   ├─ updated_at = NOW() (trigger)
   ├─ response_id rimane INVARIATO
   └─ json_payload rimane INVARIATO

3. syncro-kafka-events riceve evento da DJC
   └─ Aggiorna SOLO djc_sync_status a uno dei 4 stati finali
      (SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE)
      via UPDATE query, NON via questa stored procedure
```

---

## 📝 Note Operative

1. **Idempotency**: Chiamate duplicate con stessa `(job_card_id, push_timestamp)` sono sicure (ON CONFLICT gestisce)
2. **Version Control**: Usare `version` per optimistic locking (evitare race conditions)
3. **Timestamp Management**: `created_at` e `updated_at` sono gestiti dai trigger, non dalla SP
4. **Immutabilità**: Una volta inseriti, `response_id`, `job_card_id`, `push_timestamp`, `json_payload` non cambiano mai
5. **Aurora Compatibility**: Tested con Aurora PostgreSQL 12+

---

## 🚀 Deployment

### 1. Connettersi ad Aurora PostgreSQL

```bash
psql -h <your-cluster-endpoint> \
     -U <admin-user> \
     -d <database-name> \
     -f docs/stored_procedure_insert_comunication_asyncro_djc.sql
```

### 2. Verificare la creazione

```sql
-- Verificare che la stored procedure sia stata creata
SELECT routine_name, routine_definition
FROM information_schema.routines
WHERE routine_schema = 'woc' 
  AND routine_name = 'insert_or_update_comunication_asyncro_djc';
```

### 3. Test rapido

```sql
SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
  'TEST-JC-001',
  'TEST_AMBITO',
  NOW(),
  'Y',
  '{"test": true}'::JSONB,
  '{"test": true}'::JSONB
);
```

---

## ❌ Troubleshooting

| Errore | Causa | Soluzione |
|--------|-------|-----------|
| `function ... does not exist` | SP non creata | Eseguire lo script SQL di creazione |
| `djc deve essere Y o N` | Flag `djc` non valido | Passare 'Y', 'N', o NULL |
| `duplicate key value` | UNIQUE constraint violated | Controllare (job_card_id, push_timestamp) |
| `relation "woc.comunication_asyncro_djc" does not exist` | Tabella non creata | Creare prima la tabella con lo schema DDL |

---

## 📚 Documentazione Correlata

- `docs/stored_procedure_insert_comunication_asyncro_djc.sql` - Codice sorgente completo con commenti
- `docs/CURL_SYNCRO_KAFKA_EVENTS.md` - API di syncro-kafka-events (uso della SP per UPDATE)
- `syncro-kafka-events/__tests__/README.md` - Schema tabella e flussi

