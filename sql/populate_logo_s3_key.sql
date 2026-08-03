-- ============================================================================
-- populate_logo_s3_key.sql
-- Popolazione iniziale della colonna logo_s3_key nella tabella woc.anag_brand
-- Idempotente: esecuzioni ripetute producono lo stesso stato finale.
-- Il trigger trg_anag_brand_updated_at aggiorna automaticamente updated_at.
-- ============================================================================

BEGIN;

UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/ABARTH.png'          WHERE ar_codbrand = 'AH';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/ALFAROMEO.png'        WHERE ar_codbrand = 'AR';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/CHRYSLER.png'         WHERE ar_codbrand = 'CY';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/CITROEN.png'          WHERE ar_codbrand = 'AC';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/DODGE.png'            WHERE ar_codbrand = 'DG';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/DS.png'               WHERE ar_codbrand = 'DS';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/FIAT PROFESSIONAL.png' WHERE ar_codbrand = 'FO';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/FIAT.png'             WHERE ar_codbrand = 'FT';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/JEEP.png'             WHERE ar_codbrand = 'JE';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/LANCIA.png'           WHERE ar_codbrand = 'LA';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/OPEL.png'             WHERE ar_codbrand = 'OV';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/PEUGEOT.png'          WHERE ar_codbrand = 'AP';
UPDATE woc.anag_brand SET logo_s3_key = 'assets/images/logo/brand-stla/RAM.png'              WHERE ar_codbrand = 'RM';

COMMIT;
