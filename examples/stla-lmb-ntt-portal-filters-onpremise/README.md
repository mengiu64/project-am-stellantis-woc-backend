# stla-lmb-ntt-portal-filters-onpremise

AWS Lambda - NTT Portal: Legacy on-premise filter data service (reference/compatibility version)

- DEV Lambda: `lmb-np-BSN0027990-dev-ntt-portal-filters-onpremise`
- DEV Role: `stla-rol-np-BSN0027990-dev-ntt-portal-filters-onpremise`
## Overview

This repository contains a Node.js AWS Lambda sample used to validate the Stellantis CI/CD model:

- Multi-environment deployment: `dev`, `stage`, `production`
- GitHub Actions pipeline with OIDC-based AWS authentication
- Branch-based deployment strategy (`develop`, `stage`, `main`)
- Security checks (lint, tests, coverage, npm audit, dependency review; SonarQube currently disabled)

## Repository Structure

```text
.
├── src/
│   └── handler.js
├── test/
│   └── handler.test.js
├── config/
│   ├── dev.json
│   ├── stage.json
│   └── prod.json
├── scripts/
│   └── setup-aws-oidc.sh
├── .github/
│   ├── actions/setup-aws-cli/action.yml
│   └── workflows/main.yml
├── package.json
├── jest.config.js
└── eslint.config.mjs
```

## Prerequisites

- Node.js `>= 18` (pipeline currently uses Node.js `24`)
- npm
- AWS CLI (for AWS setup and manual checks)
- Access to GitHub Organization settings (for organization-level secrets)
- AWS permissions to create IAM/OIDC resources in each account

## Branching Strategy

Use these long-lived branches:

- `develop` → DEV environment
- `stage` → STAGE environment
- `main` → PRODUCTION environment

For feature work, create short-lived branches from `develop` using this pattern:

- `feature/test-feature-1`

Typical flow:

1. Create branch from `develop` (example: `feature/test-feature-1`)
2. Open PR into `develop`
3. Promote changes by merging `develop` → `stage`
4. Promote changes by merging `stage` → `main`

## CI/CD Pipeline

Workflow file: `.github/workflows/main.yml`

### Triggers

- `push` on `feature/**`, `develop`, `stage`, `main`
- `pull_request` targeting `develop`, `stage`, `main`

### Job flow

1. `Lint`
2. `Compile` (creates ZIP artifact with `src/`, `node_modules/`, `package.json`, `package-lock.json`)
3. `Test` (unit tests + coverage summary)
4. `CodeQuality` (SonarQube steps currently disabled)
5. `Security_Analysis` (npm audit + dependency review)
6. Environment deploy job:
   - `Dev-Deploy` on `develop`
   - `Stage-Deploy` on `stage`
   - `Prod-Deploy` on `main`

### Deployment behavior by branch

| Branch | Lint/Test | Security | Deploy |
|---|---|---|---|
| `feature/**` | ✅ | ❌ (no env security gate/deploy path) | ❌ |
| `develop` | ✅ | ✅ | ✅ `dev` |
| `stage` | ✅ | ✅ | ✅ `stage` |
| `main` | ✅ | ✅ (strict audit) | ✅ `production` + release tag |

## AWS Authentication Model (OIDC)

The pipeline uses GitHub OIDC (`id-token: write`) and temporary AWS credentials.

High-level flow:

1. GitHub Actions requests a signed OIDC token
2. AWS STS validates the token against the account OIDC provider
3. Workflow assumes an environment-specific IAM role
4. Temporary credentials are used to deploy Lambda

Why this is preferred:

- No long-lived AWS access keys in repository secrets
- Per-environment role separation
- Better audit trail via CloudTrail
- Automatic token expiration

## Environment Configuration

Each environment has its own configuration file:

- `config/dev.json`
- `config/stage.json`
- `config/prod.json`

Important fields:

- `FunctionName`
- `Role` (Lambda execution role)
- `Handler`, `Runtime`, `Timeout`, `MemorySize`
- `VpcConfig.SubnetIds`, `VpcConfig.SecurityGroupIds`
- `Environment.Variables`
- `Layers`
- `TracingConfig`

Before first deployment, update VPC IDs, role ARNs, and environment variables with real values.

### Required values per environment file

For each file (`config/dev.json`, `config/stage.json`, `config/prod.json`), validate these values:

- `FunctionName`: target Lambda name in the environment account
- `Role`: existing Lambda execution role ARN (this is not the GitHub OIDC deploy role)
- `VpcConfig.SubnetIds`: private subnet IDs for the target environment
- `VpcConfig.SecurityGroupIds`: security group IDs for the target environment
- `Environment.Variables`: runtime variables (for example `ENVIRONMENT`, extension log level, app-specific vars)
- `Layers`: Lambda layer ARNs (for example Parameters and Secrets extension)

Execution role should include permissions equivalent to:

- `AWSLambdaVPCAccessExecutionRole`
- `AWSLambdaBasicExecutionRole`
- `AWSXRayDaemonWriteAccess`

### Environment profile differences

- `dev`: development networking, more verbose logging, debug-friendly settings
- `stage`: production-like settings for validation
- `prod`: production networking, optimized timeout/memory/logging

### Pre-deployment checklist

- `FunctionName` matches the target environment convention
- Lambda execution role exists and is valid
- VPC subnet and security group IDs are valid for the account/region
- Required runtime variables are present
- Layer ARNs are correct and up to date

## Initial AWS Setup (OIDC + Roles)

Use `scripts/setup-aws-oidc.sh` in each AWS account (`dev`, `stage`, `prod`) to create:

- OIDC provider (`token.actions.githubusercontent.com`)
- GitHub deployment role with trust policy restricted to this repository
- Required IAM policies/boundary according to Stellantis conventions

Run once per account (example):

```bash
cd scripts
chmod +x setup-aws-oidc.sh
AWS_PROFILE=dev ./setup-aws-oidc.sh
AWS_PROFILE=stage ./setup-aws-oidc.sh
AWS_PROFILE=prod ./setup-aws-oidc.sh
```

You will be asked for:

- GitHub organization
- Repository name
- Environment (`dev|stage|prod`)
- Stellantis APPID

Save the generated role ARNs for GitHub secrets.

## Required GitHub Secrets

Configure **organization-level** Actions secrets and grant access to this repository:

- `DEV_AWS_ROLE_ARN`
- `STAGE_AWS_ROLE_ARN`
- `PROD_AWS_ROLE_ARN`

Optional (for SonarQube):

- `SONAR_TOKEN`
- `SONAR_HOST_URL`

Note: SonarQube steps are currently commented in the workflow due to an ongoing integration issue.

## Local Development

Install dependencies:

```bash
npm ci
```

Run checks:

```bash
npm run lint
npm test
npm run test:coverage
```

Create package:

```bash
npm run package
```

## Security Policy

Supported line:

- `1.x.x`

Vulnerability reporting:

- Contact: `security@stellantis.com`
- Include: description, impact, reproduction steps, PoC/evidence, suggested fix, disclosure timeline

Target response times:

- Initial response: within 48h
- Status update: within 5 business days
- Fix target by severity:
  - Critical: 1-3 days
  - High: 1-2 weeks
  - Medium: 2-4 weeks
  - Low: next scheduled release

## Security Controls in This Repository

- Dependabot alerts and security updates
- `npm audit` in CI (stricter on `main`)
- Dependency Review on pull requests
- SonarQube scan/quality gate (currently disabled in workflow)
- Branch and environment-based release promotion
- OIDC-based AWS role assumption

Contributor checklist:

- Do not commit credentials or secrets
- Keep dependencies updated
- Validate inputs and avoid leaking sensitive data in errors
- Keep tests passing and coverage at expected thresholds

## License

ISC

