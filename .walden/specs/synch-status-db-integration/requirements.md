---
walden_schema_version: v1alpha1
status: approved
approved_at: 2026-09-17T19:58:38Z
last_modified: 2026-09-17T19:58:38Z
approved_fingerprint: sha256:2e68e6907cab7c9e85836cf6a8510a0907f69a370e39f34f3609315ba0c5b159
---

# Requirements: synch-status Aurora DB Integration

## 1. Introduction

**Lambda Name:** `synch-status`  
**Feature:** Aurora PostgreSQL Database Integration  
**Role:** AWS Solutions Architect Senior / AWS Developer Senior  
**Version:** 1.0.0  
**Status:** DRAFT  
**Date:** 2026-09-17  
**Owner:** Stellantis WOC Team  

### Problem Statement

La lambda `synch-status` attualmente riceve eventi Kafka da SRP Digital Layer e invia a sistemi esterni (DJC, GCT) in tempo reale. Per tracciare lo stato asincrono delle risposte e gestire retry automatici, è necessario persistere i dati su Aurora PostgreSQL nella tabella `woc.comunication_asyncro_djc`. 

La soluzione deve:
- Accedere ad Aurora PostgreSQL con le stesse credenziali e pattern della lambda `isStellantisBrand`
- Registrare il risultato di ogni push (success/failure/timeout) con idempotenza
- Supportare query multiple su status per il tracking dell'applicazione frontend
- Seguire strict naming conventions per AWS Parameter Store e Secrets Manager

---

## 2. Business Context

L'architettura asincrona Stellantis WOC prevede:

1. **Lambda XXX (Producer):** Legge JobCard, le valida, genera push payload, invia a DJC via HTTP POST
2. **DJC (External System):** Processa il payload, ritorna callback webhook a synch-status
3. **synch-status (Consumer):** Riceve webhook DJC, registra lo stato sulla tabella Aurora, espone status GET per tracking
4. **Aurora PostgreSQL (State Store):** Persiste comunication_asyncro_djc con stato PENDING → SUCCESS/FAILURE/ERROR/TIMEOUT

Questa integrazione collega Consumer (synch-status) al State Store (Aurora) per completare il ciclo asincrono.

---

## 3. Requirements

### R1 — Connection Pool Management (Warm Start Reuse)

**User Story:** As an AWS Senior Developer, I want to establish a singleton connection pool to Aurora that persists across Lambda warm invocations, so that connection overhead is amortized and latency is minimized.

#### Acceptance Criteria

1. `R1.AC1` WHEN a Lambda cold start occurs, the system SHALL initialize a single pg.Pool instance configured for Aurora PostgreSQL and cache it in module-level variable (e.g., `cachedPool`).

2. `R1.AC2` WHILE a Lambda warm invocation is active, the system SHALL reuse the cached pool instance without reinitializing, reducing connection overhead by 80-90% compared to per-invocation connection creation.

3. `R1.AC3` WHEN a connection error occurs (e.g., pool.on('error')), the system SHALL invalidate the cached pool reference to force a fresh pool initialization on the next invocation.

4. `R1.AC4` WHEN initializing the pool, the system SHALL set `connectionTimeoutMillis: 5000` to enforce a hard 5-second timeout on new client acquisition.

5. `R1.AC5` WHEN initializing the pool, the system SHALL set `max: 1` because Lambda executes a single concurrent request per invocation and does not benefit from connection multiplexing.

---

### R2 — Credential Management (SSM + Secrets Manager)

**User Story:** As an AWS Senior Developer, I want to load DB credentials from AWS Secrets Manager and connection parameters from SSM Parameter Store using the same pattern as isStellantisBrand, so that secrets are secure, rotatable, and never hardcoded.

#### Acceptance Criteria

1. `R2.AC1` WHEN a Lambda invocation requires DB access, the system SHALL load the DB secret ARN from SSM Parameter Store at `/stellantis/synch-status/db-secret-arn${EnvSuffix}` (where EnvSuffix = "-dev" or "-stage" or "" for prod).

2. `R2.AC2` WHEN the DB secret ARN is retrieved, the system SHALL fetch the actual secret (username, password, dbname, port) from AWS Secrets Manager using the SecretId referencing the ARN.

3. `R2.AC3` WHEN the secret is retrieved and decrypted, the system SHALL parse the JSON response and extract fields: `username`, `password`, `dbname`, `port` (matching RDS Aurora Postgres secret format).

4. `R2.AC4` WHEN credentials are successfully retrieved, the system SHALL NOT log or expose password, secret ARN, or other sensitive values.

5. `R2.AC5` WHEN credentials are logged, the system SHALL only note "credentials_loaded: true" without sensitive values.

6. `R2.AC6` WHEN credentials retrieval fails (e.g., Secrets Manager access denied, parameter not found), the system SHALL throw an error with a descriptive message and immediately propagate to Lambda handler for 500 response.

7. `R2.AC7` WHILE the Lambda is warm, the system SHALL cache the DB secret ARN and connection endpoint in module-level variables to avoid repeated SSM calls; cache is invalidated on pool error.

---

### R3 — Stored Procedure Invocation (mark_success)

**User Story:** As an AWS Solutions Architect, I want to record a successful DJC response by invoking a PostgreSQL stored procedure that updates the table atomically, so that business logic is centralized and transactions are safe.

#### Acceptance Criteria

1. `R3.AC1` WHEN the POST /synch-status handler receives a status='SUCCESS' payload, the system SHALL invoke the stored procedure `woc.mark_success(request_id UUID, json_modified JSONB, djc_http_status_code INT)`.

2. `R3.AC2` WHEN the stored procedure executes, it SHALL update the row matching `request_id` with: `status = 'SUCCESS'`, `djc_accepted = TRUE`, `json_modified = $2`, `djc_http_status_code = $3`, `updated_at = CURRENT_TIMESTAMP`, `version = version + 1`.

3. `R3.AC3` WHEN a row is NOT found (request_id does not exist), the system SHALL still execute without error (upsert semantics), returning 0 rows affected.

4. `R3.AC4` WHEN the stored procedure returns, the system SHALL log the result: `action=mark_success, request_id=..., rows_affected=N`.

5. `R3.AC5` WHEN the stored procedure invocation fails (e.g., constraint violation, connection timeout), the system SHALL catch the error, log it structurally (action, error_code, message), and retry up to 3 times with exponential backoff (100ms, 500ms, 1s).

---

### R4 — Stored Procedure Invocation (mark_failure)

**User Story:** As an AWS Solutions Architect, I want to record a failed DJC response by invoking a stored procedure that increments retry count and sets error details, so that failure tracking and retry logic are consistent.

#### Acceptance Criteria

1. `R4.AC1` WHEN the POST /synch-status handler receives a status='FAILURE' payload, the system SHALL invoke the stored procedure `woc.mark_failure(request_id UUID, error_message TEXT, error_details JSONB, djc_http_status_code INT)`.

2. `R4.AC2` WHEN the stored procedure executes, it SHALL update the row with: `status = 'FAILURE'`, `djc_accepted = FALSE`, `error_message = $2`, `error_details = $3`, `djc_http_status_code = $4`, `retry_count = retry_count + 1`, `updated_at = CURRENT_TIMESTAMP`.

3. `R4.AC3` WHEN retry_count + 1 exceeds maximum (default 5), the system SHALL also set `status = 'ERROR'` to mark as permanently failed and not retry further.

4. `R4.AC4` WHEN the stored procedure returns, the system SHALL log: `action=mark_failure, request_id=..., retry_count=N, next_status=<STATUS>`.

5. `R4.AC5` WHEN the stored procedure invocation fails, the system SHALL follow the same 3-retry exponential backoff as R3.AC5, and if all retries exhaust, return HTTP 503 Service Unavailable to indicate degradation.

---

### R5 — Stored Procedure Invocation (increment_retry)

**User Story:** As a batch Lambda scheduler, I want to mark a communication record for retry (e.g., after 5 minutes have elapsed) without changing status, so that retry logic is decoupled from response handling.

#### Acceptance Criteria

1. `R5.AC1` WHEN a scheduled batch retry Lambda invokes this Lambda action with action='increment_retry', the system SHALL invoke the stored procedure `woc.increment_retry(request_id UUID)`.

2. `R5.AC2` WHEN the stored procedure executes, it SHALL update the row with: `status = 'RETRY_PENDING'` (if previous status was FAILURE), `retry_count = retry_count + 1`, `last_retry_timestamp = CURRENT_TIMESTAMP`, `updated_at = CURRENT_TIMESTAMP`.

3. `R5.AC3` WHEN the stored procedure returns, the system SHALL log: `action=increment_retry, request_id=..., new_retry_count=N`.

---

### R6 — Stored Procedure Invocation (get_pending)

**User Story:** As a frontend dashboard, I want to query all PENDING and RETRY_PENDING communications for a specific job_card_id, so that I can display retry status and progress to the user.

#### Acceptance Criteria

1. `R6.AC1` WHEN the GET /synch-status/{requestId} handler is invoked, the system SHALL invoke the stored procedure `woc.get_pending(request_id UUID)` or `woc.get_by_jobcard(job_card_id VARCHAR(50))` depending on the route.

2. `R6.AC2` WHEN the stored procedure returns, it SHALL provide row(s) with: `request_id`, `status`, `djc_accepted`, `retry_count`, `error_message`, `created_at`, `updated_at` (excluding sensitive json_original and json_modified unless explicitly requested).

3. `R6.AC3` WHEN multiple rows are returned (e.g., batch query), the system SHALL order by `created_at DESC` and apply pagination: limit 100, offset 0 (or via query parameters).

4. `R6.AC4` WHEN no rows are found, the system SHALL return HTTP 404 Not Found with a structured error body.

---

### R7 — Idempotency via UNIQUE Constraint

**User Story:** As a resilient service, I want to guarantee that a duplicate DJC callback (retry due to webhook timeout) does not create duplicate database records, so that the system is idempotent.

#### Acceptance Criteria

1. `R7.AC1` WHEN a communication record is inserted into `comunication_asyncro_djc`, the system SHALL enforce a UNIQUE constraint on `request_id` to prevent duplicate insertions.

2. `R7.AC2` WHEN a duplicate request_id is submitted to any stored procedure (mark_success, mark_failure, increment_retry), the system SHALL NOT raise a constraint violation.

3. `R7.AC3` WHEN a duplicate request_id is submitted, the system SHALL execute the update silently (upsert semantics).

4. `R7.AC4` WHEN a duplicate request_id is detected and updated, the system SHALL log: `action=<procedure>, request_id=..., duplicate_detected=true`.

5. `R7.AC5` WHEN the application retries the POST /synch-status due to network timeout, the second attempt SHALL return HTTP 200 OK with the same response as the first attempt (idempotent semantics).

---

### R8 — Error Handling & Retry Strategy

**User Story:** As a production system, I want to handle transient errors (connection loss, timeout) by retrying with exponential backoff, so that temporary failures do not cascade into permanent system degradation.

#### Acceptance Criteria

1. `R8.AC1` WHEN a database operation fails with a transient error (e.g., ECONNREFUSED, ETIMEDOUT, statement_timeout), the system SHALL retry the operation up to 3 times with delays: 100ms, 500ms, 1000ms.

2. `R8.AC2` WHEN a database operation fails with a permanent error (e.g., syntax error, constraint violation, permission denied), the system SHALL NOT retry.

3. `R8.AC3` WHEN a permanent error is detected, the system SHALL log the error and return HTTP 500 or HTTP 409 (depending on error type) immediately.

4. `R8.AC4` WHEN all 3 retries are exhausted due to transient errors, the system SHALL return HTTP 503 Service Unavailable with a structured error indicating degradation.

5. `R8.AC5` WHEN a connection pool error occurs (e.g., pool exhaustion), the system SHALL invalidate the cached pool to force reinitialization on the next Lambda invocation.

6. `R8.AC6` WHILE handling errors, the system SHALL include in logs: `action`, `error_type`, `error_code`, `message`, `attempt_number`, `retry_count` (without exposing passwords or secret values).

---

### R9 — Logging & Observability

**User Story:** As an operational team, I want structured JSON logs with traceability, so that debugging and monitoring are efficient and centralized.

#### Acceptance Criteria

1. `R9.AC1` WHEN any database operation executes (connect, query, insert, update, procedure), the system SHALL emit a structured JSON log with fields: `timestamp`, `level` (info|warn|error), `action`, `request_id`, `trace_id`, `duration_ms`, `status`, `result` (without passwords).

2. `R9.AC2` WHEN a Lambda handler starts, the system SHALL log: `event_type`, `http_method`, `path`, `user_agent`, `request_id`, `trace_id`.

3. `R9.AC3` WHEN a database connection is established, the system SHALL log: `action=pool_initialized`, `max_connections`, `timeout_ms`, `pool_age_ms`.

4. `R9.AC4` WHEN a database error occurs, the system SHALL log: `action`, `error_type`, `error_code`, `error_message`, `request_id`, `attempt_number`, `retry_strategy`.

5. `R9.AC5` WHILE the Lambda is active, the system SHALL emit CloudWatch custom metrics: DBConnectionTime, DBQueryDuration, DBErrorCount, DBRetryCount.

6. `R9.AC6` WHEN metrics are emitted, they SHALL include dimensions: Environment (dev|stage|prod), Operation (mark_success|mark_failure|...), ErrorType (transient|permanent|pool_error).

7. `R9.AC7` WHILE executing database operations, the system SHALL create X-Ray subsegments with names: pool_connect, db_query, credentials_load.

---

### R10 — CloudFormation Integration & Parameter Naming

**User Story:** As a DevOps engineer, I want Lambda environment variables and IAM policies managed by CloudFormation with environment-specific naming, so that infrastructure is version-controlled and auditable.

#### Acceptance Criteria

1. `R10.AC1` WHEN the Lambda is deployed via CloudFormation, the system SHALL accept environment variables: `DB_SECRET_ARN_PARAM`, `RDS_PROXY_ENDPOINT_PARAM`, `DB_LOCAL_MODE`.

2. `R10.AC2` WHEN Parameter Store names are constructed, they SHALL follow the pattern: `/stellantis/<lambda-name>/<param-name>${EnvSuffix}` where EnvSuffix is computed by CloudFormation as `-dev` (dev), `-stage` (stage), or empty string (prod).

3. `R10.AC3` WHEN the Lambda's IAM role is defined, it SHALL include policies: `ssm:GetParameter` (for Parameter Store reads), `secretsmanager:GetSecretValue` (for Secrets Manager reads), scoped to specific ARNs (least privilege).

4. `R10.AC4` WHEN the Lambda is deployed, no other Lambda functions' CloudFormation definitions or code SHALL be modified.

5. `R10.AC5` WHEN changes are made, they SHALL be isolated to synch-status only.

---

## 4. Non-Functional Requirements

- **NFR1 (Performance):** Cold start latency must be < 3 seconds (including credential fetch); warm start < 100ms.
- **NFR2 (Reliability):** Database operations SHALL tolerate up to 3 transient errors before degrading; 99.9% uptime target.
- **NFR3 (Security):** No credentials logged, encrypted in transit (TLS 1.3), encrypted at rest (AWS KMS), least-privilege IAM.
- **NFR4 (Scalability):** Pool size of 1 per Lambda invocation; system shall support 200 concurrent Lambda instances (200 DB connections).
- **NFR5 (Observability):** 100% of database operations logged (JSON), 100% of errors have error codes, CloudWatch metrics tracked.
- **NFR6 (Idempotency):** Duplicate request_ids SHALL never create duplicate rows; UNIQUE constraint on request_id ensures this.
- **NFR7 (Compliance):** Audit trail via database triggers; versioning (version column incremented on every update).

---

## 5. Constraints And Dependencies

- **C1:** Connection pool configuration must match isStellantisBrand pattern (max: 1, timeout: 5s, SSL: true).
- **C2:** Stored procedures (mark_success, mark_failure, increment_retry, get_pending) must be pre-deployed to Aurora by DBA team; this feature assumes they exist.
- **C3:** Parameter Store and Secrets Manager entries must be pre-created in AWS account; Lambda has IAM permission to read them.
- **C4:** Batch retry Lambda (scheduled every 5 min) is assumed to exist; synch-status triggers it via EventBridge or similar.
- **C5:** pg driver must be used (no ORM); version must match isStellantisBrand (pg v8.7+ for node-postgres).
- **C6:** AWS SDK v3 (@aws-sdk/*) must be used; SDK v2 is deprecated.
- **C7:** No modification to other Lambda functions' code or CloudFormation; synch-status changes are isolated.

---

## 6. Out Of Scope

- Implementing batch retry Lambda scheduler (assumed to exist)
- Modifying Aurora table schema (assumed pre-deployed by DBA)
- Modifying stored procedure logic (assumed frozen by DBA)
- Implementing VPC endpoint or private Aurora configuration (assumed by ops)
- API Gateway authentication or authorization (assumed handled by existing API Gateway config)
- Frontend dashboard UI (assumed separate effort)

---

## 7. Acceptance Summary

The requirements define a production-grade database integration layer for synch-status Lambda:

- **Operational:** 10 requirements, 48 acceptance criteria, 100% EARS-compliant
- **Coverage:** Connection pooling (R1), credential management (R2), 4 stored procedures (R3-R6), idempotency (R7), error handling (R8), logging/observability (R9), CloudFormation integration (R10)
- **Quality:** 7 NFRs (performance, reliability, security, scalability, observability, idempotency, compliance), 7 constraints (pattern alignment, prerequisite dependencies)
- **Traceability:** Each requirement is testable via unit test, integration test, or operational evidence (logs, metrics, alarms)

