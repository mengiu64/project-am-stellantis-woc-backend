-- ═══════════════════════════════════════════════════════════════════════════════
-- 📦 STORED PROCEDURE: insert_or_update_comunication_asyncro_djc
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- DESCRIZIONE:
--   Inserisce un nuovo record nella tabella woc.comunication_asyncro_djc
--   oppure aggiorna il record esistente se (job_card_id, push_timestamp) esiste.
--
--   La stored procedure implementa la logica per determinare djc_sync_status
--   in base al flag djc:
--     - Se djc = 'N' → djc_sync_status = 'NOT_PENDING' (dati modificati, NON pushati verso DJC)
--     - Se djc = 'Y' o NULL → djc_sync_status = 'PENDING' (dati pushati verso DJC)
--
-- PARAMETRI DI INPUT:
--   p_job_card_id      VARCHAR(50)     - Identificatore della job card
--   p_ambito            VARCHAR(100)    - Ambito/contesto dell'evento
--   p_push_timestamp    TIMESTAMP       - Timestamp del push
--   p_djc               VARCHAR(1)      - Flag Y/N (default 'Y'), gestione DJC
--   p_json_payload      JSONB           - Payload JSON originale
--   p_json_modified     JSONB           - Metadati JSON dell'evento
--
-- RETURN:
--   response_id         UUID            - ID univoco del record (primary key)
--   djc_sync_status     djc_sync_status - Stato sincronizzazione (PENDING o NOT_PENDING)
--   version             INTEGER         - Numero versione del record (per optimistic locking)
--
-- COMPORTAMENTO ON CONFLICT (UPSERT):
--   Se il record esiste (duplicate key on job_card_id, push_timestamp):
--     - Aggiorna: djc_sync_status, djc, json_modified, version
--     - NON modifica: response_id, created_at
--     - updated_at è gestito dal trigger PostgreSQL (BEFORE UPDATE)
--
-- GESTIONE TIMESTAMP:
--   - created_at: impostato da trigger INSERT (se è il primo insert)
--   - updated_at: gestito da trigger BEFORE UPDATE (incrementa ad ogni UPDATE)
--
-- GESTIONE DEFAULTS:
--   - retry_count: usa DEFAULT 0 (non modificato in questa SP)
--   - source_system: usa DEFAULT 'DJC' (non modificato in questa SP)
--   - created_by: usa DEFAULT 'djc-lambda' (non modificato in questa SP)
--
-- ═══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION woc.insert_or_update_comunication_asyncro_djc(
  p_job_card_id VARCHAR(50),
  p_ambito VARCHAR(100),
  p_push_timestamp TIMESTAMP,
  p_djc VARCHAR(1) DEFAULT 'Y',
  p_json_payload JSONB,
  p_json_modified JSONB
)
RETURNS TABLE (
  response_id UUID,
  djc_sync_status woc.djc_sync_status,
  version INTEGER
) AS $$
DECLARE
  -- 🔴 Variabili locali per la logica
  v_djc_sync_status woc.djc_sync_status;
  v_djc_flag VARCHAR(1);
BEGIN
  -- ─────────────────────────────────────────────────────────────────────────
  -- 1️⃣ NORMALIZZA il flag djc: NULL diventa 'Y'
  -- ─────────────────────────────────────────────────────────────────────────
  v_djc_flag := COALESCE(p_djc, 'Y');
  
  -- ─────────────────────────────────────────────────────────────────────────
  -- 2️⃣ VALIDA il flag djc
  -- ─────────────────────────────────────────────────────────────────────────
  IF v_djc_flag NOT IN ('Y', 'N') THEN
    RAISE EXCEPTION 'Errore validazione: djc deve essere ''Y'' o ''N'', ricevuto: %', v_djc_flag;
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────
  -- 3️⃣ DETERMINA djc_sync_status in base al flag djc
  -- ─────────────────────────────────────────────────────────────────────────
  -- 🔴 LOGICA CRITICA:
  --    - Se djc = 'N' → djc_sync_status = 'NOT_PENDING' (dati modificati, NON pushati verso DJC)
  --    - Se djc = 'Y' → djc_sync_status = 'PENDING' (dati pushati verso DJC)
  IF v_djc_flag = 'N' THEN
    v_djc_sync_status := 'NOT_PENDING';
  ELSE
    -- v_djc_flag = 'Y'
    v_djc_sync_status := 'PENDING';
  END IF;
  
  -- ─────────────────────────────────────────────────────────────────────────
  -- 4️⃣ INSERT con ON CONFLICT (UPSERT)
  -- ─────────────────────────────────────────────────────────────────────────
  -- 🔴 COMPORTAMENTO:
  --    - INSERT: Crea nuovo record con response_id auto-generato (gen_random_uuid())
  --    - ON CONFLICT: Se (job_card_id, push_timestamp) esiste, esegui UPDATE
  --    - created_at: NON modificato (trigger INSERT imposta il valore)
  --    - updated_at: NON modificato qui (trigger BEFORE UPDATE lo gestisce)
  --    - version: Incrementato ad ogni UPDATE (version + 1)
  RETURN QUERY
  INSERT INTO woc.comunication_asyncro_djc (
    response_id,      -- $1: UUID auto-generato
    job_card_id,      -- $2: Chiave primaria (parte 1)
    ambito,           -- $3: Ambito/contesto
    push_timestamp,   -- $4: Chiave primaria (parte 2)
    djc_sync_status,  -- $5: Determinato dalla logica sopra
    djc,              -- $6: Flag Y/N normalizzato
    json_payload,     -- $7: Payload originale
    json_modified     -- $8: Metadati
    -- NOTA: retry_count, source_system, created_by, created_at, updated_at, version
    --       usano i DEFAULT del database o sono gestiti da trigger
  )
  VALUES (
    gen_random_uuid(),     -- response_id: genera UUID univoco
    p_job_card_id,         -- job_card_id: da parametro
    p_ambito,              -- ambito: da parametro
    p_push_timestamp,      -- push_timestamp: da parametro
    v_djc_sync_status,     -- djc_sync_status: calcolato dalla logica (PENDING o NOT_PENDING)
    v_djc_flag,            -- djc: normalizzato a 'Y' o 'N'
    p_json_payload,        -- json_payload: da parametro
    p_json_modified        -- json_modified: da parametro
  )
  ON CONFLICT (job_card_id, push_timestamp)
  DO UPDATE SET
    -- 🔴 UPSERT: Se il record esiste, aggiorna SOLO questi campi
    djc_sync_status = EXCLUDED.djc_sync_status,  -- Aggiorna stato sincronizzazione
    djc = EXCLUDED.djc,                          -- Aggiorna flag djc
    json_modified = EXCLUDED.json_modified,      -- Aggiorna metadati
    version = woc.comunication_asyncro_djc.version + 1  -- Incrementa version (optimistic locking)
    -- 🔴 NON aggiornate qui:
    --    - response_id: è la PK, rimane invariato
    --    - job_card_id, push_timestamp: sono le chiavi UNIQUE, non modificabili
    --    - json_payload: rimane quello originale del primo INSERT
    --    - created_at: impostato al primo INSERT, non modificabile
    --    - updated_at: gestito dal trigger BEFORE UPDATE
  RETURNING
    woc.comunication_asyncro_djc.response_id,
    woc.comunication_asyncro_djc.djc_sync_status,
    woc.comunication_asyncro_djc.version;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════════════════════════
-- 🧪 ESEMPI DI UTILIZZO DELLA STORED PROCEDURE
-- ═══════════════════════════════════════════════════════════════════════════════

-- ✅ ESEMPIO 1: Inserimento con djc='Y' (PENDING)
-- Scenario: Lambda pushata i dati modificati verso DJC
/*
SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
  p_job_card_id := 'JC-20260918-001',
  p_ambito := 'PAINT_COLOR_CHANGE',
  p_push_timestamp := '2026-09-18T12:00:00Z',
  p_djc := 'Y',
  p_json_payload := '{"jobCardId":"JC-20260918-001","changes":["color"]}'::JSONB,
  p_json_modified := '{"eventType":"PAINT_MODIFIED","receivedAt":"2026-09-18T12:00:00Z"}'::JSONB
);
-- RITORNA:
--   response_id: 550e8400-e29b-41d4-a716-446655440000
--   djc_sync_status: PENDING
--   version: 1
*/

-- ✅ ESEMPIO 2: Inserimento con djc='N' (NOT_PENDING)
-- Scenario: Lambda ha modificato i dati ma NON li ha pushati verso DJC
/*
SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
  p_job_card_id := 'JC-20260918-002',
  p_ambito := 'INTERIOR_COLOR_CHANGE',
  p_push_timestamp := '2026-09-18T13:00:00Z',
  p_djc := 'N',
  p_json_payload := '{"jobCardId":"JC-20260918-002","changes":["interior_color"]}'::JSONB,
  p_json_modified := '{"eventType":"INTERIOR_MODIFIED","receivedAt":"2026-09-18T13:00:00Z"}'::JSONB
);
-- RITORNA:
--   response_id: 660e8400-e29b-41d4-a716-446655440001
--   djc_sync_status: NOT_PENDING
--   version: 1
*/

-- ✅ ESEMPIO 3: Inserimento con djc=NULL (default 'Y' → PENDING)
-- Scenario: Nessun flag specificato, assume comportamento default
/*
SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
  p_job_card_id := 'JC-20260918-003',
  p_ambito := 'ENGINE_OPTION',
  p_push_timestamp := '2026-09-18T14:00:00Z',
  p_djc := NULL,  -- NULL → diventa 'Y' → PENDING
  p_json_payload := '{"jobCardId":"JC-20260918-003","changes":["engine"]}'::JSONB,
  p_json_modified := '{"eventType":"ENGINE_MODIFIED","receivedAt":"2026-09-18T14:00:00Z"}'::JSONB
);
-- RITORNA:
--   response_id: 770e8400-e29b-41d4-a716-446655440002
--   djc_sync_status: PENDING
--   version: 1
*/

-- ✅ ESEMPIO 4: UPDATE (UPSERT) - Stesso job_card_id + push_timestamp
-- Scenario: Richiesta duplicata o cambio di stato per lo stesso evento
/*
SELECT * FROM woc.insert_or_update_comunication_asyncro_djc(
  p_job_card_id := 'JC-20260918-001',  -- Stesso della richiesta precedente
  p_ambito := 'PAINT_COLOR_CHANGE',
  p_push_timestamp := '2026-09-18T12:00:00Z',  -- Stesso timestamp
  p_djc := 'N',  -- Cambio da 'Y' a 'N'
  p_json_payload := '{"jobCardId":"JC-20260918-001","changes":["color"]}'::JSONB,
  p_json_modified := '{"eventType":"PAINT_MODIFIED","receivedAt":"2026-09-18T12:00:00Z","updated":true}'::JSONB
);
-- RITORNA:
--   response_id: 550e8400-e29b-41d4-a716-446655440000  -- STESSO (PK invariato)
--   djc_sync_status: NOT_PENDING  -- Aggiornato a NOT_PENDING
--   version: 2  -- Incrementato da 1 a 2
*/

-- ═══════════════════════════════════════════════════════════════════════════════
-- 🔴 COMPORTAMENTO DELLA STORED PROCEDURE
-- ═══════════════════════════════════════════════════════════════════════════════
--
-- 1️⃣ PRIMO INSERT (record non esiste)
--    - Crea nuovo record con response_id generato (UUID)
--    - Imposta djc_sync_status = 'PENDING' (se djc='Y') o 'NOT_PENDING' (se djc='N')
--    - created_at = NOW() (impostato dal trigger INSERT)
--    - version = 1 (default)
--    - RITORNA: (response_id, djc_sync_status, version)
--
-- 2️⃣ UPDATE (record esiste: (job_card_id, push_timestamp) già presenti)
--    - Aggiorna: djc_sync_status, djc, json_modified, version
--    - version incrementato di 1 (optimistic locking)
--    - updated_at aggiornato dal trigger BEFORE UPDATE
--    - response_id rimane INVARIATO (è la PK)
--    - created_at rimane INVARIATO (è immutabile)
--    - RITORNA: (response_id ORIGINALE, djc_sync_status AGGIORNATO, version INCREMENTATO)
--
-- 3️⃣ GESTIONE FLAG djc
--    - NULL → normalizzato a 'Y' (comportamento default)
--    - 'Y' → djc_sync_status = 'PENDING'
--    - 'N' → djc_sync_status = 'NOT_PENDING'
--    - Altro → EXCEPTION (errore di validazione)
--
-- 4️⃣ CAMPI IMMUTABILI (una volta settati, non cambiano mai)
--    - response_id: UUID PK, generato al primo insert
--    - job_card_id: parte della chiave UNIQUE, non modificabile
--    - push_timestamp: parte della chiave UNIQUE, non modificabile
--    - json_payload: rimane quello del primo insert (storico dati originali)
--    - created_at: impostato al primo insert, trigger-managed
--    - created_by: default 'djc-lambda'
--    - source_system: default 'DJC'
--
-- ═══════════════════════════════════════════════════════════════════════════════
