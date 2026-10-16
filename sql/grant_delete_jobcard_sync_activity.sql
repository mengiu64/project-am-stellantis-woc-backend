-- ============================================================================
-- grant_delete_jobcard_sync_activity.sql
-- Aurora PostgreSQL 16.4+
--
-- Migrazione degli ambienti esistenti: concede DELETE su
-- woc.jobcard_sync_activity all'utente applicativo wiadvisor_app (v.
-- create_table_jobcard_sync_activity.sql), necessario alla lambda jobcard per
-- eliminare la riga della jobcard: azione POST deleteSynch (solo se djcsynch è
-- false e ack/techreason/businessreason sono vuoti, NULL o stringa vuota) e
-- azione details (riga con djcsynch true e ack KO). L'azione GET lastPayload è
-- in sola lettura e non elimina la riga.
--
-- Da eseguire, come owner della tabella (wiadvisor_admin), PRIMA del deploy
-- della lambda jobcard: senza il privilegio deleteSynch risponde 502
-- ("permission denied for table jobcard_sync_activity") e details non elimina
-- la riga KO (errore best-effort: campi dell'esito null).
-- Idempotente: concedere di nuovo un privilegio già concesso non ha effetto.
-- Su dev è già stato eseguito (wiadvisor_app ereditava comunque DELETE dal
-- ruolo app_rw; lo script rende il privilegio esplicito).
-- ============================================================================

BEGIN;

GRANT DELETE ON TABLE woc.jobcard_sync_activity TO wiadvisor_app;

COMMIT;
