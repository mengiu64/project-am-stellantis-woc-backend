-- ============================================================================
-- create_table_comunication_asyncro_djc.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Oggetti:
--   1) TYPE  woc.djc_sync_status  — enum stati sincronizzazione DJC (6 valori)
--   2) TABLE woc.comunication_asyncro_djc — eventi Kafka asincroni da DJC
--   3) Indici, trigger (created_at/updated_at) e stored procedure UPSERT
--
-- Owner (logico): syncro-kafka-events Lambda
-- Registra gli eventi Kafka ricevuti da DJC (push asincrono JobCard).
-- ============================================================================

BEGIN;

-- ── Schema dedicato ─────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS woc;

-- ============================================================================
-- 1) TYPE woc.djc_sync_status
--    Enum degli stati di sincronizzazione asincrona con DJC (6 valori)
-- ============================================================================
DROP TYPE IF EXISTS woc.djc_sync_status CASCADE;

CREATE TYPE woc.djc_sync_status AS ENUM (
    'PENDING',                -- Una lambda ha pushato dei dati modificati verso DJC
    'NOT_PENDING',            -- Una lambda ha modificato dei dati ma NON ha pushato i dati modificati verso DJC
    'SUCCESS_WITHOUT_UPDATE', -- DMS ha completato senza modificare dati
    'SUCCESS_WITH_UPDATE',    -- DMS ha completato e modificato dati
    'REFUSAL',                -- DMS ha rifiutato il push
    'FAILURE'                 -- DMS ha segnalato un fallimento
);

COMMENT ON TYPE woc.djc_sync_status IS 'Stati della sincronizzazione asincrona con il servizio DJC (6 valori)';

-- ============================================================================
-- 2) COMUNICATION_ASYNCRO_DJC
--    PK: response_id (UUID)
--    UK: (job_card_id, push_timestamp) — idempotency
-- ============================================================================
DROP TABLE IF EXISTS woc.comunication_asyncro_djc CASCADE;

CREATE TABLE woc.comunication_asyncro_djc
(
    response_id      UUID                  NOT NULL DEFAULT gen_random_uuid(),
    job_card_id      VARCHAR(50)           NOT NULL,
    ambito           VARCHAR(100)          NOT NULL,
    push_timestamp   TIMESTAMPTZ           NOT NULL,
    djc_sync_status  woc.djc_sync_status   NOT NULL,
    djc              VARCHAR(1)            NOT NULL DEFAULT 'Y',
    json_payload     JSONB                 NOT NULL,
    json_modified    JSONB                 NOT NULL,
    retry_count      INTEGER               NOT NULL DEFAULT 0,
    source_system    VARCHAR(50)           NOT NULL DEFAULT 'DJC',
    created_by       VARCHAR(100)          NOT NULL DEFAULT 'djc-lambda',
    created_at       TIMESTAMPTZ           NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ           NOT NULL DEFAULT now(),
    version          INTEGER               NOT NULL DEFAULT 1,

    CONSTRAINT pk_comunication_asyncro_djc PRIMARY KEY (response_id),
    CONSTRAINT uk_comunication_asyncro_djc_idempotency UNIQUE (job_card_id, push_timestamp),
    CONSTRAINT djc_flag_valid CHECK (djc IN ('Y', 'N'))
);

CREATE INDEX idx_comunication_asyncro_djc_job_card_id ON woc.comunication_asyncro_djc (job_card_id);
CREATE INDEX idx_comunication_asyncro_djc_status      ON woc.comunication_asyncro_djc (djc_sync_status);
CREATE INDEX idx_comunication_asyncro_djc_created_at  ON woc.comunication_asyncro_djc (created_at);

COMMENT ON TABLE  woc.comunication_asyncro_djc IS 'Eventi Kafka asincroni ricevuti da DJC per i push di JobCard (owner: syncro-kafka-events)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.response_id     IS 'PK: ID univoco risposta Lambda (UUID)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.job_card_id     IS 'Identificatore job card (da payload) — es. JCID-42';
COMMENT ON COLUMN woc.comunication_asyncro_djc.ambito          IS 'Ambito che e'' stato aggiornato dai dati del push';
COMMENT ON COLUMN woc.comunication_asyncro_djc.push_timestamp  IS 'Timestamp evento Kafka (da payload)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.djc_sync_status IS 'Stato evento (PENDING, NOT_PENDING, SUCCESS_WITHOUT_UPDATE, SUCCESS_WITH_UPDATE, REFUSAL, FAILURE)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.djc             IS 'Flag che puo'' assumere 2 valori: Y e N';
COMMENT ON COLUMN woc.comunication_asyncro_djc.json_payload    IS 'Payload originale ricevuto da DJC';
COMMENT ON COLUMN woc.comunication_asyncro_djc.json_modified   IS 'Metadati elaborati (eventType, receivedAt, etc.)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.retry_count     IS 'Contatore retry (default 0)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.source_system   IS 'Sistema di provenienza evento (default DJC)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.created_by      IS 'Identita'' creatore record (default djc-lambda)';
COMMENT ON COLUMN woc.comunication_asyncro_djc.created_at      IS 'Timestamp creazione record';
COMMENT ON COLUMN woc.comunication_asyncro_djc.updated_at      IS 'Timestamp ultimo aggiornamento';
COMMENT ON COLUMN woc.comunication_asyncro_djc.version         IS 'Versione record (optimistic locking)';
COMMENT ON CONSTRAINT uk_comunication_asyncro_djc_idempotency ON woc.comunication_asyncro_djc
    IS 'Chiave di idempotency: nessun duplicato per stesso (job_card_id, push_timestamp)';

-- ============================================================================
-- Trigger: gestione automatica created_at (INSERT) e updated_at (UPDATE)
-- ============================================================================

-- Funzione: aggiorna updated_at ad ogni UPDATE
CREATE OR REPLACE FUNCTION woc.update_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Funzione: imposta created_at al primo INSERT
CREATE OR REPLACE FUNCTION woc.set_created_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_comunication_asyncro_djc_updated_at
    BEFORE UPDATE ON woc.comunication_asyncro_djc
    FOR EACH ROW EXECUTE FUNCTION woc.update_updated_at_timestamp();

CREATE TRIGGER insert_comunication_asyncro_djc_created_at
    BEFORE INSERT ON woc.comunication_asyncro_djc
    FOR EACH ROW EXECUTE FUNCTION woc.set_created_at_timestamp();

-- ============================================================================
-- Stored procedure UPSERT: insert_or_update_comunication_asyncro_djc
--   - djc = 'N'        -> djc_sync_status = 'NOT_PENDING'
--   - djc = 'Y'/NULL   -> djc_sync_status = 'PENDING'
--   ON CONFLICT (job_card_id, push_timestamp) -> UPDATE (version++)
-- ============================================================================
CREATE OR REPLACE FUNCTION woc.insert_or_update_comunication_asyncro_djc(
    p_job_card_id    VARCHAR(50),
    p_ambito         VARCHAR(100),
    p_push_timestamp TIMESTAMPTZ,
    p_json_payload   JSONB,
    p_json_modified  JSONB,
    p_djc            VARCHAR(1) DEFAULT 'Y'
)
RETURNS TABLE (
    response_id     UUID,
    djc_sync_status woc.djc_sync_status,
    version         INTEGER
) AS $$
DECLARE
    v_djc_flag        VARCHAR(1);
    v_djc_sync_status woc.djc_sync_status;
BEGIN
    -- 1) Normalizza il flag djc: NULL diventa 'Y'
    v_djc_flag := COALESCE(p_djc, 'Y');

    -- 2) Valida il flag djc
    IF v_djc_flag NOT IN ('Y', 'N') THEN
        RAISE EXCEPTION 'Errore validazione: djc deve essere ''Y'' o ''N'', ricevuto: %', v_djc_flag;
    END IF;

    -- 3) Determina djc_sync_status in base al flag djc
    IF v_djc_flag = 'N' THEN
        v_djc_sync_status := 'NOT_PENDING';
    ELSE
        v_djc_sync_status := 'PENDING';
    END IF;

    -- 4) INSERT con ON CONFLICT (UPSERT)
    RETURN QUERY
    INSERT INTO woc.comunication_asyncro_djc (
        job_card_id,
        ambito,
        push_timestamp,
        djc_sync_status,
        djc,
        json_payload,
        json_modified
        -- retry_count, source_system, created_by, created_at, updated_at, version:
        -- usano i DEFAULT del database o sono gestiti dai trigger
    )
    VALUES (
        p_job_card_id,
        p_ambito,
        p_push_timestamp,
        v_djc_sync_status,
        v_djc_flag,
        p_json_payload,
        p_json_modified
    )
    ON CONFLICT (job_card_id, push_timestamp)
    DO UPDATE SET
        djc_sync_status = EXCLUDED.djc_sync_status,
        djc             = EXCLUDED.djc,
        json_modified   = EXCLUDED.json_modified,
        version         = woc.comunication_asyncro_djc.version + 1
        -- updated_at NON impostato qui: ci pensa il trigger BEFORE UPDATE
    RETURNING
        woc.comunication_asyncro_djc.response_id,
        woc.comunication_asyncro_djc.djc_sync_status,
        woc.comunication_asyncro_djc.version;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION woc.insert_or_update_comunication_asyncro_djc(VARCHAR, VARCHAR, TIMESTAMPTZ, JSONB, JSONB, VARCHAR)
    IS 'UPSERT idempotente su (job_card_id, push_timestamp); imposta djc_sync_status da flag djc e incrementa version su conflitto';

-- ============================================================================
-- GRANT privilegi all'utente applicativo
-- ============================================================================
-- GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE woc.comunication_asyncro_djc TO wiadvisor_app;
GRANT EXECUTE ON FUNCTION woc.insert_or_update_comunication_asyncro_djc(VARCHAR, VARCHAR, TIMESTAMPTZ, JSONB, JSONB, VARCHAR) TO wiadvisor_app;

COMMIT;
