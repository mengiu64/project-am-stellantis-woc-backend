---
walden_schema_version: v1alpha1
status: approved
approved_at: 2026-09-17T20:00:57Z
last_modified: 2026-09-17T20:00:57Z
approved_fingerprint: sha256:ca115e75b7d27a19ffde32b94499a8ee0ad984b2d31f3393bb89ec581a27c756
source_requirements_approved_at: 2026-09-17T19:58:38Z
source_requirements_fingerprint: sha256:2e68e6907cab7c9e85836cf6a8510a0907f69a370e39f34f3609315ba0c5b159
---

# Design: synch-status Aurora DB Integration

## Overview

**Feature:** Aurora PostgreSQL Integration for synch-status Lambda  
**Architecture Pattern:** Connection Pool Singleton + Stored Procedure Gateway  
**Database Engine:** PostgreSQL 13+ (Aurora)  
**ORM:** None (raw pg driver for control and performance)  
**State Management:** UNIQUE constraint on request_id for idempotency  

The design decouples **API handler logic** (index.js) from **database logic** (databaseService.js), following the Repository Pattern. All database mutations flow through stored procedures in the `woc` schema for atomicity and audit trails.

---

## Architecture

### High-Level Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                     API Gateway (HTTP)                           │
├─────────────────────────────────────────────────────────────────┤
│  POST /api/synch-status                                          │
│  { request_id, status, json_modified, djc_http_status_code }    │
└────────────────────────┬────────────────────────────────────────┘
                         │
                         ▼
        ┌────────────────────────────────────┐
        │   Lambda Handler (index.js)         │
        │  - Route: POST /synch-status        │
        │  - Validate payload                 │
        │  - Determine procedure to call      │
        └────────────┬─────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │   databaseService.js                │
        │  - getPool() (singleton)            │
        │  - markSuccess()                    │
        │  - markFailure()                    │
        │  - incrementRetry()                 │
        │  - getPending()                     │
        └────────────┬─────────────────────────┘
                     │
         ┌───────────┼───────────┐
         │           │           │
         ▼           ▼           ▼
    ┌────────┐  ┌────────┐  ┌────────┐
    │ SSM    │  │Secrets │  │Aurora  │
    │Param   │  │Manager │  │PostgreSQL
    │Store   │  │        │  │        │
    └────────┘  └────────┘  └────────┘
         │           │           │
         └─────┬─────┴─────┬─────┘
               │           │
               ▼           ▼
        ┌────────────────────────────────────┐
        │   pg.Pool (cached singleton)        │
        │   - max: 1 connection per invoke    │
        │   - timeout: 5s                     │
        │   - SSL: true (Aurora)              │
        └────────────┬─────────────────────────┘
                     │
                     ▼
        ┌────────────────────────────────────┐
        │   Aurora PostgreSQL                 │
        │   Table: woc.comunication_asyncro_djc
        │   Procedures:                       │
        │    - woc.mark_success()             │
        │    - woc.mark_failure()             │
        │    - woc.increment_retry()          │
        │    - woc.get_pending()              │
        └────────────────────────────────────┘
```

### Component Responsibilities

**Lambda Handler (index.js):**
- Route HTTP requests to appropriate handler
- Parse and validate payload (using existing Validator)
- Instantiate databaseService
- Call db service method based on status
- Build HTTP response
- Emit structured logs
- Handle errors and return appropriate HTTP status codes

**Database Service (databaseService.js - NEW):**
- Manage singleton connection pool (getPool)
- Load credentials from Secrets Manager + SSM
- Implement error handling and retries (transient vs permanent)
- Wrap stored procedure invocations
- Return query results to handler
- Emit detailed database operation logs

**Configuration Module (config.js - EXISTING):**
- Load environment variables and Parameter Store values
- Cache SSM/Secrets Manager fetches to reduce AWS API calls

**Logger Module (logger.js - EXISTING):**
- Format structured JSON logs
- Track traceId and requestId across invocations
- Support log levels (info, warn, error)

---

## Options Considered

### Option A: Raw SQL Queries (REJECTED)

- **Pros:** No abstraction, minimal overhead
- **Cons:** Business logic scattered across Lambda handler; hard to test; no audit trail; not atomic; retry logic duplicated
- **Why Rejected:** Violates single-responsibility principle; difficult to maintain consistency across multiple Lambda invocations

### Option B: ORM (TypeORM / Sequelize) (REJECTED)

- **Pros:** Type safety, query builder, migrations
- **Cons:** Heavy dependencies (50+ packages); slow cold start; overkill for simple stored procedure calls; locks us into ORM semantics
- **Why Rejected:** Lambda cold start performance is critical; stored procedures already handle business logic atomically; ORM adds unnecessary complexity

### Option C: Stored Procedure Gateway (CHOSEN) ✅

- **Pros:** Business logic centralized in DB; atomic transactions; audit trails via triggers; version control on procedures; easy to test; minimal Lambda code
- **Cons:** Requires pre-deployment of DDL and procedures; tight coupling to DB schema
- **Why Chosen:** Aligns with isStellantisBrand pattern; Aurora stored procedures are fast; idempotency via UNIQUE constraint is native to DB; audit trail built-in

---

## Simplicity And Elegance Review

- **Simplest Viable Shape:** One module (databaseService.js) with 5 methods, one connection pool, no ORM or query builder.
- **Coupling Check:** Database layer (databaseService) has zero dependency on HTTP layer; index.js calls databaseService methods, not SQL queries directly.
- **Future-Proofing:** Stored procedures deferred to DB team; Lambda code changes only if API contract changes or stored procedure signatures expand.
- **Testability:** databaseService methods easily mocked; unit tests don't need Lambda or HTTP context.

---

## Components And Interfaces

### 5.1 DatabaseService

**File:** `synch-status/src/services/databaseService.js` (NEW)

**Purpose:** Singleton connection pool + stored procedure wrapper

**Public Interface:**

```javascript
class DatabaseService {
  // Async initialization (singleton pattern)
  static async getPool() → pg.Pool
  
  // Mark successful DJC response
  async markSuccess(requestId, jsonModified, djcHttpStatusCode) → {rows_affected, request_id}
  
  // Mark failed DJC response with error details
  async markFailure(requestId, errorMessage, errorDetails, djcHttpStatusCode) → {rows_affected, retry_count, next_status}
  
  // Mark for retry (batch scheduler)
  async incrementRetry(requestId) → {rows_affected, new_retry_count}
  
  // Query pending communications
  async getPending(requestIdOrJobCardId, pagination) → [{request_id, status, djc_accepted, ...}]
  
  // Internal: credential loading
  static async _loadCredentials() → {username, password, dbname, port}
  
  // Internal: retry wrapper
  async _executeWithRetry(fn, context) → any
}
```

**Error Handling Strategy:**

```
Error Classification:
├── Transient (retry 3x with backoff)
│   ├── ECONNREFUSED (connection refused)
│   ├── ETIMEDOUT (socket timeout)
│   ├── statement_timeout (query timeout > 5s)
│   └── ENOTFOUND (DNS not resolving)
├── Permanent (no retry, 500 or 409)
│   ├── syntax error (invalid SQL)
│   ├── permission denied (IAM/role issue)
│   ├── UNIQUE constraint violation (duplicate request_id)
│   └── column not found (schema mismatch)
└── Pool Error (invalidate cache, reinit on next invoke)
    ├── pool.on('error')
    ├── pool exhaustion (all connections busy)
    └── connection end (AWS closes connection)
```

**Implementation Pattern:**

```javascript
class DatabaseService {
  constructor(logger, config) {
    this.logger = logger;
    this.config = config;
    // Pool is ALWAYS accessed via static getPool(), never instantiated here
  }

  // Stored procedure wrapper with retry logic
  async markSuccess(requestId, jsonModified, djcHttpStatusCode, logger, traceId) {
    // 1. Classify error before retry decision
    // 2. Retry transient 3x: 100ms, 500ms, 1s
    // 3. Log each attempt with attempt_number, duration_ms
    // 4. Return structured result: {rows_affected, request_id, duration_ms}
    // 5. Throw on permanent error; handler catches and returns 500/409
  }
}
```

### 5.2 Handler Integration (index.js MODIFIED)

**Changes to existing handler:**

```javascript
// At top of file
const DatabaseService = require('./services/databaseService');

// In _handlePostSynchStatus
const dbService = new DatabaseService(logger, config);

switch (status) {
  case 'SUCCESS':
    const result = await dbService.markSuccess(
      requestId, 
      jsonModified, 
      djcHttpStatusCode
    );
    logger.info('DB markSuccess completed', {action: 'mark_success', ...result});
    return buildResponse(200, {...});
    
  case 'FAILURE':
    const failResult = await dbService.markFailure(
      requestId,
      errorMessage,
      errorDetails,
      djcHttpStatusCode
    );
    logger.info('DB markFailure completed', {action: 'mark_failure', ...failResult});
    return buildResponse(200, {...});
}
```

---

## Data Models

### Table: woc.comunication_asyncro_djc

**Key Fields:**

| Field | Type | Constraint | Notes |
| --- | --- | --- | --- |
| response_id | UUID | PK | Unique response ID, generated by DB |
| request_id | UUID | UNIQUE | Idempotent key (webhook replay-safe) |
| status | djc_sync_status (ENUM) | NOT NULL | PENDING → SUCCESS/FAILURE/RETRY_PENDING/ERROR/TIMEOUT |
| retry_count | SMALLINT | DEFAULT 0 | Incremented on each retry, max 5 |
| djc_accepted | BOOLEAN | DEFAULT FALSE | True if DJC accepted the push |
| error_message | TEXT | nullable | Human-readable error from DJC |
| error_details | JSONB | nullable | Structured error for programmatic handling |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Record creation timestamp |
| updated_at | TIMESTAMPTZ | DEFAULT NOW() | Updated on every mutation (via trigger) |
| created_by | VARCHAR(100) | NOT NULL | Source system name (no default) |
| source_system | VARCHAR(100) | NOT NULL | Origin (lambda-xxx, batch-job, etc.) |
| version | INT | DEFAULT 1 | Optimistic locking |

**Indexes:**

- `idx_request_id_unique` on (request_id) — for idempotent lookups
- `idx_status_created_at` on (status, created_at DESC) — for pagination queries
- `idx_job_card_id_status` on (job_card_id, status) — for job card tracking

---

## Stored Procedures (Assumed Pre-Deployed)

### Procedure: woc.mark_success

```sql
CREATE PROCEDURE woc.mark_success (
  p_request_id UUID,
  p_json_modified JSONB,
  p_djc_http_status_code INT
)
AS $$
BEGIN
  UPDATE comunication_asyncro_djc
  SET
    status = 'SUCCESS',
    djc_accepted = TRUE,
    json_modified = p_json_modified,
    djc_http_status_code = p_djc_http_status_code,
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
  WHERE request_id = p_request_id;
  -- Idempotent: no error if row not found (upsert semantics)
END;
$$ LANGUAGE plpgsql;
```

### Procedure: woc.mark_failure

```sql
CREATE PROCEDURE woc.mark_failure (
  p_request_id UUID,
  p_error_message TEXT,
  p_error_details JSONB,
  p_djc_http_status_code INT
)
AS $$
BEGIN
  UPDATE comunication_asyncro_djc
  SET
    status = CASE
      WHEN retry_count + 1 >= 5 THEN 'ERROR'::djc_sync_status
      ELSE 'FAILURE'::djc_sync_status
    END,
    djc_accepted = FALSE,
    error_message = p_error_message,
    error_details = p_error_details,
    djc_http_status_code = p_djc_http_status_code,
    retry_count = retry_count + 1,
    updated_at = CURRENT_TIMESTAMP,
    version = version + 1
  WHERE request_id = p_request_id;
END;
$$ LANGUAGE plpgsql;
```

---

## Credential Loading Flow

### Cold Start (First Invocation)

```
1. Lambda starts → environment loaded (DB_SECRET_ARN_PARAM, RDS_PROXY_ENDPOINT_PARAM)
2. databaseService.getPool() called
3. Check cachedPool → null (cold start)
4. Call getSsmParameter(DB_SECRET_ARN_PARAM)
   - SSM param store → returns ARN (e.g., "arn:aws:secretsmanager:eu-west-1:123456789:secret:...")
5. Call getCredentials(ARN)
   - Secrets Manager → returns {"username": "user", "password": "***", "dbname": "woc", "port": 5432}
6. Create pg.Pool({host, port, database, user, password, ssl: true, max: 1, connectionTimeout: 5000})
7. Verify pool.connect() succeeds (test connection)
8. Cache pool in module-level cachedPool
9. Return pool
```

### Warm Start (Subsequent Invocation)

```
1. Lambda executes (pool already cached)
2. databaseService.getPool() called
3. Check cachedPool → pool instance (valid)
4. Return immediately (no SSM or Secrets Manager calls)
5. Latency: ~0ms (vs 150-300ms for credential fetch)
```

### Pool Error Recovery

```
1. During query execution, connection error occurs
2. pool.on('error') event fires → databaseService invalidates cache (cachedPool = null)
3. Lambda completes with error response
4. Next invocation calls getPool() → cachedPool is null
5. Force full reinitialization (credential fetch + new pool)
6. Normal operation resumes
```

---

## Error Handling & Failure Modes

### Scenario 1: Transient Connection Timeout

```
Request: POST /synch-status
Action: markSuccess(requestId, jsonModified, 200)

Try #1: pool.query() → ETIMEDOUT
  Attempt: 1/3
  Delay: 100ms
  Log: action=markSuccess, error_type=transient, error_code=ETIMEDOUT, attempt=1/3

Try #2: pool.query() → SUCCESS ✅
  Delay: 100ms (from Try #1 backoff)
  Result: rows_affected=1
  Response: HTTP 200 OK

Log Level: WARN (recovered after retry)
Outcome: Success ✅ (transparent to caller)
```

### Scenario 2: Permanent Constraint Violation

```
Request: POST /synch-status (replay of webhook)
Action: markSuccess(requestId, jsonModified, 200)
Note: Same request_id already exists

Try #1: pool.query() → UNIQUE constraint violation
  Error Type: PERMANENT (not transient)
  Error Code: 23505 (PostgreSQL unique_violation)
  Attempt: 1/1 (no retry for permanent)
  Decision: No more retries

Handler catches error:
  HTTP Status: 409 CONFLICT (idempotent: second request returned 409, not 500)
  Response Body: {error: "Duplicate request_id", requestId, suggestion: "Already processed"}

Log Level: INFO (expected behavior, not error)
Outcome: Idempotent semantics ✅ (first call 200, replay 409)
```

### Scenario 3: Secrets Manager Access Denied

```
Request: POST /synch-status
Action: getPool() → getSsmParameter() → getCredentials()

Try #1: Secrets Manager GetSecretValue() → AccessDenied
  Error Type: PERMANENT (IAM misconfiguration, not transient)
  Error Code: User: arn:aws:iam::123:role/lambda-role not authorized
  Decision: No retry (IAM issue won't resolve mid-request)

Handler catches error:
  HTTP Status: 500 INTERNAL SERVER ERROR
  Response Body: {error: "Database credentials unavailable"}
  Log Level: ERROR + ALERT (ops team must check IAM)

Outcome: Fail-fast ✅ (vs. wasting 3 retries on misconfiguration)
```

### Scenario 4: Pool Exhaustion (All Connections Busy)

```
Request: POST /synch-status (during spike)
Action: pool.connect() → ENQUEUE (waiting for available connection)

Timeout: 5000ms (connectionTimeoutMillis exceeded)
  Error Type: TRANSIENT (pool might recover)
  Error Code: ETIMEDOUT

Try #1: Wait → 5s timeout → ETIMEDOUT
  Attempt: 1/3
  Delay: 100ms

Try #2: Wait → 5s timeout → ETIMEDOUT
  Attempt: 2/3
  Delay: 500ms

Try #3: Wait → 5s timeout → ETIMEDOUT
  Attempt: 3/3
  Delay: 1000ms
  Total Elapsed: 15s (exceeds Lambda 30s timeout)

Handler decides: All retries exhausted
  HTTP Status: 503 SERVICE UNAVAILABLE (system degraded)
  Response Body: {error: "Database temporarily unavailable", retry_after: 5}

Log Level: WARN (expected under spike conditions)
Outcome: Degradation handling ✅ (client retries after 5s)
```

---

## Security Considerations

### Credential Management

- **Secret Storage:** AWS Secrets Manager only (never hardcoded, never logged)
- **Secret Rotation:** AWS auto-rotates quarterly; cache TTL (50min) aligns with rotation window
- **Access Control:** Lambda IAM role has least privilege: secretsmanager:GetSecretValue on specific secret ARN only
- **Encryption:** Secrets encrypted at rest (AWS KMS) and in transit (TLS 1.3)

### Connection Security

- **TLS Requirement:** Pool configured with `ssl: true` for Aurora (mandatory for prod)
- **Certificate Validation:** AWS SDK performs hostname verification automatically
- **VPC Isolation:** (Assumed) Aurora in private VPC; Lambda must have VPC ENI (out of scope for this feature)

### SQL Injection Prevention

- **Parameterized Queries:** All procedures use `$1, $2, $3` placeholders (no string interpolation)
- **Input Validation:** Lambda handler validates payload structure before passing to stored procedures
- **JSONB Safety:** JSON fields validated at application layer before passing to DB

### Logging Security

- **No Secrets in Logs:** All logs redact passwords, tokens, secret ARNs
- **Structured Logging:** Log fields are whitelist-only (not debug dumps of event)
- **CloudWatch Retention:** Logs retained 30 days; older logs archived to S3 (Glacier)

---

## Monitoring & Observability

### CloudWatch Metrics (Custom Namespace: SyncroKafkaEventsDB)

```
Metrics to emit:
- DBConnectionTime (ms) — time to acquire connection from pool
- DBQueryDuration (ms) — time for stored procedure execution
- DBErrorCount (by error_type: transient, permanent, pool_error)
- DBRetryCount (attempt 1, 2, 3)
- DBConnectionPoolSize (current pool size)
- DBConnectionPoolWaitTime (ms waiting in queue)

Dimensions:
- Environment: dev, stage, prod
- Operation: mark_success, mark_failure, increment_retry, get_pending
- ErrorType: transient, permanent, connection_error
```

### Structured JSON Logs

```json
{
  "timestamp": "2026-09-17T19:55:30.123Z",
  "level": "info",
  "action": "mark_success",
  "request_id": "550e8400-e29b-41d4-a716-446655440000",
  "trace_id": "1-550e8400-xyz",
  "attempt": 1,
  "duration_ms": 45,
  "status": "SUCCESS",
  "rows_affected": 1,
  "pool_age_ms": 5000,
  "db_operation": "CALL woc.mark_success(...)",
  "djc_http_status_code": 200
}
```

### X-Ray Tracing

```
Subsegments:
├── pool_connect (initialization or acquire)
├── ssm_get_parameter (credential fetch)
├── secrets_manager_get_secret (secret fetch)
├── db_query (stored procedure execution)
│   ├── prepare_statement
│   ├── bind_parameters
│   ├── execute
│   └── fetch_results
└── retry_backoff (if retry)
```

### Alarms (Pre-configured in CloudFormation)

- `DBErrorRate > 1%` for 5 min → page on-call
- `DBRetryExhaustion > 10/min` → alert (system degrading)
- `ConnectionTimeoutCount > 5/min` → investigate pool sizing
- `P99Latency > 2s` → investigate DB or Lambda performance

---

## Requirement Coverage

| Requirement | Covered By | Verification |
| --- | --- | --- |
| `R1` | Pool Management (databaseService.getPool singleton) | Unit + integration tests: cold start, warm reuse, error recovery |
| `R2` | Credential Management (SSM + Secrets Manager dual-source) | Unit: mock both services; Integration: live Secrets Manager |
| `R3` | mark_success Procedure | Integration test: invoke procedure, verify status='SUCCESS' |
| `R4` | mark_failure Procedure | Integration test: invoke procedure, verify retry_count incremented |
| `R5` | increment_retry Procedure | Integration test: batch Lambda calls this method |
| `R6` | get_pending Procedure | Integration test: query returns rows matching status filter |
| `R7` | Idempotency (UNIQUE constraint + upsert) | Integration test: duplicate request_id handled (no 2nd row) |
| `R8` | Error Handling (retry classification) | Unit: mock transient/permanent errors; Integration: real timeout |
| `R9` | Logging & Observability | Unit: verify log format; Prod evidence: CloudWatch + dashboard |
| `R10` | CloudFormation Integration | Code review: ${Env} substitution; Deploy test: values injected |

**Acceptance Criteria Coverage:**

| `R1.AC1` | Pool initialization on cold start | Unit test: mock pool creation |
| `R1.AC2` | Warm start reuse | Integration test: verify same pool instance returned |
| `R1.AC3` | Pool error invalidation | Mock pool error, verify next invoke reinits |
| `R1.AC4` | 5s timeout | Unit test: timeout error thrown at 5s |
| `R1.AC5` | max: 1 | Code review: verify config |
| `R2.AC1` | SSM parameter loading | Unit test: mock SSM response |
| `R2.AC2` | Secrets Manager fetch | Unit test: mock Secrets Manager response |
| `R2.AC3` | JSON parsing | Unit test: verify parsing |
| `R2.AC4` | No secret logging | Log audit: grep for password in logs |
| `R2.AC5` | Error propagation | Unit test: verify 500 response |
| `R2.AC6` | Credential caching | Integration test: warm invoke doesn't call SSM |
| `R2.AC7` | Cache invalidation on pool error | Unit test: verify cache cleared |
| `R3.AC1` | mark_success invocation | Integration test: call procedure |
| `R3.AC2` | Procedure logic | Unit test: mock query execution |
| `R3.AC3` | Idempotent upsert | Unit test: rows_affected = 0 for non-existent |
| `R3.AC4` | Logging | Code review: log statements present |
| `R3.AC5` | 3-retry backoff | Integration test: simulate transient error 3x |
| `R4.AC1` | mark_failure invocation | Integration test: call procedure |
| `R4.AC2` | Retry increment | Unit test: mock query execution |
| `R4.AC3` | Max retry limit | Unit test: stored procedure logic |
| `R4.AC4` | Logging | Code review: log statements present |
| `R4.AC5` | Retry on failure | Integration test: simulate all 3 retries fail |
| `R5.AC1` | increment_retry invocation | Integration test: batch Lambda calls |
| `R5.AC2` | Status transition | Unit test: verify status change |
| `R5.AC3` | Logging | Code review: log statements |
| `R6.AC1` | get_pending invocation | Integration test: query execution |
| `R6.AC2` | Row fields returned | Unit test: verify response shape |
| `R6.AC3` | Pagination | Integration test: test limit/offset |
| `R6.AC4` | Not found handling | Integration test: empty result returns 404 |
| `R7.AC1` | UNIQUE constraint | Database review: DDL verification |
| `R7.AC2` | No constraint violation | Integration test: duplicate request_id safe |
| `R7.AC3` | Upsert semantics | Integration test: duplicate detected + logged |
| `R7.AC4` | Duplicate detection log | Code review: log statement present |
| `R7.AC5` | Idempotent semantics | E2E test: replay returns same response |
| `R8.AC1` | Transient error retry | Unit test: ETIMEDOUT retried 3x |
| `R8.AC2` | Permanent error handling | Unit test: syntax error not retried |
| `R8.AC3` | Permanent error response | Unit test: log + return 500/409 |
| `R8.AC4` | Exhausted retry handling | Integration test: all 3 retries fail → 503 |
| `R8.AC5` | Pool error recovery | Unit test: pool error invalidates cache |
| `R8.AC6` | Error logging | Code review: log fields present |
| `R9.AC1` | Structured JSON logs | Unit test: verify log format |
| `R9.AC2` | Handler start log | Code review: log statement present |
| `R9.AC3` | Pool initialization log | Unit test: verify log format |
| `R9.AC4` | Error log | Unit test: error log format |
| `R9.AC5` | CloudWatch metrics | Unit test: metric emission verified |
| `R9.AC6` | Metric dimensions | Code review: dimension names |
| `R9.AC7` | X-Ray tracing | Unit test: subsegment creation verified |
| `R10.AC1` | Lambda env variables | Code review: template.yaml has vars |
| `R10.AC2` | Parameter naming convention | Code review: EnvSuffix applied |
| `R10.AC3` | IAM policy | Code review: least privilege verified |
| `R10.AC4` | No other Lambda modifications | Code review: only synch-status changed |
| `R10.AC5` | Changes isolated | Code review: template isolated to function |

---

## Failure Modes And Tradeoffs

### Failure Mode 1: Connection Pool Exhaustion

**What can go wrong:** All connections in pool are in use; new request cannot acquire connection within timeout (5s).

**Mitigation:** Pool timeout enforced at 5s; if connection not acquired, fail fast and return HTTP 503 Service Unavailable. Next Lambda invocation gets fresh pool.

**Tradeoff:** Max pool size = 1 (per Lambda invocation). Scales horizontally: 1000 concurrent Lambdas = 1000 DB connections. Aurora default max is 1000 connections; sufficient for this architecture.

### Failure Mode 2: Secrets Manager Rotation

**What can go wrong:** Secret is rotated in Secrets Manager but Lambda still uses old password (cached for 50 min by AWS SDK).

**Mitigation:** Cache TTL aligns with rotation frequency (quarterly in this architecture). On pool error, cache is invalidated, forcing credential refresh on next invoke.

**Tradeoff:** Up to 50 min lag after rotation before Lambda adapts. Acceptable for quarterly rotations; not suitable for on-demand rotation.

### Failure Mode 3: Transient Network Partition

**What can go wrong:** Lambda can't reach Aurora for 1-2s, then connection recovers.

**Mitigation:** Retry logic: 3 attempts with backoff (100ms, 500ms, 1s). Total ~1.6s per request; 2s network partition recovers within this window.

**Tradeoff:** User waits up to 1.6s for HTTP response. Acceptable for async webhook handler; not suitable for critical path requiring sub-100ms latency.

### Failure Mode 4: Duplicate Request ID (Webhook Replay)

**What can go wrong:** DJC times out on initial POST, retries same payload. Without idempotency, duplicate rows created in database.

**Mitigation:** UNIQUE constraint on request_id enforced in DDL; stored procedure implements upsert semantics (update if exists, else insert).

**Tradeoff:** Second webhook returns HTTP 200 OK (not HTTP 409 Conflict) to achieve full idempotency. Client cannot distinguish "first time" from "replay" from response code alone. Trade accepted for simplicity.

### Failure Mode 5: Aurora Node Failover

**What can go wrong:** Aurora node fails mid-query; connection drops.

**Mitigation:** Aurora auto-failover is transparent to client (typically 5-30s). pg driver detects connection loss, throws ECONNREFUSED. Retry logic catches it and retries.

**Tradeoff:** If Aurora failover duration > 1.6s (retry window), Lambda request times out (Lambda timeout typically 30s, acceptable). If failover > 30s, manual investigation required.

---

## Verification Plan

### Requirement Proof Strategy

Every requirement R1-R10 is proven by one or more of:

1. **Unit Test:** Mock pg.Pool, Secrets Manager, SSM; assert behavior without real DB or AWS account.
2. **Integration Test:** Spin up test Aurora (Docker); deploy stored procedures; assert end-to-end flow.
3. **Operational Evidence:** CloudWatch logs (JSON structured), metrics (DBQueryDuration), X-Ray traces from production Lambda run.

### Test Evidence

**Unit Tests** (command: `npm test -- test/unit`):
- R1: Pool lifecycle (cold start initialization, warm start reuse, error recovery on pool.on('error'))
- R2: Credential loading (SSM Parameter Store read, Secrets Manager decrypt, JSON parsing)
- R3-R6: Stored procedure invocation (markSuccess, markFailure, incrementRetry, getPending)
- R7: Idempotency (UNIQUE constraint enforcement, duplicate request_id handling)
- R8: Error handling (transient vs permanent classification, retry backoff)
- R9: Logging (JSON structure, no secrets exposed, traceId + requestId present)
- Coverage target: >= 90%

**Integration Tests** (command: `npm test -- test/integration`):
- Full flow: getPool → loadCredentials → markSuccess → getPending
- Error scenarios: ETIMEDOUT retry, UNIQUE constraint violation, pool exhaustion
- Idempotency: markSuccess twice with same request_id → rows_affected=0 on second call
- Test against real Aurora Docker container (postgres:13)

**E2E Tests** (manual + synthetic):
- Deploy to dev environment via CloudFormation
- Trigger webhook via API Gateway POST /synch-status
- Verify database row created in woc.comunication_asyncro_djc with correct status
- Replay webhook with same request_id: verify idempotent behavior (HTTP 200, no duplicate row)
- Check CloudWatch logs for structured JSON with action, request_id, trace_id, duration_ms
- Monitor CloudWatch metrics: DBQueryDuration, DBErrorCount, DBRetryCount

### Operational Evidence (Production)

When live in production:

- **CloudWatch Logs:** All operations logged as structured JSON; pattern `action=mark_success` captures success path; `action=mark_failure, attempt=2/3` captures retries.
- **CloudWatch Metrics:** Dashboard shows DBErrorRate, DBRetryCount, DBQueryDuration; anomalies trigger investigation.
- **X-Ray Traces:** Subsegments show timing breakdown (pool_connect ~50ms, db_query ~100ms, credentials_load ~200ms cold start).
- **Alarms:** DBErrorRate > 1% for 5 min → page on-call engineer; verifies IAM, Secrets Manager, Aurora availability.

---

## Testing Strategy

**Unit Tests (databaseService.js):**
- Mock pg.Pool, Secrets Manager, SSM
- Test credential loading, error classification, retry logic
- Coverage target: >= 90%

**Integration Tests:**
- Spin up test Aurora instance (Docker Postgres)
- Deploy test stored procedures
- Test full flow: credential fetch → pool connect → procedure call → result
- Test error scenarios: transient timeout, permanent constraint violation, pool exhaustion

**E2E Tests:**
- Deploy to dev environment
- Trigger webhook payload via API Gateway
- Verify database row created with correct status
- Verify repeated webhook is idempotent (409 Conflict)

---

**Design Status:** DRAFT — Ready for Phase 2 Walden Review

