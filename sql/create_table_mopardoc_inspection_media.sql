-- ============================================================================
-- create_table_mopardoc_inspection_media.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Oggetti:
--   1) TABLE woc.mopardoc_inspection_media — metadati di ispezione associati
--      alle foto caricate su Mopar dall'azione createJobCardAndUploadDocument
--      della lambda moparDoc (tipo pin/generale, tab, area danno, descrizione,
--      coordinate del pin sul diagramma, data di scatto)
--
-- Owner (logico): moparDoc Lambda (moparDoc/InspectionMetadataRepository.js)
--   - createJobCardAndUploadDocument: UPSERT su document_id dopo l'upload Mopar
--     riuscito (solo se almeno un metadato e' valorizzato)
--   - getDocuments / getJobCardAndDocumentList: SELECT per document_id per
--     arricchire ogni documento con InspectionMetadata
--   - deleteDocumentsByVin: DELETE per document_id dopo DeleteDocuments riuscito
-- Il binario resta su Mopar: qui si salvano solo i metadati (nessuna FK, la
-- chiave e' l'id documento Mopar restituito da getUploadDocURL).
--
-- Script da applicare manualmente (non eseguito dalla pipeline di deploy).
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

CREATE TABLE IF NOT EXISTS woc.mopardoc_inspection_media
(
    document_id     VARCHAR(50)    NOT NULL,
    jobcard_id      VARCHAR(50)    NOT NULL,
    vin             VARCHAR(17)    NOT NULL,
    kind            VARCHAR(10)    NULL,
    tab_id          VARCHAR(20)    NULL,
    damage_area     VARCHAR(20)    NULL,
    description     VARCHAR(1000)  NULL,
    pos_x           NUMERIC(6,3)   NULL,
    pos_y           NUMERIC(6,3)   NULL,
    captured_at     TIMESTAMPTZ    NULL,
    created_by      VARCHAR(50)    NULL,
    created_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ    NOT NULL DEFAULT now(),

    CONSTRAINT pk_mopardoc_inspection_media PRIMARY KEY (document_id),
    CONSTRAINT ck_mopardoc_inspection_media_kind  CHECK (kind IN ('pin', 'general')),
    CONSTRAINT ck_mopardoc_inspection_media_pos_x CHECK (pos_x >= 0 AND pos_x <= 100),
    CONSTRAINT ck_mopardoc_inspection_media_pos_y CHECK (pos_y >= 0 AND pos_y <= 100)
);

CREATE INDEX IF NOT EXISTS idx_mopardoc_inspection_media_vin ON woc.mopardoc_inspection_media (vin);

COMMENT ON TABLE  woc.mopardoc_inspection_media             IS 'Metadati di ispezione delle foto caricate su Mopar da moparDoc/createJobCardAndUploadDocument (UPSERT su document_id)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.document_id IS 'PK: id documento Mopar (DocumentId di getUploadDocURL = ID in DocumentList di getDocuments/getJobCardAndDocumentList)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.jobcard_id  IS 'Id job card Mopar creata da createJobCard';
COMMENT ON COLUMN woc.mopardoc_inspection_media.vin         IS 'VIN del veicolo';
COMMENT ON COLUMN woc.mopardoc_inspection_media.kind        IS 'Tipo foto: pin (punto sul diagramma) / general (foto generica)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.tab_id      IS 'Tab di ispezione del FE: vehicle / tyres / dashboard';
COMMENT ON COLUMN woc.mopardoc_inspection_media.damage_area IS 'Area del danno: front / left / right / top / rear / generic';
COMMENT ON COLUMN woc.mopardoc_inspection_media.description IS 'Descrizione libera (max 1000 caratteri)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.pos_x       IS 'Coordinata X del pin sul diagramma, in percentuale (0..100)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.pos_y       IS 'Coordinata Y del pin sul diagramma, in percentuale (0..100)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.captured_at IS 'Data/ora di scatto della foto (dal FE)';
COMMENT ON COLUMN woc.mopardoc_inspection_media.created_by  IS 'Utente autenticato (requestContext.authorizer.sub) che ha caricato la foto';
COMMENT ON COLUMN woc.mopardoc_inspection_media.created_at  IS 'Timestamp di inserimento della riga';
COMMENT ON COLUMN woc.mopardoc_inspection_media.updated_at  IS 'Timestamp di ultimo aggiornamento della riga';

-- ============================================================================
-- Trigger: aggiornamento automatico updated_at (riusa woc.set_updated_at()
-- gia' creata da create_tables_woc.sql / create_table_dml_configurations.sql;
-- CREATE OR REPLACE la ridefinisce qui in modo idempotente nel caso questo
-- script venga eseguito da solo).
-- ============================================================================

CREATE OR REPLACE FUNCTION woc.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mopardoc_inspection_media_updated_at ON woc.mopardoc_inspection_media;
CREATE TRIGGER trg_mopardoc_inspection_media_updated_at
    BEFORE UPDATE ON woc.mopardoc_inspection_media
    FOR EACH ROW EXECUTE FUNCTION woc.set_updated_at();

-- ============================================================================
-- GRANT privilegi all'utente applicativo
-- ============================================================================
GRANT USAGE ON SCHEMA woc TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.mopardoc_inspection_media TO wiadvisor_app;

COMMIT;
