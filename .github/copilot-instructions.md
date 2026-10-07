# Copilot instructions — project-am-stellantis-woc-backend

## Big picture

This repo is a collection of **independent AWS Lambda (Node.js) modules**, each a
top-level folder with its own `package.json`, `node_modules`, `.env`, and Jest
test suite (`agendaSoa`, `agendaSoaNaga`, `dms`, `jobcard`, `djc`, `v360`,
`srpV360Ota`, `pkEper`, `pkDocsoa`, `pkMenupricing`, `pkManager`, `translations`,
`session`, `myPeople`, `pkFavorite`, `moparDoc`, `isStellantisBrand`,
`synch-status`, `dbManager`). They are
deployed via AWS SAM (`template.yaml`), one `AWS::Serverless::Function` per
module. There is no shared root `package.json`/build — everything is per-module.

Each module typically follows this shape: `index.js` (Lambda entry-point /
dispatcher, also runnable as a CLI via `node index.js <action> ...`),
`authService.js` (PingFederate bearer-token auth), `httpClient.js` (axios
wrapper), a `<Module>Service.js`, and `__tests__/` with Jest specs.

### Cross-module dependencies (important, non-obvious)

**Never import source from another Lambda.** Use
`serviceClient.callService(service, operation, payload)` over the private REST
API's `/internal/<service>/<operation>` routes, authenticated with IAM/SigV4.
`serviceClient/` is transport only, not a Lambda or shared domain layer.
Each owning service retains its own upstream credentials, DB pool and cache.
Internal repository contracts use `{ args: [...] }` without pool/token; Set/Map
results use wire arrays, reconstructed by consumers.

Makefile targets package only the current module, `serviceClient/` and
`runtimeConfig/`, then
install production dependencies inside the artifact. No sibling Lambda source,
tests, coverage or `.env*` files may be packaged.
New REST dependencies also require a receiver allowlist and operation-scoped
IAM policy in `infrastructure/internal-api.yaml`. The API Gateway is managed
outside the SAM stack: do not create an implicit API or deploy it automatically.
Configure the shared `sm-np-bsn0027990-<env>-internal-api-config` secret with
`WOC_INTERNAL_API_URL` and `WOC_INTERNAL_TIMEOUT_MS`; all consumers reference
it through `WOC_INTERNAL_CONFIG_SECRET_ID`. The infrastructure template grants
read access to the nine consumer execution roles. Execution roles use the normal
AWS credential chain, never hardcoded AWS credentials.

### Security convention: identity from the authorizer, never the client

Dealer/user identity (e.g. `username`) must come from
`event.requestContext.authorizer.sub` (API Gateway Lambda Authorizer), **never**
from a value supplied in the request body/query — a client could otherwise
impersonate another dealer. A fallback to a body-supplied value is only
acceptable when there is no `requestContext.authorizer` at all (direct Lambda
invocation / CLI testing). This pattern is applied in `session/src/index.js`
and `pkFavorite/index.js`; follow it for any new module reading identity.

### Event/action dispatch pattern

Most Lambda `index.js` files resolve `{ action, body }` from either:
1. a direct invocation payload `{ "action": "...", "body": {...} }`, or
2. a real API Gateway proxy event, taking the action from the last path
   segment and merging query-string params with a JSON body.

`jobcard` and `djc` share the same PingFederate/DGT client and the
`saveJobcard` action (POST is routed to `djc` by API Gateway, but the method
also exists in `jobcard` for CLI/direct-invocation parity).

## Build, test, lint

No root-level build/test command — operate **per module directory**.

```bash
cd <module>      && npm install          # install deps for that module only
cd <module>      && npm test             # run Jest for that module
cd <module>      && npm run test:coverage # Jest + coverage report (coverage/)
```

Run a single test file or test case (from inside the module directory):
```bash
npx jest __tests__/authService.test.js
npx jest -t "name of the test or describe block"
```

- Test framework: Jest, config lives in each module's `package.json` (not a
  separate `jest.config.js`). `testMatch` is `**/__tests__/**/*.test.js`.
- All tests are fully isolated — no real external calls; everything is mocked
  with `jest.mock()`.
- **Coverage threshold is enforced per module at 90%** (statements, branches,
  functions, lines) via `coverageThreshold.global` in each module's
  `package.json`; CI fails if a module drops below this.
- CI (`.github/workflows/unit-tests.yml`) runs one job per module: `npm ci`,
  `npm audit --audit-level=high` (fails build on high/critical vulns), then
  `npm run test:coverage -- --verbose`.
- SAM build: `sam build` (uses `template.yaml`); REST consumers/receivers use
  Makefile targets that package their own module and the shared HTTP transport.

## Conventions

- `.env` values are for local development only. In AWS, integration values
  are read at runtime from Secrets Manager, never copied into `process.env`
  or passed as CloudFormation credential parameters. Seven integration owners
  use `runtimeConfig.loadSettings()` with `WOC_CONFIG_SECRET_ID`; the REST
  transport uses the same loader with `WOC_INTERNAL_CONFIG_SECRET_ID`.
  Cache by secret ID, not globally: a Lambda may read both secrets.
  DB secrets include `proxyhost`/`proxyport`/`proxydbname` alongside credentials,
  preserving cluster `host`/`port`/`dbname`. Missing required secret settings
  must surface errors instead of falling back to env in Lambda.
- `pkFavorite`, `isStellantisBrand` and `synch-status` use Aurora PostgreSQL via RDS Proxy
  (`db.js` / `shared/dbClient.js`) instead of external REST/SOAP calls. `synch-status`
  delegates all security (including token validation) to the IBM APIC gateway and uses a
  pre-existing IAM role (`stla-rol-<np->bsn0027990-<env>-synch-status`) rather than SAM-managed policies.
- README.md (Italian) is the source of truth for module-by-module details
  (actions table, event shape, env vars, test/coverage summary per module);
  README.en.md is the English translation. Update both if you change a
  module's public behavior, actions, or env vars.
- Comments in the codebase are written in Italian; match this style when
  editing existing files.
