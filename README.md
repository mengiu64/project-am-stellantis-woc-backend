# syncro-kafka-events Lambda

REST API Lambda per sincronizzazione eventi Kafka da SRP Digital Layer a sistemi esterni (DJC/GCT).

## Architettura

```
SRP Digital Layer (Kafka)
        ↓
API Gateway HTTP API (APIC)
        ↓
Lambda: syncro-kafka-events
        ├── Auth: OAuth2 + IBM API Connect
        ├── Validate: Joi payload validation
        └── Forward to: DJC + GCT (retry 3x con backoff)
```

## Struttura Progetto

```
src/
├── config/          # Configurazione centralizzata
│   └── config.js    # Parameter Store + Secrets Manager
├── handlers/        # Lambda handler entry points
│   └── index.js     # POST/GET orchestration
├── services/        # Business logic
│   ├── authService.js              # OAuth2 + APIC auth
│   └── externalSystemClient.js     # DJC/GCT HTTP client
└── utils/           # Utilities
    ├── logger.js    # Winston structured logging
    └── validator.js # Joi payload validation

test/
├── unit/            # Unit tests (mocked services)
├── integration/     # Integration tests (real AWS calls)
└── utils/
    ├── factories.js # Test data generators
    └── mocks.js     # Mock services
```

## Setup Locale

### Prerequisiti
- Node.js >= 18.0.0
- AWS CLI v2 configurato (aws configure)
- SAM CLI installato
- Docker (per SAM local testing)

### Installazione Dipendenze

```bash
cd /home/studio/workspace/Stellantis-lambda
npm install
```

### Variabili Environment

Crea file `.env.local` con:

```bash
ENVIRONMENT=dev
AWS_REGION=eu-west-1
LOG_LEVEL=info
```

### Test Locali

```bash
# Esegui test unit
npm run test:unit

# Esegui test con coverage
npm test

# Test watch mode (per sviluppo)
npm run test:watch

# Esegui test integration
npm run test:integration
```

## Deployment

### Pre-deployment Checklist

```bash
# Valida CloudFormation
sam validate

# Compila
sam build

# Test locale con SAM (se Docker disponibile)
sam local start-api
```

### Deploy a Dev

```bash
sam deploy \
  --template-file template.yaml \
  --parameter-overrides Env=dev \
  --stack-name stellantis-syncro-kafka-events-dev \
  --region eu-west-1 \
  --capabilities CAPABILITY_NAMED_IAM
```

### Deploy a Stage/Produzione

```bash
sam deploy \
  --template-file template.yaml \
  --parameter-overrides Env=stage \
  --stack-name stellantis-syncro-kafka-events-stage \
  --region eu-west-1 \
  --capabilities CAPABILITY_NAMED_IAM
```

## Configurazione AWS Pre-requisiti

Prima di deployare, configura i parametri in Parameter Store e Secrets:

### Parameter Store

```bash
# Dev
aws ssm put-parameter --name /stellantis/syncro-kafka-events/oauth-client-id-dev --value "dev-client-id" --type String
aws ssm put-parameter --name /stellantis/syncro-kafka-events/oauth-token-url-dev --value "https://ping-dev.local/oauth/token" --type String
aws ssm put-parameter --name /stellantis/syncro-kafka-events/apic-client-id-dev --value "dev-apic-client" --type String
aws ssm put-parameter --name /stellantis/syncro-kafka-events/apic-url-dev --value "https://apic-dev.local" --type String
aws ssm put-parameter --name /stellantis/syncro-kafka-events/djc-endpoint-dev --value "https://djc-dev.local/api/events" --type String
aws ssm put-parameter --name /stellantis/syncro-kafka-events/gct-endpoint-dev --value "https://gct-dev.local/api/events" --type String

# Stage
aws ssm put-parameter --name /stellantis/syncro-kafka-events/oauth-client-id-stage --value "stage-client-id" --type String
# ... etc

# Produzione (no suffix)
aws ssm put-parameter --name /stellantis/syncro-kafka-events/oauth-client-id --value "prod-client-id" --type String
# ... etc
```

### Secrets Manager

```bash
aws secretsmanager create-secret \
  --name stellantis/syncro-kafka-events/oauth-credentials-dev \
  --secret-string '{"clientId":"dev-oauth-client","clientSecret":"dev-oauth-secret"}'
```

## API Endpoints

### POST /api/synch-status

Invia evento Kafka a sistemi esterni.

**Request:**
```json
{
  "events": [
    {
      "eventId": "550e8400-e29b-41d4-a716-446655440000",
      "timestamp": "2024-01-15T10:30:00Z",
      "eventType": "JOBS_UPDATE",
      "dealerId": "DEALER001",
      "payload": {
        "jobId": "JOB123",
        "status": "COMPLETED"
      }
    }
  ]
}
```

**Response (200 OK):**
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "message": "Eventi inviati con successo",
  "results": {
    "successful": 2,
    "failed": 0
  },
  "traceId": "trace-id-123"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Bad Request",
  "message": "Validazione fallita",
  "details": [
    {
      "field": "events.0.eventType",
      "message": "eventType non riconosciuto..."
    }
  ],
  "traceId": "trace-id-123"
}
```

### GET /api/synch-status/{requestId}

Ottieni stato richiesta.

**Response (200 OK):**
```json
{
  "requestId": "550e8400-e29b-41d4-a716-446655440001",
  "status": "PENDING",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:30:05Z",
  "traceId": "trace-id-123"
}
```

## Monitoraggio & Logging

### CloudWatch Logs

Accedi a CloudWatch:
```bash
aws logs tail /aws/lambda/stellantis-syncro-kafka-events-dev --follow
```

### CloudWatch Logs Insights - Queries

**Errori ultimi 15 minuti:**
```
fields @timestamp, @message, errorType, statusCode
| filter @message like /ERROR/
| stats count() as error_count by statusCode
| sort error_count desc
```

**Latenza P95:**
```
fields @duration
| stats pct(@duration, 95) as p95_latency
```

**Errori per Dealer:**
```
fields dealerId, statusCode, @message
| filter statusCode >= 400
| stats count() as failures by dealerId
```

### CloudWatch Alarms

Alarms configurati automaticamente via CloudFormation:
- **Error Rate** > 10 errori in 5 minuti
- **Throttles** >= 5 throttles in 5 minuti
- **Duration** Average > 25 secondi in 2 periodi

## Troubleshooting

### OAuth2 Token Timeout
Se vedi "OAuth2 token acquisition timeout" nei log:
1. Verifica PingFederate URL in Parameter Store
2. Aumenta timeout da 5s a 10s in src/config/config.js
3. Verifica network connectivity da Lambda VPC

### External System 401/403
Se DJC/GCT ritorna 401:
1. Verifica X-IBM-Client-Id è corretta in Secrets Manager
2. Verifica OAuth2 token non è scaduto
3. Controlla CloudWatch Logs con trace ID

### Validation Failure
Se eventi vengono rifiutati con "Bad Request":
1. Verifica eventType è tra: JOBS_UPDATE, APPOINTMENTS_UPDATE, VIDEOCHECK_JOB_UPDATED, JOBS_UPDATE_WITH_PREAPPROVAL
2. Verifica eventId è UUID valido (v4)
3. Verifica dealerId minimo 3 caratteri

## Cost Optimization

Lambda cost per month (10M invocations):
- Lambda execution: ~$1.67
- API Gateway: ~$35
- CloudWatch Logs: ~$2,560 (main cost driver)

**Mitigation:**
- Implementa log sampling: 1/100 per INFO level
- Riduci retention a 30 giorni
- Archivia log in S3 per long-term retention

## Rollback Plan

Se deployment fallisce in produzione:

```bash
# Rollback a versione precedente
aws lambda update-alias \
  --function-name stellantis-syncro-kafka-events-produzione \
  --name LIVE \
  --function-version 4

# Verifica traffic è routed correttamente
aws cloudwatch get-metric-statistics \
  --namespace AWS/Lambda \
  --metric-name Invocations \
  --dimensions Name=FunctionName,Value=stellantis-syncro-kafka-events-produzione
```

## Supporto & Documentazione

- **Architecture Design:** Vedi `design-syncro-kafka-events.md` su Atlas
- **Requirements:** Vedi `requirements-syncro-kafka-events.md` su Atlas
- **Tasks Detail:** Vedi `tasks-syncro-kafka-events.md` su Atlas
- **Enterprise Standards:** Vedi `industry-standards-enterprise-api-management.md` su Atlas

## Team

- **Development:** AWS Lambda Node.js 18.x
- **Deployment:** AWS SAM CLI
- **Monitoring:** CloudWatch Logs Insights + X-Ray
- **Integration:** DJC, GCT external systems via HTTPS + OAuth2
