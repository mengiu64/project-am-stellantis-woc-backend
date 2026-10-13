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
-- Ad ogni saveJobcard la lambda djc (e jobcard, per parità CLI/invocazione
-- diretta) esegue un UPSERT su jobcardid, PRIMA dell'invio a DGT:
--   - INSERT: jobcardid, creationdate (= now()), payload (djcsynch NULL)
--   - UPDATE (jobcardid già presente): payload, con djcsynch azzerato a NULL
--     (esito del nuovo invio non ancora noto); creationdate e gli altri campi
--     restano invariati
-- DOPO l'invio a DGT la stessa lambda registra in djcsynch (best-effort)
-- l'esito della chiamata: true se DGT risponde success: true, false se
-- risponde altrimenti o se la chiamata fallisce (token/HTTP/rete).
-- ack/techreason/businessreason/lastupdate NON sono valorizzati da djc: vengono
-- popolati in un secondo momento da synch-status (esito asincrono della
-- sincronizzazione): ack = OK/KO, techreason = djc_sync_status,
-- businessreason = dmsSynchroStatus e dmsReturnMessage da jobCardDetails,
-- concatenati con " - " quando entrambi sono presenti.
-- jobcard e djc li rileggono per jobcardid insieme a djcsynch (SELECT
-- best-effort, NULL -> "" per ack/techreason/businessreason, NULL -> null per
-- djcsynch) e li restituiscono come djcsynch/ack/techReason/businessReason
-- nella risposta di saveJobcard (djcsynch = esito della chiamata appena
-- eseguita) e (solo jobcard) di jobCardDetails.
-- jobcard rilegge anche payload, insieme a djcsynch/ack/techreason/
-- businessreason (azione GET lastPayload), per recuperare le modifiche inviate
-- quando l'aggiornamento verso DJC/DGT fallisce, ed elimina la riga (azione
-- POST deleteSynch, e azione GET lastPayload dopo la lettura del payload) solo
-- se djcsynch è false e ack/techreason/businessreason sono vuoti (NULL o
-- stringa vuota).
--
-- Ambienti esistenti: la colonna djcsynch si aggiunge con
-- alter_table_jobcard_sync_activity_add_djcsynch.sql e il privilegio DELETE
-- con grant_delete_jobcard_sync_activity.sql (da eseguire PRIMA del deploy di
-- jobcard/djc che li usano).
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
    djcsynch        BOOLEAN,

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
COMMENT ON COLUMN woc.jobcard_sync_activity.djcsynch       IS 'Esito dell''ultima chiamata saveJobcard verso DGT: true se DGT risponde success: true, false se risponde altrimenti o la chiamata fallisce, NULL se non ancora noto (azzerato dall''UPSERT del nuovo payload) — popolato da jobcard/djc';

-- ============================================================================
-- GRANT privilegi all'utente applicativo
-- ============================================================================
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE woc.jobcard_sync_activity TO wiadvisor_app;

COMMIT;
