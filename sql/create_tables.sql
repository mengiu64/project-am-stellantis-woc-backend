-- ============================================================================
-- Script di creazione (ed eventuale popolamento) tabelle - PostgreSQL
-- Conversione da sintassi Oracle (VARCHAR2 -> VARCHAR, NUMBER -> NUMERIC,
-- CLOB -> TEXT) con correzione di alcune imprecisioni presenti negli appunti
-- originali (tipi mancanti, virgole/caratteri errati).
--
-- IMPORTANTE: eseguire questo script connessi come utente "wiadvisor_operator"
-- (NON "wiadvisor_admin"): i default privileges dello schema public sono
-- configurati sul ruolo creatore wiadvisor_operator, che concede
-- automaticamente i grant ad app_rw/app_ro sulle nuove tabelle. Se lo script
-- viene eseguito come wiadvisor_admin le tabelle vengono comunque create ma
-- wiadvisor_app (usato a runtime dalle Lambda) non avrà alcun privilegio su
-- di esse ("permission denied for table ..."). I GRANT espliciti sotto sono
-- una rete di sicurezza per coprire comunque il caso in cui lo script venga
-- eseguito con l'utente sbagliato.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1) ANAG_BRAND
-- ============================================================================
DROP TABLE IF EXISTS ANAG_BRAND;

CREATE TABLE ANAG_BRAND
(
    GENOMECODE  VARCHAR(2),
    REFTECHCODE VARCHAR(2),
    LINKCODE    VARCHAR(2),
    DESCRIPTION VARCHAR(50)
);

COMMENT ON TABLE ANAG_BRAND IS 'Anagrafica marchi (brand) e relativi codici di riferimento';
COMMENT ON COLUMN ANAG_BRAND.GENOMECODE  IS 'Codice brand Genome';
COMMENT ON COLUMN ANAG_BRAND.REFTECHCODE IS 'Codice brand RefTech';
COMMENT ON COLUMN ANAG_BRAND.LINKCODE    IS 'Codice brand Link';
COMMENT ON COLUMN ANAG_BRAND.DESCRIPTION IS 'Descrizione del brand';

INSERT INTO ANAG_BRAND (GENOMECODE, REFTECHCODE, LINKCODE, DESCRIPTION) VALUES
    ('00', 'XX', '',   'Other brands'),
    ('0A', 'AR', '83', 'Alfa Romeo'),
    ('0C', 'AC', '30', 'Citroen'),
    ('0E', 'LA', '70', 'Lancia'),
    ('0G', 'OP', '43', 'OPEL'),
    ('0I', 'FT', '00', 'FIAT'),
    ('0J', 'JE', '57', 'Jeep'),
    ('0L', 'CY', '55', 'Chrysler'),
    ('0O', 'RM', '58', 'RAM'),
    ('0P', 'AP', '31', 'Peugeot'),
    ('0S', 'DS', '33', 'DS'),
    ('0X', 'OX', 'A5', 'Maserati'),
    ('0W', 'DG', '56', 'Dodge');


-- ============================================================================
-- 2) HQ_DEALERDEFAULTVALUES
--    (nota: nel testo originale la tabella era denominata sia
--    "HQ_HQ_DEALERDEFAULTVALUES" nella CREATE TABLE sia "HQ_DEALERDEFAULTVALUES"
--    nei COMMENT; si è unificato il nome in HQ_DEALERDEFAULTVALUES.
--    Le colonne OIC e CODMARKET erano prive di tipo: sono state tipizzate
--    come VARCHAR per coerenza con le altre tabelle anagrafiche del progetto)
-- ============================================================================
DROP TABLE IF EXISTS HQ_DEALERDEFAULTVALUES;

CREATE TABLE HQ_DEALERDEFAULTVALUES
(
    OIC                       VARCHAR(10),
    CODMARKET                 VARCHAR(10),
    InteriorCarWash           CHAR(1) DEFAULT 'N',
    ExteriorCarWash           CHAR(1) DEFAULT 'N',

    partPref_old              CHAR(1) DEFAULT 'N',
    partPref_original         CHAR(1) DEFAULT 'N',
    partPref_returned         CHAR(1) DEFAULT 'N',
    partPref_circularEconomy  CHAR(1) DEFAULT 'N',

    PcyDealer1                CHAR(1) DEFAULT 'N',
    PcyDealer2                CHAR(1) DEFAULT 'N',
    PcyDealer3                CHAR(1) DEFAULT 'N',

    PcyStellantis1            CHAR(1) DEFAULT 'N',
    PcyStellantis2            CHAR(1) DEFAULT 'N',
    PcyStellantis3            CHAR(1) DEFAULT 'N',

    maxDiscountPerc           NUMERIC(5,2),
    maxDiscountVal            NUMERIC(12,2)
);

COMMENT ON TABLE HQ_DEALERDEFAULTVALUES IS
    'Tabella in cui il dealer setta le preferenze su alcuni toggle precompilati';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.OIC IS
    'Codice OIC del dealer';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.CODMARKET IS
    'Codice mercato';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.InteriorCarWash IS
    'Lavaggio interno auto (default)';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.ExteriorCarWash IS
    'Lavaggio esterno auto (default)';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.partPref_old IS
    'See replaced parts';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.partPref_original IS
    'Know origin';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.partPref_returned IS
    'Have replaced parts returned';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.partPref_circularEconomy IS
    'Circular economy preference';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyDealer1 IS
    'REPAIRER_MARKETING';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyDealer2 IS
    'REPAIRER_PROFILING';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyDealer3 IS
    'REPAIRER_3DPARTY';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyStellantis1 IS
    'STELLANTIS_MARKETING';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyStellantis2 IS
    'STELLANTIS_PROFILING';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.PcyStellantis3 IS
    'STELLANTIS_3DPARTY';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.maxDiscountPerc IS
    'Sconto massimo applicabile in percentuale';

COMMENT ON COLUMN HQ_DEALERDEFAULTVALUES.maxDiscountVal IS
    'Sconto massimo applicabile in valore';


-- ============================================================================
-- 3) DJCREQUEST
-- ============================================================================
DROP TABLE IF EXISTS DJCREQUEST;

CREATE TABLE DJCREQUEST
(
    ID                  INTEGER      GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    jobCardLegacyId     NUMERIC(9),
    DJC_QUERY           VARCHAR(10),
    JSON_ORIG           TEXT,
    JSON_MOD            TEXT,
    TYPE                VARCHAR(10),
    ACK                 VARCHAR(5),
    REASON              VARCHAR(200)
);

COMMENT ON TABLE DJCREQUEST IS
    'Richieste DJC (Dealer Job Card) inviate/ricevute con relativo esito';

COMMENT ON COLUMN DJCREQUEST.ID IS
    'Identificativo univoco della richiesta';

COMMENT ON COLUMN DJCREQUEST.jobCardLegacyId IS
    'Identificativo della job card sul sistema legacy';

COMMENT ON COLUMN DJCREQUEST.DJC_QUERY IS
    'Codice/query DJC associata alla richiesta';

COMMENT ON COLUMN DJCREQUEST.JSON_ORIG IS
    'Payload JSON originale della richiesta';

COMMENT ON COLUMN DJCREQUEST.JSON_MOD IS
    'Payload JSON modificato/elaborato della richiesta';

COMMENT ON COLUMN DJCREQUEST.TYPE IS
    'Tipo di richiesta: 1) SaveRoInfo 2) SaveDmsSync 3) SaveCustomer 4) SaveVehicle 5) SaveJobs 6) SaveConsents 7) SaveAppointments';

COMMENT ON COLUMN DJCREQUEST.ACK IS
    'Esito/acknowledge della richiesta';

COMMENT ON COLUMN DJCREQUEST.REASON IS
    'Motivo/dettaglio dell''esito della richiesta';


-- ============================================================================
-- 4) ANAG_SNOWFLAKE
--    (nel testo originale la definizione della colonna LEGALENTITY conteneva
--    un tipo duplicato "varchar2(10),varchar2(10)", la colonna OIC era priva
--    di virgola/commento tra apici, e la colonna PHYSICALSITEXF conteneva un
--    carattere "|" nel nome: refusi corretti di seguito)
-- ============================================================================
DROP TABLE IF EXISTS ANAG_SNOWFLAKE;

CREATE TABLE ANAG_SNOWFLAKE
(
    ID                NUMERIC(9),
    SNRID             VARCHAR(10),
    CONTRACTID        VARCHAR(10),
    BRANDWEBDAC       VARCHAR(3),
    BRANDARCAD        VARCHAR(3),
    BRANDLABEL        VARCHAR(20),
    ACTIVITYWEBDAC    VARCHAR(3),
    ACTIVITYARCAD     VARCHAR(3),
    ACTIVITYLABEL     VARCHAR(20),
    MARKETISO         VARCHAR(10),
    MARKET            VARCHAR(4),
    COUNTRYISO        VARCHAR(2),
    LEGALENTITY       VARCHAR(10),
    OIC               VARCHAR(10),
    MAINSINCOM        VARCHAR(10),
    ISSUER            VARCHAR(10),
    RRDI              VARCHAR(10),
    SAGAI             VARCHAR(10),
    SAGAIPR           VARCHAR(10),
    DEALER            VARCHAR(10),
    OUTLET            VARCHAR(10),
    OUTLETWABDAC      VARCHAR(10),
    CCDB              VARCHAR(10),
    PHYSICALSITEXP    VARCHAR(10),
    PHYSICALSITEXF    VARCHAR(10),
    ACTIVITYSTATUS    VARCHAR(1),
    MANDATESTATUS     VARCHAR(10),
    STATUSARCAD       VARCHAR(10),
    STATUSWEBDAC      VARCHAR(10),
    STATUSSNR         VARCHAR(10),
    STATUSDESCR       VARCHAR(10),
    APPOINTMENTDATE   VARCHAR(10),
    CLOSINGDATE       VARCHAR(10),
    TERMINATIONDATE   VARCHAR(10),
    SNR               VARCHAR(10)
);

COMMENT ON TABLE ANAG_SNOWFLAKE IS 'Anagrafica siti/dealer sincronizzata da Snowflake';

COMMENT ON COLUMN ANAG_SNOWFLAKE.ID              IS 'unique Site code                         1000-0062211-00011055';
COMMENT ON COLUMN ANAG_SNOWFLAKE.SNRID           IS 'SNR site code';
COMMENT ON COLUMN ANAG_SNOWFLAKE.CONTRACTID      IS 'Contract ID / Dealer Contracts - SNR';
COMMENT ON COLUMN ANAG_SNOWFLAKE.BRANDWEBDAC     IS 'Contract Brand WEBDAC format             31';
COMMENT ON COLUMN ANAG_SNOWFLAKE.BRANDARCAD      IS 'Contract Brand ARCAD format              AP';
COMMENT ON COLUMN ANAG_SNOWFLAKE.BRANDLABEL      IS 'contract Brand label                     PEUGEOT';
COMMENT ON COLUMN ANAG_SNOWFLAKE.ACTIVITYWEBDAC  IS 'Contract activity WEBDAC format          IA';
COMMENT ON COLUMN ANAG_SNOWFLAKE.ACTIVITYARCAD   IS 'contract activity ARCAD format           RA';
COMMENT ON COLUMN ANAG_SNOWFLAKE.ACTIVITYLABEL   IS 'Activity label                           Aftersales';
COMMENT ON COLUMN ANAG_SNOWFLAKE.MARKETISO       IS 'Market_ISO                               1000-IT';
COMMENT ON COLUMN ANAG_SNOWFLAKE.MARKET          IS 'Market Code                              1000';
COMMENT ON COLUMN ANAG_SNOWFLAKE.COUNTRYISO      IS 'Dealer country ISO Code                  IT';
COMMENT ON COLUMN ANAG_SNOWFLAKE.LEGALENTITY     IS 'Legal Entity                             0062212';
COMMENT ON COLUMN ANAG_SNOWFLAKE.OIC             IS 'Paired OIC                               00010936';
COMMENT ON COLUMN ANAG_SNOWFLAKE.MAINSINCOM      IS 'Main SINCOM - webdac                     0020210';
COMMENT ON COLUMN ANAG_SNOWFLAKE.ISSUER          IS 'ISSUER CODE                              0020210';
COMMENT ON COLUMN ANAG_SNOWFLAKE.RRDI            IS 'RRDI / DEALER ARCAD                      113400C';
COMMENT ON COLUMN ANAG_SNOWFLAKE.SAGAI           IS 'SAGAI code / SAGAI.RES                   1134003';
COMMENT ON COLUMN ANAG_SNOWFLAKE.SAGAIPR         IS 'SAGAI PR                                 01';
COMMENT ON COLUMN ANAG_SNOWFLAKE.DEALER          IS 'Dealer / SINCOM - webdac                 113400C';
COMMENT ON COLUMN ANAG_SNOWFLAKE.OUTLET          IS 'Outlet code (SINCOM)                     (vuoto)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.OUTLETWABDAC    IS 'Outlet code webdac (codlocation)         000';
COMMENT ON COLUMN ANAG_SNOWFLAKE.CCDB            IS 'CDDB Alias                               3007';
COMMENT ON COLUMN ANAG_SNOWFLAKE.PHYSICALSITEXP  IS 'Physical site xP                         (vuoto)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.PHYSICALSITEXF  IS 'Physical site xF                         (vuoto)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.ACTIVITYSTATUS  IS 'Activity Status Webdac                   1 (active)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.MANDATESTATUS   IS 'Mandate status webdac                    (vuoto)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.STATUSARCAD     IS 'Status ARCAD                             1';
COMMENT ON COLUMN ANAG_SNOWFLAKE.STATUSWEBDAC    IS 'Status Code Webdac                       1';
COMMENT ON COLUMN ANAG_SNOWFLAKE.STATUSSNR       IS 'Status Code SNR                          (vuoto)';
COMMENT ON COLUMN ANAG_SNOWFLAKE.STATUSDESCR     IS 'Status Description                       Active';
COMMENT ON COLUMN ANAG_SNOWFLAKE.APPOINTMENTDATE IS 'Appointment Date                         20090706';
COMMENT ON COLUMN ANAG_SNOWFLAKE.CLOSINGDATE     IS 'Closing date                             20090707';
COMMENT ON COLUMN ANAG_SNOWFLAKE.TERMINATIONDATE IS 'Termination Date                         20090707';
COMMENT ON COLUMN ANAG_SNOWFLAKE.SNR             IS 'SNR Specific field                       (vuoto)';


-- ============================================================================
-- 5) HQ_PKCONFIG
-- ============================================================================
DROP TABLE IF EXISTS HQ_PKCONFIG;

CREATE TABLE HQ_PKCONFIG
(
    CODMARKET   VARCHAR(20),
    CODBRAND    VARCHAR(20) NOT NULL,
    APPLICATION VARCHAR(20) NOT NULL
);

COMMENT ON TABLE HQ_PKCONFIG IS 'Configurazione applicazione da utilizzare per mercato/brand';
COMMENT ON COLUMN HQ_PKCONFIG.CODMARKET   IS 'Codice mercato';
COMMENT ON COLUMN HQ_PKCONFIG.CODBRAND    IS 'Codice brand';
COMMENT ON COLUMN HQ_PKCONFIG.APPLICATION IS 'Nome applicazione associata';

INSERT INTO HQ_PKCONFIG (CODMARKET, CODBRAND, APPLICATION) VALUES
    ('', '30', 'DocSoa'),
    ('', '31', 'DocSoa'),
    ('', '33', 'DocSoa'),
    ('', '43', 'MenuPricing'),
    ('', '97', 'ePer'),
    ('', '83', 'ePer'),
    ('', '00', 'ePer'),
    ('', '70', 'ePer'),
    ('', '77', 'ePer'),
    ('', '66', 'ePer'),
    ('', '56', 'ePer'),
    ('', '57', 'ePer');


-- ============================================================================
-- 6) PKFAVORITE
--    Pacchetti/forfait preferiti salvati dal dealer per uno specifico veicolo
--    (lambda pkFavorite). Il POST crea il record se non esiste, altrimenti lo
--    elimina ("toggle"); la GET elenca i preferiti per username+vin.
-- ============================================================================
DROP TABLE IF EXISTS PKFAVORITE;

CREATE TABLE PKFAVORITE
(
    ID           INTEGER      GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
    USERNAME     VARCHAR(50)  NOT NULL,
    VIN          VARCHAR(17)  NOT NULL,
    PACKAGE_CODE VARCHAR(50)  NOT NULL,
    CREATED_AT   TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT UQ_PKFAVORITE_USER_VIN_PKG UNIQUE (USERNAME, VIN, PACKAGE_CODE)
);

CREATE INDEX IDX_PKFAVORITE_USER_VIN ON PKFAVORITE (USERNAME, VIN);

COMMENT ON TABLE PKFAVORITE IS
    'Pacchetti (forfait/package) preferiti salvati dal dealer per uno specifico veicolo (VIN)';

COMMENT ON COLUMN PKFAVORITE.ID IS
    'Identificativo univoco del preferito';

COMMENT ON COLUMN PKFAVORITE.USERNAME IS
    'Username del dealer, ricavato dalla sessione (event.requestContext.authorizer.sub)';

COMMENT ON COLUMN PKFAVORITE.VIN IS
    'VIN del veicolo a cui si riferisce il pacchetto preferito';

COMMENT ON COLUMN PKFAVORITE.PACKAGE_CODE IS
    'Codice del pacchetto/forfait (UpSelling.Packages[].Code) marcato come preferito';

COMMENT ON COLUMN PKFAVORITE.CREATED_AT IS
    'Data/ora di creazione del preferito';

-- ============================================================================
-- Grant espliciti verso l'utente applicativo (rete di sicurezza — vedi nota
-- in testa al file: normalmente questi privilegi sono già concessi
-- automaticamente dai default privileges di wiadvisor_operator)
-- ============================================================================
GRANT SELECT ON TABLE ANAG_BRAND TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE HQ_DEALERDEFAULTVALUES TO wiadvisor_app;
GRANT SELECT, INSERT, UPDATE ON TABLE DJCREQUEST TO wiadvisor_app;
GRANT SELECT ON TABLE ANAG_SNOWFLAKE TO wiadvisor_app;
GRANT SELECT ON TABLE HQ_PKCONFIG TO wiadvisor_app;
GRANT SELECT, INSERT, DELETE ON TABLE PKFAVORITE TO wiadvisor_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO wiadvisor_app;

COMMIT;
