-- ============================================================================
-- create_table_jobcard_sync_activity.sql
-- Aurora PostgreSQL 16.4+
--
-- Schema: woc
-- Oggetti:
--   1) TABLE woc.jobcard_sync_activity — traccia dei payload inviati a DJC/DGT
--      dall'azione saveJobcard (POST /jobCard) della lambda djc
--
-- Owner (logico): djc Lambda (djc/JobcardSyncActivityRepository.js)
-- Ad ogni saveJobcard la lambda djc esegue un UPSERT su jobcardid, PRIMA
-- dell'invio a DGT:
--   - INSERT: jobcardid, creationdate (= now()), payload
--   - UPDATE (jobcardid già presente): solo payload (creationdate e gli altri
--     campi restano invariati)
-- ack/techreason/businessreason/lastupdate NON sono valorizzati da djc: vengono
-- popolati in un secondo momento da synch-status (esito asincrono della
-- sincronizzazione): ack = OK/KO, techreason = djc_sync_status,
-- businessreason = dmsSynchroStatus e dmsReturnMessage da jobCardDetails,
-- concatenati con " - " quando entrambi sono presenti.
-- ============================================================================

BEGIN;

CREATE SCHEMA IF NOT EXISTS woc;

CREATE TABLE IF NOT EXISTS woc.jobcard_sync_activity
(
    jobcardid       VARCHAR(50)   NOT NULL,
    creationdate    TIMESTAMPTZ   NOT NULL DEFAULT now(),
    payload         JSONB         NOT NULL,
    ack             VARCHAR(50),
    techreason      TEXT,
    businessreason  TEXT,
    lastupdate      TIMESTAMPTZ,

    CONSTRAINT pk_jobcard_sync_activity PRIMARY KEY (jobcardid)
);

CREATE INDEX IF NOT EXISTS idx_jobcard_sync_activity_creationdate ON woc.jobcard_sync_activity (creationdate);

COMMENT ON TABLE  woc.jobcard_sync_activity                IS 'Payload saveJobcard inviati a DJC/DGT dalla lambda djc (UPSERT su jobcardid) ed esito della sincronizzazione';
COMMENT ON COLUMN woc.jobcard_sync_activity.jobcardid      IS 'PK: id jobcard dal payload (roInfo.jobCardSrpId, fallback dmsRepairOrderId, poi jobCardLegacyId)';
COMMENT ON COLUMN woc.jobcard_sync_activity.creationdate   IS 'Data del primo saveJobcard per la jobcard (non aggiornata sugli UPSERT successivi)';
COMMENT ON COLUMN woc.jobcard_sync_activity.payload        IS 'Ultimo payload inviato a DGT (POST /jobCard)';
COMMENT ON COLUMN woc.jobcard_sync_activity.ack            IS 'Esito (ack) della sincronizzazione: OK (DMS_PUSH_SUCCESS_*) / KO (DMS_PUSH_REFUSAL, DMS_PUSH_FAILURE) — popolato da synch-status';
COMMENT ON COLUMN woc.jobcard_sync_activity.techreason     IS 'Motivazione tecnica dell''esito — popolata in un secondo momento';
COMMENT ON COLUMN woc.jobcard_sync_activity.businessreason IS 'Motivazione di business dell''esito — popolata in un secondo momento';
COMMENT ON COLUMN woc.jobcard_sync_activity.lastupdate     IS 'Data ultimo aggiornamento dell''esito — popolata in un secondo momento';

-- ============================================================================
-- GRANT privilegi all'utente applicativo
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON TABLE woc.jobcard_sync_activity TO wiadvisor_app;

COMMIT;
