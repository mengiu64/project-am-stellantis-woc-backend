-- ============================================================================
-- create_table_ang_snowflakes.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Tabella: ang_snowflakes
--   Import (snapshot puntuale) dell'estrazione Snowflake "M2m-queries"
--   (anagrafica siti/contratti M2M: brand, activity, status WebDAC/ARCAD,
--   date di mandato/chiusura), colonne e contenuto presi 1:1 dal file
--   "M2m-queries_2026-09-01-2019 1.csv".
--
-- NOTA: come create_table_dms_settings.sql, usa CREATE TABLE IF NOT EXISTS
-- (idempotente) cosi' puo' essere rieseguito sia su dev che su stage senza
-- errori. Il popolamento dati usa INSERT ... ON CONFLICT (gn_row_hash) DO
-- NOTHING: gn_row_hash e' l'hash di riga fornito dalla sorgente Snowflake,
-- unico per ciascuna riga dell'estrazione, quindi utilizzabile come chiave
-- naturale per evitare duplicati in caso di re-run dello script.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

CREATE TABLE IF NOT EXISTS woc.ang_snowflakes
(
    dt_ingestion_timestamp                     TIMESTAMP   NOT NULL,
    cd_unique_site_code                        VARCHAR(30) NOT NULL,
    cd_snr_site_code                           VARCHAR(30),
    cd_snr_status_code                         VARCHAR(10),
    cd_contract_brand_webdac_code              VARCHAR(5)  NOT NULL,
    cd_contract_brand_arcad_code                VARCHAR(5)  NOT NULL,
    gn_contract_brand_name                     VARCHAR(50) NOT NULL,
    cd_contract_webdac_activity_code           VARCHAR(5)  NOT NULL,
    cd_contract_arcad_activity_code            VARCHAR(5)  NOT NULL,
    gn_activity_name                           VARCHAR(50) NOT NULL,
    cd_market_iso_code                         VARCHAR(10) NOT NULL,
    cd_market_code                             VARCHAR(10) NOT NULL,
    cd_dealer_country_iso_code                 VARCHAR(5)  NOT NULL,
    gn_legal_entity                            VARCHAR(20) NOT NULL,
    gn_cddb_alias                              VARCHAR(10),
    cd_paired_oic_code                         VARCHAR(20) NOT NULL,
    cd_sincom_code                             VARCHAR(20) NOT NULL,
    cd_main_sincom_code                        VARCHAR(20) NOT NULL,
    cd_issuer_code                             VARCHAR(20),
    cd_dealer_arcad_code                        VARCHAR(30) NOT NULL,
    cd_sagai_code                              VARCHAR(20),
    cd_sagai_pr_code                           VARCHAR(20),
    cd_outlet_webdac_code                      VARCHAR(10) NOT NULL,
    gn_physical_site_arcad                     VARCHAR(30) NOT NULL,
    gn_arcad_geographical_site                 VARCHAR(30) NOT NULL,
    cd_webdac_contract_site_level_status_code  VARCHAR(5)  NOT NULL,
    gn_webdac_contract_site_level_status       VARCHAR(20) NOT NULL,
    cd_webdac_mandate_status_code              VARCHAR(5)  NOT NULL,
    gn_webdac_mandate_status                   VARCHAR(20) NOT NULL,
    cd_webdac_site_status_code                 VARCHAR(5)  NOT NULL,
    gn_webdac_site_status                      VARCHAR(20) NOT NULL,
    dt_site_appointment_date                   DATE        NOT NULL,
    dt_site_closing_date                       DATE        NOT NULL,
    gn_global_status                           VARCHAR(20) NOT NULL,
    gn_row_hash                                VARCHAR(32) NOT NULL,
    fl_is_updated_flag                         SMALLINT    NOT NULL DEFAULT 0,
    fl_is_deleted_flag                         SMALLINT    NOT NULL DEFAULT 0,
    dt_last_updated_date                       TIMESTAMP,

    created_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at                                 TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT pk_ang_snowflakes PRIMARY KEY (gn_row_hash)
);

COMMENT ON TABLE woc.ang_snowflakes IS 'Import snapshot dell''estrazione Snowflake M2m-queries (anagrafica siti/contratti M2M brand/activity/status WebDAC-ARCAD)';
COMMENT ON COLUMN woc.ang_snowflakes.dt_ingestion_timestamp                    IS 'Timestamp di ingestion della riga in Snowflake';
COMMENT ON COLUMN woc.ang_snowflakes.cd_unique_site_code                      IS 'Codice sito univoco (market-legalentity-oic)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_snr_site_code                        IS 'Codice sito SNR (non valorizzato nell''estrazione corrente)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_snr_status_code                       IS 'Codice status SNR (non valorizzato nell''estrazione corrente)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_contract_brand_webdac_code            IS 'Codice brand WebDAC del contratto (es. 55, 00, 83)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_contract_brand_arcad_code             IS 'Codice brand ARCAD/RefTech del contratto (es. CY, FT, AR)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_contract_brand_name                  IS 'Nome esteso del brand del contratto';
COMMENT ON COLUMN woc.ang_snowflakes.cd_contract_webdac_activity_code         IS 'Codice attivita'' WebDAC del contratto (es. IA)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_contract_arcad_activity_code          IS 'Codice attivita'' ARCAD del contratto (es. RA)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_activity_name                        IS 'Nome esteso dell''attivita'' (es. Aftersales)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_market_iso_code                      IS 'Codice mercato ISO (es. 1000-IT)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_market_code                          IS 'Codice mercato numerico (es. 1000)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_dealer_country_iso_code               IS 'Codice paese ISO2 del dealer (es. IT)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_legal_entity                         IS 'Codice legal entity (sincom principale)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_cddb_alias                           IS 'Alias CDDB, quando presente';
COMMENT ON COLUMN woc.ang_snowflakes.cd_paired_oic_code                      IS 'Codice OIC abbinato al sito';
COMMENT ON COLUMN woc.ang_snowflakes.cd_sincom_code                          IS 'Codice sincom del sito';
COMMENT ON COLUMN woc.ang_snowflakes.cd_main_sincom_code                     IS 'Codice sincom principale (main) del dealer';
COMMENT ON COLUMN woc.ang_snowflakes.cd_issuer_code                          IS 'Codice issuer (non valorizzato nell''estrazione corrente)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_dealer_arcad_code                     IS 'Codice dealer ARCAD, oppure "NOT FOUND in PCOD" se non risolto';
COMMENT ON COLUMN woc.ang_snowflakes.cd_sagai_code                           IS 'Codice SAGAI (non valorizzato nell''estrazione corrente)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_sagai_pr_code                        IS 'Codice SAGAI PR (non valorizzato nell''estrazione corrente)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_outlet_webdac_code                    IS 'Codice outlet WebDAC';
COMMENT ON COLUMN woc.ang_snowflakes.gn_physical_site_arcad                  IS 'Codice sito fisico ARCAD, oppure "NOT FOUND in PCOD" se non risolto';
COMMENT ON COLUMN woc.ang_snowflakes.gn_arcad_geographical_site              IS 'Codice sito geografico ARCAD, oppure "NOT FOUND in PCOD" se non risolto';
COMMENT ON COLUMN woc.ang_snowflakes.cd_webdac_contract_site_level_status_code IS 'Codice status WebDAC del contratto a livello sito (1=attivo, 8=chiuso)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_webdac_contract_site_level_status    IS 'Descrizione status WebDAC del contratto a livello sito (es. ACTIVE)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_webdac_mandate_status_code           IS 'Codice status WebDAC del mandato (1=attivo, 8=chiuso)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_webdac_mandate_status                IS 'Descrizione status WebDAC del mandato (es. ACTIVE)';
COMMENT ON COLUMN woc.ang_snowflakes.cd_webdac_site_status_code              IS 'Codice status WebDAC del sito (1=attivo, 8=chiuso)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_webdac_site_status                   IS 'Descrizione status WebDAC del sito (es. ACTIVE)';
COMMENT ON COLUMN woc.ang_snowflakes.dt_site_appointment_date                IS 'Data di nomina/apertura del sito';
COMMENT ON COLUMN woc.ang_snowflakes.dt_site_closing_date                    IS 'Data di chiusura del sito (9999-12-31 se ancora aperto)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_global_status                        IS 'Status globale calcolato della riga (es. ACTIVE)';
COMMENT ON COLUMN woc.ang_snowflakes.gn_row_hash                             IS 'Hash MD5 della riga calcolato dalla sorgente Snowflake (PK, garantisce l''unicita'' della riga)';
COMMENT ON COLUMN woc.ang_snowflakes.fl_is_updated_flag                      IS 'Flag "riga aggiornata" della sorgente Snowflake (0/1)';
COMMENT ON COLUMN woc.ang_snowflakes.fl_is_deleted_flag                      IS 'Flag "riga cancellata" della sorgente Snowflake (0/1)';
COMMENT ON COLUMN woc.ang_snowflakes.dt_last_updated_date                    IS 'Timestamp ultimo aggiornamento della riga in Snowflake, quando presente';
COMMENT ON COLUMN woc.ang_snowflakes.created_at                             IS 'Timestamp di inserimento della riga in questo database';
COMMENT ON COLUMN woc.ang_snowflakes.updated_at                             IS 'Timestamp di ultimo aggiornamento della riga in questo database';

-- ============================================================================
-- Trigger: aggiornamento automatico updated_at (riusa woc.set_updated_at()
-- gia' creata da create_table_dml_configurations.sql / create_table_dms_settings.sql;
-- CREATE OR REPLACE la ridefinisce qui in modo idempotente nel caso questo
-- script venga eseguito da solo, su un DB dove gli altri script non siano
-- ancora stati eseguiti).
-- ============================================================================

CREATE OR REPLACE FUNCTION woc.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ang_snowflakes_updated_at ON woc.ang_snowflakes;
CREATE TRIGGER trg_ang_snowflakes_updated_at
    BEFORE UPDATE ON woc.ang_snowflakes
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

-- ============================================================================
-- Grants — utente applicativo least-privilege "wiadvisor_app" (sola lettura,
-- tabella di import/snapshot popolata manualmente)
-- ============================================================================

GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT ON TABLE woc.ang_snowflakes TO wiadvisor_app;

-- ============================================================================
-- Popolamento dati — import 1:1 da "M2m-queries_2026-09-01-2019 1.csv"
-- (73 righe). ON CONFLICT (gn_row_hash) DO NOTHING per idempotenza in caso
-- di re-run dello script.
-- ============================================================================

INSERT INTO woc.ang_snowflakes (
    dt_ingestion_timestamp, cd_unique_site_code, cd_snr_site_code, cd_snr_status_code, cd_contract_brand_webdac_code, cd_contract_brand_arcad_code, gn_contract_brand_name, cd_contract_webdac_activity_code, cd_contract_arcad_activity_code, gn_activity_name, cd_market_iso_code, cd_market_code, cd_dealer_country_iso_code, gn_legal_entity, gn_cddb_alias, cd_paired_oic_code, cd_sincom_code, cd_main_sincom_code, cd_issuer_code, cd_dealer_arcad_code, cd_sagai_code, cd_sagai_pr_code, cd_outlet_webdac_code, gn_physical_site_arcad, gn_arcad_geographical_site, cd_webdac_contract_site_level_status_code, gn_webdac_contract_site_level_status, cd_webdac_mandate_status_code, gn_webdac_mandate_status, cd_webdac_site_status_code, gn_webdac_site_status, dt_site_appointment_date, dt_site_closing_date, gn_global_status, gn_row_hash, fl_is_updated_flag, fl_is_deleted_flag, dt_last_updated_date
) VALUES
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '55', 'CY', 'CHRYSLER', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '13355', '00000990', '0510105', '0710105', NULL, 'IT001RY', NULL, NULL, '000', 'IT00005498', '0000094903', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2011-06-23', '9999-12-31', 'ACTIVE', '6dd9fc99a6c6632a1485b5c315e9a187', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006821', '0073741', '0073741', NULL, 'IT01D5F', NULL, NULL, '008', 'IT00006525', '0000098764', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2013-04-04', '9999-12-31', 'ACTIVE', '7933b4faa8e6e5bf302cb2471806c46e', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00000990', '0076782', '0073741', NULL, 'IT00B6A', NULL, NULL, '004', 'IT00005498', '0000096027', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2013-07-12', '9999-12-31', 'ACTIVE', '025b7c601c0e46a556a3b203a38fee26', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000068V', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2022-01-03', '9999-12-31', 'ACTIVE', 'cc80984a01cd05cf5bb3b04e994afbd7', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00007584', '0073741', '0073741', NULL, 'IT00A0H', NULL, NULL, '012', 'IT00006527', '0000098770', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2016-06-09', '9999-12-31', 'ACTIVE', 'b3ff34ec77362cd976c6a9b818b14f18', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006656', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006656', '0028736', '0073741', NULL, 'IT00HTL', NULL, NULL, '008', 'IT00006523', '0000101458', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-12-30', '2022-06-30', 'INACTIVE', '8eeca8cd032f8d881a4ef472f4c47a2a', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '55', 'CY', 'CHRYSLER', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '20470', '00006595', '0510105', '0710105', NULL, 'IT002RY', NULL, NULL, '002', 'IT00006524', '0000101161', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2011-12-07', '2021-07-31', 'INACTIVE', '9dd881ba065bf1712eaf17a17759ce18', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00007584', '0076782', '0073741', NULL, 'IT00J4A', NULL, NULL, '009', 'IT00006527', '0000101466', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2016-06-09', '9999-12-31', 'ACTIVE', 'c203b64e7dc2f727ff39d79b31ead761', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000992', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00000992', '0028736', '0073741', NULL, 'NOT FOUND in PCOD', NULL, NULL, '002', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '1994-01-01', '2007-10-18', 'INACTIVE', '8f1e8646f6ce5145d6d36ce1501bc5fc', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '0073741', '0073741', NULL, 'IT00GSH', NULL, NULL, '020', 'IT00007223', '0000123663', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', '950693e40371bd0ff587e8adb1e142eb', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '33', 'DS', 'DS', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '000148D', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', 'd7ad6f8baced473afe2c057d9aa45318', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '0076782', '0073741', NULL, 'IT00SRA', NULL, NULL, '013', 'IT00006765', '0000121327', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-01-31', '9999-12-31', 'ACTIVE', '5525294f45a0d82ab938f056f3d0ca90', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '31', 'AP', 'PEUGEOT', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '000829P', '000046P', NULL, '126280C', NULL, NULL, '000', 'IT00007319', '0000125281', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', '624eefeaccbfa71f9f4790afa897db1a', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '13355', '00000990', '0710105', '0710105', NULL, 'IT002WJ', NULL, NULL, '000', 'IT00005498', '0000093251', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2011-06-23', '9999-12-31', 'ACTIVE', '6b1903792b00f28caf611a79cfb7740e', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '33', 'DS', 'DS', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000032D', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2022-01-03', '9999-12-31', 'ACTIVE', 'a1f2f54914c05142e2b7f820b1cf400b', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00009870', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00009870', '000866V', '000046P', NULL, 'ITZ1221', NULL, NULL, '000', 'IT00003797', '0000060033', '8', 'INACTIVE', '8', 'INACTIVE', '8', 'INACTIVE', '2019-04-17', '2020-02-03', 'INACTIVE', 'aa1b3eefda2417fe7eec210261ed3392', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006595', '0076782', '0073741', NULL, 'IT00J2A', NULL, NULL, '005', 'IT00006524', '0000101464', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-07-12', '2021-07-31', 'INACTIVE', '9833bf889916ae6fd881255a93ad0bab', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '30', 'AC', 'CITROEN', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000098C', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2021-12-31', '9999-12-31', 'ACTIVE', '5d81e8d5d414709b99d00072957cdd5b', 0, 0, '2026-08-31 15:07:57.425'),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '0073741', '0073741', NULL, 'IT01P1F', NULL, NULL, '020', 'IT00007223', '0000123662', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', '2d8fd8b763be4d80d7cd42167d9a3a61', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006595', '0073741', '0073741', NULL, 'IT01AMI', NULL, NULL, '007', 'IT00006524', '0000098763', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-03-01', '2021-07-31', 'INACTIVE', 'bf158c7b0caa181e8360782580dc28a5', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '30', 'AC', 'CITROEN', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '000832C', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', '835108caf256611dacd6d53939e5c3ae', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '21998', '00007584', '0710105', '0710105', NULL, 'IT007NJ', NULL, NULL, '009', 'IT00006527', '0000100715', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2017-02-14', '9999-12-31', 'ACTIVE', '36e2334c36c89a65794c5cf740b78948', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '56', 'DG', 'DODGE', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '13355', '00000990', '0610105', '0710105', NULL, 'IT001RG', NULL, NULL, '000', 'IT00005498', '0000094904', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2011-06-23', '9999-12-31', 'ACTIVE', '74ab65b7148dd129a62c0af6a8d36061', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '001260V', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', '07a20e37d0629a8d518b807f959f3e0c', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '30', 'AC', 'CITROEN', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '000935C', '000046P', NULL, '284498J', NULL, NULL, '000', 'IT00007319', '0000125280', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', '4026539c84549d0807eb7e2fe0f1a986', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000989', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00000989', '0028736', '0073741', NULL, 'IT008RL', NULL, NULL, '006', 'IT00006526', '0000101456', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2010-12-31', '2023-02-22', 'INACTIVE', 'efaf33b9fa5e1679f4fa91fb6af7c00f', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '001344V', '000046P', NULL, 'ITZBRC0', NULL, NULL, '000', 'IT00007319', '0000125282', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', 'c6839edeb641b076a71fc00c10cf15d0', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00009870', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00009870', '000590V', '000046P', NULL, 'ITZ1221', NULL, NULL, '000', 'IT00003797', '0000060033', '8', 'INACTIVE', '8', 'INACTIVE', '8', 'INACTIVE', '2019-04-17', '2020-02-03', 'INACTIVE', 'a1031c722baeae352ab66bb2ca87a9cb', 0, 0, '2026-08-31 15:07:57.425'),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '001260V', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', 'c4b1d6e88c047a76afc78f9ec29eb637', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '001344V', '000046P', NULL, 'ITZBRC0', NULL, NULL, '000', 'IT00007319', '0000125282', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', 'd6e2f61cc33ab288c931e1b7a7cf7e6c', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006656', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006656', '0073741', '0073741', NULL, 'IT01GOF', NULL, NULL, '006', 'IT00006523', '0000098758', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-07-01', '2022-06-30', 'INACTIVE', '5fb3d8913db486e5f6d33563fbcfd01f', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '0076782', '0073741', NULL, 'IT00RQA', NULL, NULL, '014', 'IT00007223', '0000123673', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', '94f4db19b387d7a262d062fa36c3fb00', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '30', 'AC', 'CITROEN', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000098C', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2021-12-31', '9999-12-31', 'ACTIVE', '0087824ab673a43c49a9c36ce64b2d80', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '20993', '00006821', '0710105', '0710105', NULL, 'IT007OJ', NULL, NULL, '004', 'IT00006525', '0000100717', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2014-07-17', '9999-12-31', 'ACTIVE', 'ea9a3f5bab95329bdc7c8896ab07d2d4', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '51568', '00010110', '0710105', '0710105', NULL, 'IT00I6J', NULL, NULL, '014', 'IT00006765', '0000104780', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2022-07-31', '9999-12-31', 'ACTIVE', '9d70d6f60000ad86c8c51096a63fa070', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '0073741', '0073741', NULL, 'IT01LZI', NULL, NULL, '021', 'IT00006765', '0000126183', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-10-01', '9999-12-31', 'ACTIVE', '83f806ab3876660f9791870bc88e2156', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '73211', '00000990', '0073741', '0073741', NULL, 'IT003WH', NULL, NULL, '000', 'IT00005498', '0000082632', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2002-01-18', '2025-06-30', 'INACTIVE', '48774b694933751bcec527b82f8f7b27', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006595', '0073741', '0073741', NULL, 'IT01D4F', NULL, NULL, '007', 'IT00006524', '0000098761', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-03-01', '2021-07-31', 'INACTIVE', '8673be2eecb51654ecda7002abef3d1e', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '43', 'OV', 'OPEL - VAUXHALL', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000068V', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2022-01-03', '9999-12-31', 'ACTIVE', '28d13f77b402ca51624ba0ef0bdfb136', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '31', 'AP', 'PEUGEOT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000046P', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2021-12-31', '9999-12-31', 'ACTIVE', '588879446fef8970bf7354a15f24f17b', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00009657', NULL, NULL, '97', 'CT', 'CHEVROLET', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00009657', '000372V', '000046P', NULL, 'IT52860', NULL, NULL, '000', 'IT00003604', '0000056318', '8', 'INACTIVE', '8', 'INACTIVE', '8', 'INACTIVE', '2019-01-16', '2021-03-31', 'INACTIVE', 'f0b9ceca814baaf3990b27ad51776e96', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '73211', '00000990', '0028736', '0073741', NULL, 'IT008RL', NULL, NULL, '000', 'IT00005498', '0000096026', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2002-01-16', '9999-12-31', 'ACTIVE', '9bb9aa8254e2e612a833f4835840bff1', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006656', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006656', '0073741', '0073741', NULL, 'IT009XH', NULL, NULL, '006', 'IT00006523', '0000098760', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-07-01', '2022-06-30', 'INACTIVE', '9ee5645ba148c4ccd8dd00a18437a6a1', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '0073741', '0073741', NULL, 'IT01Q9F', NULL, NULL, '021', 'IT00006765', '0000126181', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-10-01', '9999-12-31', 'ACTIVE', '19624e062d1cbc6277c8aebd1a93132a', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '0073741', '0073741', NULL, 'IT01KZI', NULL, NULL, '020', 'IT00007223', '0000123664', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', '614e972159b17f552352f460be2e7028', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006821', '0073741', '0073741', NULL, 'IT009ZH', NULL, NULL, '008', 'IT00006525', '0000098765', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2013-04-04', '9999-12-31', 'ACTIVE', '6e06fd82ad1ec17d2403437c2fa38edd', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '31', 'AP', 'PEUGEOT', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000046P', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2021-12-31', '9999-12-31', 'ACTIVE', '9c5ddd21774a78826aec8eb1661d3135', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006595', '0073741', '0073741', NULL, 'IT009YH', NULL, NULL, '007', 'IT00006524', '0000098762', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-03-01', '2021-07-31', 'INACTIVE', 'd1e93f83486883aa4bbdae934baa8b9c', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '83', 'AR', 'ALFA ROMEO', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006821', '0076782', '0073741', NULL, 'IT00LLA', NULL, NULL, '000', 'IT00006525', '0000101463', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2012-12-14', '9999-12-31', 'ACTIVE', '3028ce88cac5c629614274a5c5bf965b', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '56', 'DG', 'DODGE', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '21998', '00007584', '0610105', '0710105', NULL, 'IT0039G', NULL, NULL, '009', 'IT00006527', '0000103343', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2017-02-14', '9999-12-31', 'ACTIVE', '85fd046f31465b5342ddafa1c4b7fc93', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '31', 'AP', 'PEUGEOT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '000829P', '000046P', NULL, '126280C', NULL, NULL, '000', 'IT00007319', '0000125281', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', '277ae8b2f4cf8a168a7cd2c8cad9c580', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '73211', '00000990', '0073741', '0073741', NULL, 'IT01H4I', NULL, NULL, '000', 'IT00005498', '0000082633', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2002-01-18', '2025-06-30', 'INACTIVE', 'c60fa918400b4c378f1331bdab4712d3', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '30', 'AC', 'CITROEN', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '000098C', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '001', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2021-12-31', '2021-12-31', 'INACTIVE', '52baa0bbfa3666189ecf537ab6fe1a25', 0, 0, '2026-08-31 15:07:57.425'),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '0028736', '0073741', NULL, 'IT00RFL', NULL, NULL, '018', 'IT00007223', '0000123672', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', 'faa32c5cee9cb0773b37bd8b8e11e2af', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00007584', '0073741', '0073741', NULL, 'IT01D6F', NULL, NULL, '012', 'IT00006527', '0000098769', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2016-06-09', '9999-12-31', 'ACTIVE', '59b064ea5922084056cf93cbd6411baf', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006821', '0028736', '0073741', NULL, 'IT00HUL', NULL, NULL, '009', 'IT00006525', '0000101459', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2013-12-30', '9999-12-31', 'ACTIVE', '57e14428a74d098bc62c50c5f391c607', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '31', 'AP', 'PEUGEOT', 'LA', 'RL', 'Aftersales LCV', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '000739P', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', '020b55068435f0829f4f196c1ac23214', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006821', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006821', '0073741', '0073741', NULL, 'IT01ANI', NULL, NULL, '008', 'IT00006525', '0000098766', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2013-04-04', '9999-12-31', 'ACTIVE', 'f08ad81d0d0299f34550a8d81e088e45', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '52669', '00010925', '0710105', '0710105', NULL, 'IT00FJJ', NULL, NULL, '016', 'IT00007223', '0000123669', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-20', '9999-12-31', 'ACTIVE', '1c3c3d2e8ec59007282b27ce30c9012b', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '31', 'AP', 'PEUGEOT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '000739P', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', '69739bf4b6cd068dceafe10e4618a21d', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00011042', NULL, NULL, '30', 'AC', 'CITROEN', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00011042', '000935C', '000046P', NULL, '284498J', NULL, NULL, '000', 'IT00007319', '0000125280', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-07-25', '9999-12-31', 'ACTIVE', '845e1fd2d59a74432a4a2b5a788dbbac', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '55', 'CY', 'CHRYSLER', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '21998', '00007584', '0510105', '0710105', NULL, 'IT0038Y', NULL, NULL, '009', 'IT00006527', '0000103341', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2017-02-14', '9999-12-31', 'ACTIVE', 'f5a02d9ede06d70bdc06a53bd60c9d7d', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006656', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '20994', '00006656', '0710105', '0710105', NULL, 'IT007PJ', NULL, NULL, '005', 'IT00006523', '0000100718', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2014-07-17', '2022-06-30', 'INACTIVE', 'dcf2117a208d8ddfa45875e2e0a9aa6d', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '0028736', '0073741', NULL, 'IT00S6L', NULL, NULL, '017', 'IT00006765', '0000121326', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-01-31', '9999-12-31', 'ACTIVE', '9a5ed502745010db41001b42beddf00e', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '56', 'DG', 'DODGE', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '20470', '00006595', '0610105', '0710105', NULL, 'IT002TG', NULL, NULL, '002', 'IT00006524', '0000101164', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2011-12-07', '2021-07-31', 'INACTIVE', '56230287a36004171230ef58514c1d24', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00007584', '0028736', '0073741', NULL, 'IT00HVL', NULL, NULL, '013', 'IT00006527', '0000101460', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2016-06-09', '9999-12-31', 'ACTIVE', '71fab69bbf90709f8c15a7cd91e0d6d8', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010110', NULL, NULL, '66', 'AH', 'ABARTH', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010110', '0073741', '0073741', NULL, 'IT00HBH', NULL, NULL, '021', 'IT00006765', '0000126182', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-10-01', '9999-12-31', 'ACTIVE', 'e56f89f74fe70b7dd3176146af6eca9b', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00000990', NULL, NULL, '00', 'FT', 'FIAT', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '73211', '00000990', '0073741', '0073741', NULL, 'IT01JQF', NULL, NULL, '000', 'IT00005498', '0000082631', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2002-01-18', '2025-06-30', 'INACTIVE', '947c2cd5a3a24b5dd3c822e7bca0dff0', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00010925', NULL, NULL, '30', 'AC', 'CITROEN', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00010925', '000832C', '000046P', NULL, 'NOT FOUND in PCOD', NULL, NULL, '000', 'NOT FOUND in PCOD', 'NOT FOUND in PCOD', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2024-05-07', '9999-12-31', 'ACTIVE', '9a5c30c19d451a6e51afc29edd686a48', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00007584', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00007584', '0073741', '0073741', NULL, 'IT01AOI', NULL, NULL, '012', 'IT00006527', '0000098771', '1', 'ACTIVE', '1', 'ACTIVE', '1', 'ACTIVE', '2016-06-09', '9999-12-31', 'ACTIVE', '89a0aeb875b4788d984935ebead91bc3', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006656', NULL, NULL, '77', 'FO', 'FIAT PROFESSIONAL', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006656', '0073741', '0073741', NULL, 'IT01E3I', NULL, NULL, '006', 'IT00006523', '0000098759', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-07-01', '2022-06-30', 'INACTIVE', '32a5b100edfd0ba80f04c516cae42bb5', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '70', 'LA', 'LANCIA', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', NULL, '00006595', '0028736', '0073741', NULL, 'IT00HSL', NULL, NULL, '007', 'IT00006524', '0000101457', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2013-02-26', '2021-07-31', 'INACTIVE', '048d2b722a440cc41fd04d2f5db7dbbb', 0, 0, NULL),
    ('2026-09-01 05:08:22.005', '1000-0073741-00006595', NULL, NULL, '57', 'JE', 'JEEP', 'IA', 'RA', 'Aftersales', '1000-IT', '1000', 'IT', '0073741', '20470', '00006595', '0710105', '0710105', NULL, 'IT00BLJ', NULL, NULL, '002', 'IT00006524', '0000108232', '8', 'INACTIVE', '1', 'ACTIVE', '8', 'INACTIVE', '2011-12-07', '2021-07-31', 'INACTIVE', '9ca81efc5293d12469449054a02a24d4', 0, 0, NULL)
ON CONFLICT (gn_row_hash) DO NOTHING;

COMMIT;
