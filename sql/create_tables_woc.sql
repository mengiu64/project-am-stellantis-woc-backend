-- ============================================================================
-- create_tables_woc.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Tabelle:
--   1) anag_brand        — anagrafica brand (PK: ar_codbrand)
--   2) anag_brand_genome — mapping Genome Code (PK: genome_code, FK: reftech_code → anag_brand)
-- ============================================================================

BEGIN;

-- ── Schema dedicato ─────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS woc;

-- ============================================================================
-- 1) ANAG_BRAND
--    PK: ar_codbrand
-- ============================================================================
DROP TABLE IF EXISTS woc.anag_brand_genome CASCADE;
DROP TABLE IF EXISTS woc.anag_brand CASCADE;

CREATE TABLE woc.anag_brand
(
    ar_codbrand   VARCHAR(2)   NOT NULL,
    codbrand      VARCHAR(2)   NOT NULL,
    brandname     VARCHAR(50)  NOT NULL,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_anag_brand PRIMARY KEY (ar_codbrand)
);

CREATE INDEX idx_anag_brand_codbrand ON woc.anag_brand (codbrand);

COMMENT ON TABLE woc.anag_brand IS 'Anagrafica brand con codice ARCAD e codice numerico';
COMMENT ON COLUMN woc.anag_brand.ar_codbrand IS 'Codice brand ARCAD (PK) — es. AR, FT, LA';
COMMENT ON COLUMN woc.anag_brand.codbrand IS 'Codice brand numerico/LINK — es. 83, 00, 70';
COMMENT ON COLUMN woc.anag_brand.brandname IS 'Nome completo del brand';

INSERT INTO woc.anag_brand (ar_codbrand, codbrand, brandname) VALUES
    ('AR', '83', 'Alfa Romeo'),
    ('FT', '00', 'FIAT'),
    ('LA', '70', 'LANCIA'),
    ('JE', '57', 'JEEP'),
    ('CY', '55', 'CHRYSLER'),
    ('FO', '77', 'FIAT PROFESSIONAL'),
    ('AH', '66', 'ABARTH'),
    ('DG', '56', 'DODGE'),
    ('RM', '58', 'RAM'),
    ('AC', '30', 'CITROEN'),
    ('AP', '31', 'PEUGEOT'),
    ('DS', '33', 'DS'),
    ('OV', '43', 'OPEL'),
    ('CT', '97', 'CHEVROLET');


-- ============================================================================
-- 2) ANAG_BRAND_GENOME
--    PK: genome_code
--    FK: reftech_code → anag_brand(ar_codbrand)
-- ============================================================================

CREATE TABLE woc.anag_brand_genome
(
    genome_code    VARCHAR(2)   NOT NULL,
    reftech_code   VARCHAR(2)   NOT NULL,
    description    VARCHAR(50)  NOT NULL,
    created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT pk_anag_brand_genome PRIMARY KEY (genome_code),
    CONSTRAINT fk_genome_reftech
        FOREIGN KEY (reftech_code)
        REFERENCES woc.anag_brand (ar_codbrand)
        ON UPDATE CASCADE
        ON DELETE RESTRICT
);

CREATE INDEX idx_anag_brand_genome_reftech ON woc.anag_brand_genome (reftech_code);

COMMENT ON TABLE woc.anag_brand_genome IS 'Mapping Genome Code → RefTech Code (brand ARCAD)';
COMMENT ON COLUMN woc.anag_brand_genome.genome_code IS 'Codice Genome univoco (PK) — es. 0A, 0C, 0I';
COMMENT ON COLUMN woc.anag_brand_genome.reftech_code IS 'Codice RefTech (FK → anag_brand.ar_codbrand)';
COMMENT ON COLUMN woc.anag_brand_genome.description IS 'Descrizione brand nel contesto Genome';

INSERT INTO woc.anag_brand_genome (genome_code, reftech_code, description) VALUES
    ('00', 'FT', 'Other brands'),
    ('0A', 'AR', 'Alfa Romeo'),
    ('0C', 'AC', 'Citroen'),
    ('0E', 'LA', 'Lancia'),
    ('0G', 'OV', 'OPEL'),
    ('0I', 'FT', 'FIAT'),
    ('0J', 'JE', 'Jeep'),
    ('0L', 'CY', 'Chrysler'),
    ('0O', 'RM', 'RAM'),
    ('0P', 'AP', 'Peugeot'),
    ('0S', 'DS', 'DS'),
    ('0X', 'OV', 'Maserati'),
    ('0W', 'DG', 'Dodge'),
    ('5K', 'OV', 'Vauxhall');


-- ============================================================================
-- 3) USER_LFP_FAVORITE
--    PK: user_lfp_favorite_id
--    UK: (service_advisor_id, vin, lfp_code)
-- ============================================================================

CREATE TABLE woc.user_lfp_favorite
(
    user_lfp_favorite_id  UUID           NOT NULL DEFAULT gen_random_uuid(),
    service_advisor_id    VARCHAR(50)    NOT NULL,
    vin                   VARCHAR(17)    NOT NULL,
    lfp_code              VARCHAR(100)   NOT NULL,
    is_favourite          BOOLEAN        NOT NULL DEFAULT TRUE,
    created_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT pk_user_lfp_favorite PRIMARY KEY (user_lfp_favorite_id),
    CONSTRAINT uk_user_lfp_favorite_unique 
        UNIQUE (service_advisor_id, vin, lfp_code)
);

CREATE INDEX idx_user_lfp_favorite_advisor ON woc.user_lfp_favorite (service_advisor_id);
CREATE INDEX idx_user_lfp_favorite_vin ON woc.user_lfp_favorite (vin);
CREATE INDEX idx_user_lfp_favorite_advisor_vin ON woc.user_lfp_favorite (service_advisor_id, vin);

COMMENT ON TABLE woc.user_lfp_favorite IS 'Favoriti LFP per Service Advisor — mapping favoriti per VIN e codice LFP';
COMMENT ON COLUMN woc.user_lfp_favorite.user_lfp_favorite_id IS 'Chiave primaria tecnica (UUID)';
COMMENT ON COLUMN woc.user_lfp_favorite.service_advisor_id IS 'ID dello Service Advisor loggato (es. 0073741.d235)';
COMMENT ON COLUMN woc.user_lfp_favorite.vin IS 'Vehicle Identification Number — 17 caratteri alfanumerici';
COMMENT ON COLUMN woc.user_lfp_favorite.lfp_code IS 'Codice LFP restituito da DMS (es. 801++999*801++99999)';
COMMENT ON COLUMN woc.user_lfp_favorite.is_favourite IS 'Flag booleano — TRUE se marcato come favorito';
COMMENT ON COLUMN woc.user_lfp_favorite.created_at IS 'Timestamp creazione record';
COMMENT ON COLUMN woc.user_lfp_favorite.updated_at IS 'Timestamp ultimo aggiornamento';
COMMENT ON CONSTRAINT uk_user_lfp_favorite_unique ON woc.user_lfp_favorite 
    IS 'Non possono esistere 2 record con stesso (service_advisor_id, vin, lfp_code)';


-- ============================================================================
-- Trigger: aggiornamento automatico updated_at
-- ============================================================================

CREATE OR REPLACE FUNCTION woc.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_anag_brand_updated_at
    BEFORE UPDATE ON woc.anag_brand
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

CREATE TRIGGER trg_anag_brand_genome_updated_at
    BEFORE UPDATE ON woc.anag_brand_genome
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

CREATE TRIGGER trg_user_lfp_favorite_updated_at
    BEFORE UPDATE ON woc.user_lfp_favorite
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT ON TABLE woc.anag_brand TO wiadvisor_app;
GRANT SELECT ON TABLE woc.anag_brand_genome TO wiadvisor_app;

COMMIT;
