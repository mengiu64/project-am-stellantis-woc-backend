-- ============================================================================
-- create_table_dms_settings.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Tabelle:
--   1) dms_settings_enabled_dealers — combinazioni country+brand+dealer
--                                     abilitate alla sync giornaliera di
--                                     dms/settings (job "dmlConfigSync").
--                                     Una riga viene registrata automaticamente
--                                     da "session" al primo cache-miss per una
--                                     combinazione mai vista (vedi
--                                     woc.dms_settings_enabled_dealers.active),
--                                     cosi' il giorno successivo il job la
--                                     sincronizza senza bisogno di popolarla
--                                     manualmente in anticipo.
--   2) dms_settings — cache dell'ultima risposta dms/settings per ciascuna
--                     combinazione country+brand+dealer, popolata dal job
--                     "dmlConfigSync" (sync 1 volta al giorno) e letta da
--                     "session" al posto della chiamata live a dms/settings
--                     (stesso principio gia' applicato a dml_configurations
--                     per company-types/customer-titles).
--
-- NOTA: a differenza di create_table_dml_configurations.sql (che usa
-- DROP TABLE IF EXISTS + CREATE TABLE), questo script usa
-- CREATE TABLE IF NOT EXISTS (idempotente): puo' essere rieseguito piu' volte
-- senza perdere dati, utile perche' viene eseguito sia su dev che su stage.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

-- ============================================================================
-- 1) DMS_SETTINGS_ENABLED_DEALERS
--    PK: (country, brand, dealer)
--    Registro delle combinazioni da sincronizzare giornalmente. Popolato:
--      - automaticamente da "session" al primo cache-miss (INSERT ... ON
--        CONFLICT DO NOTHING, vedi DmsSettingsRepository.registerDealer);
--      - opzionalmente a mano, per pre-caricare dealer noti in anticipo.
-- ============================================================================
CREATE TABLE IF NOT EXISTS woc.dms_settings_enabled_dealers
(
    country     VARCHAR(5)  NOT NULL,
    brand       VARCHAR(10) NOT NULL,
    dealer      VARCHAR(20) NOT NULL,
    active      BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_dms_settings_enabled_dealers PRIMARY KEY (country, brand, dealer)
);

COMMENT ON TABLE woc.dms_settings_enabled_dealers IS 'Combinazioni country+brand+dealer abilitate alla sync giornaliera di dms/settings (job dmlConfigSync)';
COMMENT ON COLUMN woc.dms_settings_enabled_dealers.country IS 'Codice paese ISO2 minuscolo (es. it) — parametro "country" dell''API dms/settings';
COMMENT ON COLUMN woc.dms_settings_enabled_dealers.brand   IS 'Codice brand RefTech (es. FT) — parametro "brand" dell''API dms/settings';
COMMENT ON COLUMN woc.dms_settings_enabled_dealers.dealer  IS 'Codice sincom del dealer (es. 0073741) — parametro "dealer" dell''API dms/settings';
COMMENT ON COLUMN woc.dms_settings_enabled_dealers.active  IS 'TRUE se la combinazione deve essere sincronizzata dal job giornaliero (dmlConfigSync)';

-- ============================================================================
-- 2) DMS_SETTINGS
--    PK: (country, brand, dealer)
--    Una riga per combinazione, aggiornata (UPSERT) ad ogni esecuzione del
--    job dmlConfigSync. "success"/"data" rispecchiano esattamente la risposta
--    di dms/getDmsSettings ({"success": ..., "data": [...]})  — stesso
--    principio di dml_configurations.company_types/customer_titles (colonne
--    separate anziche' un unico blob), cosi' session legge "data" (l'array
--    di {key, value, format}) e lo mappa esattamente come faceva quando
--    chiamava live il servizio (isdml/dmlcustomerupdate/dmldiscount).
-- ============================================================================
CREATE TABLE IF NOT EXISTS woc.dms_settings
(
    country     VARCHAR(5)  NOT NULL,
    brand       VARCHAR(10) NOT NULL,
    dealer      VARCHAR(20) NOT NULL,
    success     BOOLEAN     NOT NULL DEFAULT FALSE,
    data        JSONB       NOT NULL DEFAULT '[]'::jsonb,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_dms_settings PRIMARY KEY (country, brand, dealer)
);

COMMENT ON TABLE woc.dms_settings IS 'Cache giornaliera della risposta dms/settings per combinazione country+brand+dealer (popolata da dmlConfigSync, letta da session/FE)';
COMMENT ON COLUMN woc.dms_settings.country    IS 'Codice paese ISO2 minuscolo (es. it)';
COMMENT ON COLUMN woc.dms_settings.brand      IS 'Codice brand RefTech (es. FT)';
COMMENT ON COLUMN woc.dms_settings.dealer     IS 'Codice sincom del dealer (es. 0073741)';
COMMENT ON COLUMN woc.dms_settings.success    IS 'Flag "success" della risposta dms/getDmsSettings (FALSE se il servizio non ha restituito dati, es. HTTP 404)';
COMMENT ON COLUMN woc.dms_settings.data       IS 'Array "data" della risposta dms/getDmsSettings ([{key, value, format, description}, ...], [] se assente/non trovato)';
COMMENT ON COLUMN woc.dms_settings.updated_at IS 'Timestamp dell''ultima sync riuscita per questa combinazione';

-- ============================================================================
-- Trigger: aggiornamento automatico updated_at su dms_settings_enabled_dealers
-- (dms_settings imposta updated_at esplicitamente ad ogni UPSERT lato
-- applicativo, per riflettere l'orario reale della sync anche in caso di
-- retry, quindi non necessita del trigger). Riusa la funzione
-- woc.set_updated_at() gia' creata da create_table_dml_configurations.sql;
-- CREATE OR REPLACE la ridefinisce qui in modo idempotente nel caso questo
-- script venga eseguito da solo, su un DB dove l'altro script non sia
-- ancora stato eseguito.
-- ============================================================================

CREATE OR REPLACE FUNCTION woc.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dms_settings_enabled_dealers_updated_at ON woc.dms_settings_enabled_dealers;
CREATE TRIGGER trg_dms_settings_enabled_dealers_updated_at
    BEFORE UPDATE ON woc.dms_settings_enabled_dealers
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

-- ============================================================================
-- Grants — utente applicativo least-privilege "wiadvisor_app"
--   - dmlConfigSync: legge le combinazioni abilitate, scrive/aggiorna la cache
--   - session: legge la cache (SELECT) e registra nuove combinazioni al primo
--     cache-miss (INSERT ... ON CONFLICT DO NOTHING su dms_settings_enabled_dealers)
-- ============================================================================

GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE woc.dms_settings_enabled_dealers TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE woc.dms_settings TO wiadvisor_app;

COMMIT;
