-- ============================================================================
-- create_table_codnation_iso3166.sql
-- Aurora PostgreSQL 16.4+
--
-- Tabella di lookup CODNATION -> ISO 3166 alpha-2, popolata da
-- docs/cap/V_CITIES_20260922101223.md (vista legacy MATCH, 13 righe).
-- Verrà usata per risolvere il codice nazione legacy (CODNATION) nel
-- corrispondente codice ISO 3166 alpha-2.
--
-- Eseguibile da DBeaver in un'unica soluzione (dataset piccolo: 13 righe,
-- nessuna delle ottimizzazioni di import massivo usate in sql/cities_zipcode).
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

DROP TABLE IF EXISTS woc.codnation_iso3166 CASCADE;

CREATE TABLE woc.codnation_iso3166
(
    id         UUID         NOT NULL DEFAULT gen_random_uuid(),
    codnation  VARCHAR(10)  NOT NULL,
    iso3166    VARCHAR(3)   NOT NULL,

    CONSTRAINT pk_codnation_iso3166 PRIMARY KEY (id),
    CONSTRAINT uk_codnation_iso3166_codnation UNIQUE (codnation)
);

COMMENT ON TABLE  woc.codnation_iso3166 IS
    'Lookup CODNATION legacy -> codice ISO 3166 alpha-2, importata dalla vista legacy MATCH (docs/cap/V_CITIES_20260922101223.md)';
COMMENT ON COLUMN woc.codnation_iso3166.id IS
    'PK sintetica UUID generata alla insert (non presente nella vista sorgente MATCH)';
COMMENT ON COLUMN woc.codnation_iso3166.codnation IS
    'Codice nazione legacy sorgente (es. 32=BELGIUM, 34=SPAIN, 44=UNITED KINGDOM)';
COMMENT ON COLUMN woc.codnation_iso3166.iso3166 IS
    'Codice ISO 3166 alpha-2 corrispondente (colonna sorgente "IS0_3166", refuso con zero al posto della O)';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.codnation_iso3166 TO wiadvisor_app;

-- ============================================================================
-- Dati da docs/cap/V_CITIES_20260922101223.md (13 righe)
-- ============================================================================
INSERT INTO woc.codnation_iso3166 (codnation, iso3166) VALUES
    ('32',  'BE'),
    ('44',  'GB'),
    ('34',  'ES'),
    ('31',  'NL'),
    ('376', 'AD'),
    ('43',  'AT'),
    ('33',  'FR'),
    ('49',  'DE'),
    ('39',  'IT'),
    ('352', 'LU'),
    ('377', 'MC'),
    ('48',  'PL'),
    ('351', 'PT');

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.codnation_iso3166 TO wiadvisor_app;

COMMIT;
