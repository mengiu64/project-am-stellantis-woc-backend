-- ============================================================================
-- create_table_dml_configurations.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Tabelle:
--   1) dml_enabled_markets — mercati (country+language) abilitati alla sync
--                            giornaliera company-types/customer-titles
--   2) dml_configurations  — cache dell'ultima risposta DML company-types/
--                            customer-titles per mercato, popolata dalla
--                            lambda "dmlConfigSync" (sync 1 volta al giorno)
--                            e letta da "session" al posto delle chiamate
--                            live a dms/getCompanyTypes e dms/getCustomerTitles.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

-- ============================================================================
-- 1) DML_ENABLED_MARKETS
--    PK: (country, language)
--    Consente di abilitare/disabilitare mercati alla sync senza redeploy.
-- ============================================================================
DROP TABLE IF EXISTS woc.dml_enabled_markets;

CREATE TABLE woc.dml_enabled_markets
(
    country     VARCHAR(5)  NOT NULL,
    language    VARCHAR(10) NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_dml_enabled_markets PRIMARY KEY (country, language)
);

COMMENT ON TABLE woc.dml_enabled_markets IS 'Mercati (country+language) abilitati alla sync giornaliera company-types/customer-titles DML';
COMMENT ON COLUMN woc.dml_enabled_markets.country    IS 'Codice paese ISO2 minuscolo (es. fr) — parametro "country" dell''API DML';
COMMENT ON COLUMN woc.dml_enabled_markets.language   IS 'Codice lingua minuscolo (es. fr) — parametro "language" dell''API DML';
COMMENT ON COLUMN woc.dml_enabled_markets.active     IS 'TRUE se il mercato deve essere sincronizzato dal job giornaliero (dmlConfigSync)';

-- Seed: unico mercato confermato/attivo ad oggi (Francia).
INSERT INTO woc.dml_enabled_markets (country, language, active) VALUES
    ('fr', 'fr', TRUE);

-- ============================================================================
-- 2) DML_CONFIGURATIONS
--    PK: (country, language)
--    Una riga per mercato, aggiornata (UPSERT) ad ogni esecuzione del job
--    dmlConfigSync. company_types/customer_titles contengono l'intero array
--    "data" della risposta DML (o [] se il servizio non ha restituito dati,
--    es. HTTP 404 "No ... found" — stesso comportamento normalizzato già
--    applicato lato dms/dmsService.js).
-- ============================================================================
DROP TABLE IF EXISTS woc.dml_configurations;

CREATE TABLE woc.dml_configurations
(
    country         VARCHAR(5)  NOT NULL,
    language        VARCHAR(10) NOT NULL,
    company_types   JSONB       NOT NULL DEFAULT '[]'::jsonb,
    customer_titles JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_dml_configurations PRIMARY KEY (country, language)
);

COMMENT ON TABLE woc.dml_configurations IS 'Cache giornaliera delle risposte DML company-types/customer-titles per mercato (popolata da dmlConfigSync, letta da session)';
COMMENT ON COLUMN woc.dml_configurations.country         IS 'Codice paese ISO2 minuscolo (es. fr)';
COMMENT ON COLUMN woc.dml_configurations.language        IS 'Codice lingua minuscolo (es. fr)';
COMMENT ON COLUMN woc.dml_configurations.company_types   IS 'Array "data" della risposta dms/getCompanyTypes ([] se assente/non trovato)';
COMMENT ON COLUMN woc.dml_configurations.customer_titles IS 'Array "data" della risposta dms/getCustomerTitles ([] se assente/non trovato)';
COMMENT ON COLUMN woc.dml_configurations.updated_at      IS 'Timestamp dell''ultima sync riuscita per questo mercato';

-- ============================================================================
-- Trigger: aggiornamento automatico updated_at su dml_enabled_markets
-- (dml_configurations imposta updated_at esplicitamente ad ogni UPSERT lato
-- applicativo, per riflettere l'orario reale della sync anche in caso di
-- retry, quindi non necessita del trigger).
-- ============================================================================

CREATE OR REPLACE FUNCTION woc.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_dml_enabled_markets_updated_at
    BEFORE UPDATE ON woc.dml_enabled_markets
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

-- ============================================================================
-- Grants — utente applicativo least-privilege "wiadvisor_app"
--   - dmlConfigSync: legge i mercati abilitati, scrive/aggiorna la cache
--   - session: legge solo la cache (SELECT)
-- ============================================================================

GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT ON TABLE woc.dml_enabled_markets TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE woc.dml_configurations TO wiadvisor_app;

COMMIT;
