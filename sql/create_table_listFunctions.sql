DROP TABLE IF EXISTS woc.docsoafunctions CASCADE;

CREATE TABLE woc.docsoafunctions
(
    function   VARCHAR(10)   NOT NULL,

    CONSTRAINT pk_docsoafunctions PRIMARY KEY (function)
);

CREATE INDEX idx_docsoafunctions_function ON woc.docsoafunctions (function);

COMMENT ON TABLE woc.docsoafunctions IS 'DocSoa lista di un sottinsieme di functions in alternativa a quelle ottenute dal metodo functionsService';

INSERT INTO woc.docsoafunctions (function) VALUES
                                               ('FCT0040'),
                                               ('FCT0050');

GRANT SELECT ON TABLE woc.docsoafunctions TO wiadvisor_app;