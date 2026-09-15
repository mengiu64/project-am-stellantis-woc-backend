-- ============================================================================
-- create_table_config_packages.sql
-- Aurora PostgreSQL — schema woc
--
-- Sostituisce la costante statica CONFIG_PACKAGES precedentemente hardcoded in
-- pkManager/PkManager.js: per ciascun web service pacchetti (eper/docsoa/
-- menupricing) elenca i codici pacchetto configurati, raggruppati per
-- department (BODY/MECHANICH/ACCESSORIES). Interrogata da
-- dbManager/ConfigPackagesRepository.js::getConfigPackages().
-- ============================================================================

DROP TABLE IF EXISTS woc.config_packages CASCADE;

CREATE TABLE woc.config_packages
(
    pkwstouse   VARCHAR(20) NOT NULL,
    department  VARCHAR(20) NOT NULL,
    pkcod       VARCHAR(20) NOT NULL
);

CREATE INDEX idx_config_packages_pkwstouse ON woc.config_packages (pkwstouse);

COMMENT ON TABLE woc.config_packages IS 'Codici pacchetto configurati per web service (pkwstouse) e department, usati per l''intersezione con i pacchetti live in PkManager.getValidPackages';
COMMENT ON COLUMN woc.config_packages.pkwstouse  IS 'Web service pacchetti: eper | docsoa | menupricing';
COMMENT ON COLUMN woc.config_packages.department IS 'Categoria pacchetto: BODY | MECHANICH | ACCESSORIES';
COMMENT ON COLUMN woc.config_packages.pkcod      IS 'Codice pacchetto configurato';

-- Dati equivalenti alla precedente costante CONFIG_PACKAGES (pkManager/PkManager.js)
INSERT INTO woc.config_packages (pkwstouse, department, pkcod) VALUES
    -- eper
    ('eper', 'BODY', '7210E221'),
    ('eper', 'BODY', '7015A041'),

    -- docsoa
    ('docsoa', 'ACCESSORIES', '95R04A'),
    ('docsoa', 'ACCESSORIES', '95R10A'),
    ('docsoa', 'ACCESSORIES', '64E91A'),
    ('docsoa', 'ACCESSORIES', '64EADA'),
    ('docsoa', 'MECHANICH', '220800985012'),
    ('docsoa', 'MECHANICH', '020320055471'),
    ('docsoa', 'MECHANICH', '42001A'),
    ('docsoa', 'MECHANICH', '42055A'),
    ('docsoa', 'MECHANICH', '44001A'),
    ('docsoa', 'MECHANICH', '95R02A01FR0101'),
    ('docsoa', 'MECHANICH', '95R02A01FR0201'),
    ('docsoa', 'MECHANICH', '95R02A01FR0XXX'),
    ('docsoa', 'MECHANICH', '98B11A'),
    ('docsoa', 'MECHANICH', '98B12A'),
    ('docsoa', 'MECHANICH', '020120055467'),
    ('docsoa', 'MECHANICH', '020120055468'),
    ('docsoa', 'MECHANICH', '020120055469'),
    ('docsoa', 'MECHANICH', '42025A'),
    ('docsoa', 'MECHANICH', '42120A'),
    ('docsoa', 'MECHANICH', '44020A'),

    -- menupricing
    ('menupricing', 'BODY', '221000135012'),
    ('menupricing', 'BODY', '054065105278'),
    ('menupricing', 'BODY', '054065305427'),
    ('menupricing', 'BODY', '054065505280'),
    ('menupricing', 'BODY', '054065705406'),
    ('menupricing', 'BODY', '054065905276'),
    ('menupricing', 'BODY', '054066105400');

GRANT SELECT ON TABLE woc.config_packages TO wiadvisor_app;
