-- ============================================================================
-- 00_create_table.sql
-- Aurora PostgreSQL 16.4+
--
-- Tabella di lookup CODNATION + ZIPCODE -> CODCITY + DESCR_CITY, popolata da
-- docs/cap/V_CITIES_2026092210122.md (vista legacy V_CITIES, ~468.275 righe).
-- Verrà usata da una futura lambda che, dati CODNATION e ZIPCODE in input,
-- risolve CODCITY e DESCR_CITY corrispondenti.
--
-- Ordine di esecuzione (da DBeaver, uno script alla volta):
--   1) 00_create_table.sql          (questo file)
--   2) part_001_insert.sql .. part_024_insert.sql   (in ordine, uno script per volta)
--   3) 99_finalize.sql
--
-- Tecniche di import massivo adottate per velocizzare il caricamento di
-- ~468k righe:
--   - Tabella creata UNLOGGED: nessuna scrittura WAL durante il caricamento
--     (99_finalize.sql la riporta a LOGGED per la durabilità a regime).
--   - autovacuum_enabled = false sulla tabella durante il caricamento
--     (riattivato in 99_finalize.sql).
--   - Nessun indice secondario/UNIQUE creato ora: solo la PK (necessaria per
--     l'identità UUID); gli indici di lookup vengono creati DOPO il
--     caricamento (99_finalize.sql), evitando il costo di manutenzione
--     indice per ogni singola riga inserita.
--   - Ogni part_XXX_insert.sql inserisce con INSERT multi-row (1000 righe per
--     statement) dentro un'unica transazione con synchronous_commit=off,
--     riducendo drasticamente round-trip e fsync rispetto a INSERT singoli.
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS woc;

DROP TABLE IF EXISTS woc.cities_zipcode CASCADE;

CREATE UNLOGGED TABLE woc.cities_zipcode
(
    id                UUID          NOT NULL DEFAULT gen_random_uuid(),
    codnation         VARCHAR(10)   NOT NULL,
    descr_nation      VARCHAR(150)  NOT NULL,
    codregion         VARCHAR(10)   NOT NULL,
    descr_region      VARCHAR(150)  NOT NULL,
    coddepartment     VARCHAR(10)   NOT NULL,
    descr_department  VARCHAR(150),
    codcity           VARCHAR(20)   NOT NULL,
    descr_city        VARCHAR(150),
    zipcode           VARCHAR(10),

    CONSTRAINT pk_cities_zipcode PRIMARY KEY (id)
)
WITH (autovacuum_enabled = false);

COMMENT ON TABLE woc.cities_zipcode IS
    'Anagrafica città/CAP importata dalla vista legacy V_CITIES: risolve CODNATION+ZIPCODE in CODCITY/DESCR_CITY per la lambda di lookup città';

COMMENT ON COLUMN woc.cities_zipcode.id IS
    'PK sintetica UUID generata alla insert (non presente nella vista sorgente V_CITIES)';
COMMENT ON COLUMN woc.cities_zipcode.codnation IS
    'Codice nazione sorgente (es. 32=BELGIUM, 34=SPAIN, 44=UNITED KINGDOM)';
COMMENT ON COLUMN woc.cities_zipcode.descr_nation IS
    'Descrizione nazione';
COMMENT ON COLUMN woc.cities_zipcode.codregion IS
    'Codice regione/area geografica di primo livello sotto la nazione';
COMMENT ON COLUMN woc.cities_zipcode.descr_region IS
    'Descrizione regione/area geografica';
COMMENT ON COLUMN woc.cities_zipcode.coddepartment IS
    'Codice dipartimento/provincia; alfanumerico, può contenere lettere (es. "84E")';
COMMENT ON COLUMN woc.cities_zipcode.descr_department IS
    'Descrizione dipartimento/provincia; NULL per 7 righe sorgente prive di descrizione';
COMMENT ON COLUMN woc.cities_zipcode.codcity IS
    'Codice città sorgente; alfanumerico (es. "1676A", "BBW")';
COMMENT ON COLUMN woc.cities_zipcode.descr_city IS
    'Descrizione/nome città; NULL per 301 righe sorgente prive di descrizione';
COMMENT ON COLUMN woc.cities_zipcode.zipcode IS
    'CAP/ZIP code; VARCHAR per preservare zeri iniziali e formati non numerici, NULL se assente nella sorgente';

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.cities_zipcode TO wiadvisor_app;

COMMIT;