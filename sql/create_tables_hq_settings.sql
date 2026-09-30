-- ============================================================================
-- create_tables_hq_settings.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Tabelle (WOC-201 — Gestione Settings HQ):
--   1) customer_options   — opzioni Customer/OIC (PK: oic_code)
--   2) hq_settings_email  — email di firma/DPO per dealership (PK: id)
--
-- NOTA (riuso funzioni trigger):
--   Le funzioni woc.set_created_at_timestamp() e woc.update_updated_at_timestamp()
--   scrivono rispettivamente su NEW.created_at e NEW.updated_at. Per poterle
--   RIUSARE senza modificarle, le colonne di audit di queste tabelle si chiamano
--   created_at / updated_at (i campi CREATED_DATE / UPDATED_DATE del documento).
--   Le funzioni sono create in create_table_comunication_asyncro_djc.sql; qui
--   vengono definite con CREATE OR REPLACE (idempotente) per rendere lo script
--   autonomo anche se eseguito per primo.
-- ============================================================================

BEGIN;

-- ── Schema dedicato ─────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS woc;

-- ============================================================================
-- Funzioni trigger condivise (riuso) — created_at (INSERT) / updated_at (UPDATE)
-- Idempotenti: CREATE OR REPLACE non altera le definizioni gia' presenti.
-- ============================================================================

-- Funzione: imposta created_at al primo INSERT
CREATE OR REPLACE FUNCTION woc.set_created_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.created_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Funzione: aggiorna updated_at ad ogni UPDATE
CREATE OR REPLACE FUNCTION woc.update_updated_at_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- 1) CUSTOMER_OPTIONS
--    PK: oic_code
--    Opzioni (fisse) associate a uno specifico Customer/OIC.
-- ============================================================================
DROP TABLE IF EXISTS woc.customer_options CASCADE;

CREATE TABLE woc.customer_options
(
    oic_code                    VARCHAR(20)  NOT NULL,
    customer_waiting_on_site    BOOLEAN      NOT NULL DEFAULT FALSE,
    cleaning_approval_internal  BOOLEAN      NOT NULL DEFAULT FALSE,
    cleaning_approval_external  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                  TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_customer_options PRIMARY KEY (oic_code)
);

COMMENT ON TABLE  woc.customer_options IS 'Opzioni Customer/OIC gestite dagli utenti HQ (WOC-201). Opzioni fisse; varia solo il valore per OIC.';
COMMENT ON COLUMN woc.customer_options.oic_code                   IS 'Codice identificativo del Customer/OIC (PK)';
COMMENT ON COLUMN woc.customer_options.customer_waiting_on_site   IS 'Opzione "Customer Waiting On Site" attiva/visibile per il Customer';
COMMENT ON COLUMN woc.customer_options.cleaning_approval_internal IS 'Opzione "Cleaning Approval Internal" attiva/visibile per il Customer';
COMMENT ON COLUMN woc.customer_options.cleaning_approval_external IS 'Opzione "Cleaning Approval External" attiva/visibile per il Customer';
COMMENT ON COLUMN woc.customer_options.created_at                 IS 'Timestamp creazione record (CREATED_DATE)';
COMMENT ON COLUMN woc.customer_options.updated_at                 IS 'Timestamp ultimo aggiornamento (UPDATED_DATE)';

CREATE TRIGGER insert_customer_options_created_at
    BEFORE INSERT ON woc.customer_options
    FOR EACH ROW EXECUTE FUNCTION woc.set_created_at_timestamp();

CREATE TRIGGER update_customer_options_updated_at
    BEFORE UPDATE ON woc.customer_options
    FOR EACH ROW EXECUTE FUNCTION woc.update_updated_at_timestamp();

-- ============================================================================
-- 2) HQ_SETTINGS_EMAIL
--    PK: id (UUID)
--    UK: (oic_code, market, dealership_code) — una configurazione email per dealership
--    Email di firma (SIGNATURE_EMAIL) e DPO (DPO_EMAIL); possono essere vuote.
-- ============================================================================
DROP TABLE IF EXISTS woc.hq_settings_email CASCADE;

CREATE TABLE woc.hq_settings_email
(
    id               UUID         NOT NULL DEFAULT gen_random_uuid(),
    oic_code         VARCHAR(20)  NOT NULL,
    market           VARCHAR(10)  NOT NULL,
    dealership_code  VARCHAR(50)  NOT NULL,
    signature_email  VARCHAR(255) DEFAULT NULL,
    dpo_email        VARCHAR(255) DEFAULT NULL,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_hq_settings_email PRIMARY KEY (id),
    CONSTRAINT uk_hq_settings_email_oic_dealer UNIQUE (oic_code, market, dealership_code),
    CONSTRAINT uk_hq_settings_email_dealer_market UNIQUE (dealership_code, market)
);

COMMENT ON TABLE  woc.hq_settings_email IS 'Email (firma e DPO) configurate dagli utenti HQ per le dealership dello stesso OIC (WOC-201)';
COMMENT ON COLUMN woc.hq_settings_email.id               IS 'Chiave primaria tecnica auto-generata (UUID)';
COMMENT ON COLUMN woc.hq_settings_email.oic_code         IS 'Codice OIC/IC di appartenenza della dealership';
COMMENT ON COLUMN woc.hq_settings_email.market          IS 'Codice mercato di appartenenza della dealership';
COMMENT ON COLUMN woc.hq_settings_email.dealership_code  IS 'Codice della dealership';
COMMENT ON COLUMN woc.hq_settings_email.signature_email  IS 'Email di firma per le comunicazioni (puo'' essere inizialmente NULL)';
COMMENT ON COLUMN woc.hq_settings_email.dpo_email        IS 'Email del Data Protection Officer (puo'' essere inizialmente NULL)';
COMMENT ON COLUMN woc.hq_settings_email.created_at       IS 'Timestamp creazione record (CREATED_DATE)';
COMMENT ON COLUMN woc.hq_settings_email.updated_at       IS 'Timestamp ultimo aggiornamento (UPDATED_DATE)';
COMMENT ON CONSTRAINT uk_hq_settings_email_oic_dealer ON woc.hq_settings_email
    IS 'Una sola configurazione email per tripla (oic_code, market, dealership_code)';
COMMENT ON CONSTRAINT uk_hq_settings_email_dealer_market ON woc.hq_settings_email
    IS 'Coppia (dealership_code, market) univoca: non possono esistere 2 record con stessi dealership_code e market';

CREATE TRIGGER insert_hq_settings_email_created_at
    BEFORE INSERT ON woc.hq_settings_email
    FOR EACH ROW EXECUTE FUNCTION woc.set_created_at_timestamp();

CREATE TRIGGER update_hq_settings_email_updated_at
    BEFORE UPDATE ON woc.hq_settings_email
    FOR EACH ROW EXECUTE FUNCTION woc.update_updated_at_timestamp();

-- ============================================================================
-- GRANT privilegi all'utente applicativo
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.customer_options  TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.hq_settings_email TO wiadvisor_app;

COMMIT;
