# service-Hq-Manager

Lambda REST (API Gateway proxy) per la gestione dei settings HQ (WOC-201) su Aurora PostgreSQL 16.4 (DB `wiadvisor`, via RDS Proxy, utenza `wiadvisor_app`). Tabelle: `sql/create_tables_hq_settings.sql`.

| Risorsa | Path (sotto `/api`) | Chiave |
|---|---|---|
| `woc.customer_options` | `/customer-options[/{oic_code}]` | `oic_code` |
| `woc.hq_settings_email` | `/hq-settings-email[/{market}/{dealership_code}/{oic_code}]` | `market` + `dealership_code` + `oic_code` |

La chiave può essere passata anche in query string o nel body. Verbi: `GET` (lista paginata `limit` 1-500 / `offset`, o singolo), `POST` (201), `PUT` (aggiornamento parziale), `DELETE`.
Body `customer_options`: `customer_waiting_on_site`, `cleaning_approval_internal`, `cleaning_approval_external` (boolean).
Body `hq_settings_email`: `signature_email`, `dpo_email` (email o `null`).

Errori (mai 401/403, riservati all'auth di piattaforma): 400 input non valido, 404 non trovato, 405 metodo, 409 duplicato (anche UK `dealership_code`+`market`), 422 validazione campi, 500 errore interno.
Nessuna validazione token: l'identità arriva dal Lambda Authorizer (`requestContext.authorizer.sub`, usato solo nei log).

Il ruolo IAM è generato da SAM con policy inline (stesse di `isStellantisBrand`). La rotta API Gateway è creata dall'infra dopo il deploy.

Test: `npm ci && npm run test:coverage`.
