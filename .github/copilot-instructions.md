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

A few Lambdas require source from **sibling module folders via relative paths**
(not npm packages), because they reuse logic instead of duplicating it:
- `pkManager/PkManager.js` → requires `../pkEper`, `../pkDocsoa`,
  `../pkMenupricing`, `../dms` (multi-webservice package orchestrator), and
  `../dbManager` (lazily, inside `getPkList`, to resolve `pkwstouse` from
  `HQ_PKCONFIG` given `codbrand` + `market`/`codmarket`, via
  `dbManager.getPkwstouse(pool, { codmarket, codbrand })`).
- `session/src/repositories/myPeopleDmsSessionRepository.js` → requires
  `../../../myPeople`, `../../../dms`.
- `pkFavorite/index.js` → lazily (in-function, not top-level) requires
  `../dms/authService` and `../dms/dmsService` to enrich favorites with DML
  package data.

Because SAM's default per-function build only packages the function's own
folder, these three Lambdas (`PkManagerFunction`, `SessionFunction`,
`PkFavoriteFunction`) use `Metadata: BuildMethod: makefile` in `template.yaml`,
and the corresponding `build-<Function>` targets in `Makefile` manually copy
the sibling folders (minus `__tests__`, `coverage`, `.env*`) into
`$(ARTIFACTS_DIR)` so `require('../dms/...')` resolves correctly at runtime.
**If you add a new cross-folder `require` in any Lambda, you must add/update
a matching `build-<Function>` target in `Makefile` and set
`BuildMethod: makefile` for that function in `template.yaml`.**
Each sibling module referenced this way must already have run
`npm ci --omit=dev` before `sam build` invokes the makefile target.

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
- SAM build: `sam build` (uses `template.yaml`); modules with cross-folder
  requires use `Makefile` targets as described above — do not assume plain
  `sam build` packages sibling folders.

## Conventions

- Each module reads config/secrets from its own `.env` file (see
  `.env.example` per module); env vars are namespaced per module/integration
  (e.g. `DMS_PING_CLIENT_ID`, `JOBCARD_PING_CLIENT_ID`, `DGT_CLIENT_ID`).
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
