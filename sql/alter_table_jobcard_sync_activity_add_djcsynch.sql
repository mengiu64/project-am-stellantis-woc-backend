-- ============================================================================
-- alter_table_jobcard_sync_activity_add_djcsynch.sql
-- Aurora PostgreSQL 16.4+
--
-- Migrazione degli ambienti esistenti: aggiunge a woc.jobcard_sync_activity la
-- colonna djcsynch (v. create_table_jobcard_sync_activity.sql), esito
-- dell'ultima chiamata saveJobcard verso DGT scritto da jobcard/djc:
--   - true  : DGT ha risposto success: true
--   - false : DGT ha risposto altrimenti o la chiamata è fallita (token/HTTP/rete)
--   - NULL  : esito non ancora noto (righe esistenti, o UPSERT di un nuovo
--             payload non ancora inviato)
--
-- Da eseguire PRIMA del deploy delle lambda jobcard/djc che usano la colonna:
-- senza di essa l'UPSERT di saveJobcard e la lettura di lastPayload falliscono.
-- Idempotente (ADD COLUMN IF NOT EXISTS). Nessun DEFAULT né backfill: le righe
-- esistenti restano NULL. Il GRANT esistente su tabella (SELECT, INSERT,
-- UPDATE a wiadvisor_app) copre anche la nuova colonna.
-- ============================================================================

BEGIN;

ALTER TABLE woc.jobcard_sync_activity ADD COLUMN IF NOT EXISTS djcsynch BOOLEAN;

COMMENT ON COLUMN woc.jobcard_sync_activity.djcsynch IS 'Esito dell''ultima chiamata saveJobcard verso DGT: true se DGT risponde success: true, false se risponde altrimenti o la chiamata fallisce, NULL se non ancora noto (azzerato dall''UPSERT del nuovo payload) — popolato da jobcard/djc';

COMMIT;
