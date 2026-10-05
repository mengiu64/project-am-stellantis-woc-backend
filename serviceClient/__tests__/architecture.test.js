'use strict';

const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '../..');
const modules = [
  'agendaSoa', 'agendaSoaNaga', 'dms', 'jobcard', 'djc', 'v360', 'srpV360Ota',
  'pkEper', 'pkDocsoa', 'pkMenupricing', 'pkManager', 'translations', 'session',
  'myPeople', 'pkFavorite', 'moparDoc', 'isStellantisBrand', 'synch-status',
  'dmlConfigSync', 'dbManager', 'hqManager', 'service-Hq-Manager', 'auroraAutoStart',
];
function sourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith('.') || ['node_modules', '__tests__', 'coverage'].includes(entry.name)) return [];
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(file) : entry.name.endsWith('.js') ? [file] : [];
  });
}
test.each(modules)('%s never imports another Lambda source', (module) => {
  for (const file of sourceFiles(path.join(root, module))) {
    const source = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const match of source.matchAll(/require\((?:path\.resolve\(__dirname,\s*)?['"](\.[^'"]+)['"]/g)) {
      const target = path.resolve(path.dirname(file), match[1]);
      const owner = path.relative(root, target).split(path.sep)[0];
      expect([module, 'serviceClient', 'runtimeConfig']).toContain(owner);
    }
    expect(source).not.toMatch(/(?:LambdaClient|InvokeCommand|\.invoke\()/);
  }
});

test('packaging copies one module and shared transport, never sibling Lambda trees', () => {
  const makefile = fs.readFileSync(path.join(root, 'Makefile'), 'utf8');
  expect(makefile).toContain('tar -C "$(2)"');
  expect(makefile).toContain('tar -C serviceClient');
  expect(makefile).toContain('tar -C runtimeConfig');
  expect(makefile).not.toMatch(/cp -r|require\('\.\.\/(?:dms|session)/);
  expect(makefile).toContain("--exclude='./.env*'");
});

test('Lambda environments contain references, not integration values or DB endpoints', () => {
  const template = fs.readFileSync(path.join(root, 'template.yaml'), 'utf8');
  const forbidden = /^(?:WOC_INTERNAL_(?:API_URL|TIMEOUT_MS)|AGENDA_SOA_(?:HOST|USERNAME|PASSWORD|API_KEY)|MYPEOPLE_(?:HOST|BASE_PATH|IBM_CLIENT_ID|USERNAME|PASSWORD|IDENTIFIER)|MENUPRICING_(?:WSDL|USR|PWS|USR_REQ|PWS_REQ)|EPER_(?:HOST|CODDEALER|CODMARKET|LINGUA|TICKET)|DOCSOA_(?:HOST|USERNAME|PASSWORD|IBM_CLIENT_ID|IBM_CLIENT_SECRET|CODBRAND|LDP|LANGUE|PAYS|CODEPDV|TYPE_INTERNET)|MP_.+|DML_X_TARGET_ENV|(?:DBMANAGER|PKFAVORITE|DMLCONFIGSYNC|JOBCARD|DJC|MOPARDOC|DOCSOA)_DB_(?:HOST|PORT|NAME|USER|PASSWORD))$/;
  for (const match of template.matchAll(/^\s+([A-Z][A-Z0-9_]+):/gm)) {
    expect(match[1]).not.toMatch(forbidden);
  }
  expect(template.match(/WOC_CONFIG_SECRET_ID:/g)).toHaveLength(7);
  for (const owner of ['agendasoa', 'agendasoanaga', 'pkeper', 'pkdocsoa', 'pkmenupricing', 'mypeople', 'pkmanager']) {
    expect(template).toContain(`sm-np-bsn0027990-\${Environment}-${owner}-config`);
  }
});
test('internal gateway authorizes IAM POSTs without managing the existing stage', () => {
  const template = fs.readFileSync(path.join(root, 'infrastructure/internal-api.yaml'), 'utf8');
  const methods = template.match(/AuthorizationType: AWS_IAM/g);
  expect(methods).toHaveLength(11);
  expect(template).not.toMatch(/AWS::ApiGateway::(?:Deployment|Stage|RestApi)/);
  expect(template).not.toContain('AuthorizationType: NONE');
  expect(template).toContain('execute-api:Invoke');
  expect(template).not.toMatch(/POST\/internal\/\*/);
});

test('API Gateway invokes internal receivers through its integration role, without Lambda triggers', () => {
  const template = fs.readFileSync(path.join(root, 'infrastructure/internal-api.yaml'), 'utf8');
  expect(template).not.toContain('Type: AWS::Lambda::Permission');
  const integrations = [...template.matchAll(/^ {6}Integration:\r?\n((?: {8}.*\r?\n)+)/gm)].map((match) => match[1]);
  expect(integrations).toHaveLength(11);
  const receivers = integrations.map((integration) => {
    expect(integration).toMatch(/Credentials:\s+Fn::GetAtt:\s+- InternalIntegrationRole\s+- Arn/);
    return integration.match(/function:(lmb-np-bsn0027990-\$\{Environment\}-[a-z0-9]+)\/invocations/)[1];
  });
  const role = template.match(/^ {2}InternalIntegrationRole:\r?\n((?: {4}.*\r?\n)+)/m)[1];
  expect(role).toContain('Service: apigateway.amazonaws.com');
  // API Gateway non valorizza aws:SourceArn/aws:SourceAccount assumendo il ruolo: con queste condizioni ogni integrazione risponde 500.
  expect(role).not.toMatch(/aws:Source(Arn|Account)/);
  expect(role).toContain('policy/StlaPermissionBoundary');
  expect(role).toContain('Action: lambda:InvokeFunction');
  expect(role).not.toMatch(/function:\S*\*/);
  expect([...role.matchAll(/function:(lmb-np-bsn0027990-\$\{Environment\}-[a-z0-9]+)\r?$/gm)].map((match) => match[1]).sort())
    .toEqual([...new Set(receivers)].sort());
});

const consumerPolicies = {
  pkManager: 'PkManager', pkFavorite: 'PkFavorite', dms: 'Dms', jobcard: 'JobCard',
  djc: 'Djc', session: 'Session', hqManager: 'HqManager',
  dmlConfigSync: 'DmlConfigSync', 'synch-status': 'SynchStatus',
};

function checkRestPermissions(module, policy, template) {
  const block = template.match(new RegExp(`^  ${policy}RestPolicy:[\\s\\S]*?(?=^  \\w+:|(?![\\s\\S]))`, 'm'));
  expect(block).not.toBeNull();
  const allowed = new Set([...block[0].matchAll(/POST\/internal\/([\w-]+)\/([\w-]+)/g)]
    .map((match) => `${match[1]}/${match[2]}`));
  const operations = [];
  for (const file of sourceFiles(path.join(root, module))) {
    const relative = path.relative(root, file).split(path.sep).join('/');
    const source = fs.readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/function remoteOperation\(service, operation\)/g, '');
    for (const match of source.matchAll(/\b(?:callService|remoteOperation)\s*\(\s*([^)]*)/g)) {
      const literal = match[1].match(/^['"]([\w-]+)['"]\s*,\s*['"]([\w-]+)['"]\s*(?:,|$)/);
      if (literal) {
        operations.push(`${literal[1]}/${literal[2]}`);
      } else if (relative === 'hqManager/repository.js' && /^'dbmanager', operation,/.test(match[1])) {
        operations.push(...Object.keys(require('../../hqManager/repository')).map((name) => `dbmanager/${name}`));
      } else if (relative === 'session/src/repositories/myPeopleDmsSessionRepository.js'
        && /^service, operation,/.test(match[1])) {
        // I nomi vengono verificati sulle chiamate remoteOperation dello stesso file.
      } else {
        throw new Error(`${relative}: chiamata REST dinamica non verificabile; aggiungere un controllo esplicito`);
      }
    }
  }
  expect(operations.length).toBeGreaterThan(0);
  for (const operation of operations) {
    if (!allowed.has(operation)) throw new Error(`${module}: manca il permesso IAM per ${operation}`);
  }
}

test.each(Object.entries(consumerPolicies))('%s REST operations have explicit caller IAM permissions', (module, policy) => {
  checkRestPermissions(module, policy, fs.readFileSync(path.join(root, 'infrastructure/internal-api.yaml'), 'utf8'));
});

test('adding a new REST caller requires an architecture policy check', () => {
  for (const module of modules) {
    const hasCalls = sourceFiles(path.join(root, module)).some((file) =>
      /\bcallService\s*\(/.test(fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')));
    if (hasCalls) expect(consumerPolicies).toHaveProperty(module);
  }
});

test('missing HQ operation permissions fail before deployment', () => {
  const template = fs.readFileSync(path.join(root, 'infrastructure/internal-api.yaml'), 'utf8')
    .replace(/^.*POST\/internal\/dbmanager\/getPackageListHQ\r?\n/gm, '');
  expect(() => checkRestPermissions('hqManager', 'HqManager', template))
    .toThrow('hqManager: manca il permesso IAM per dbmanager/getPackageListHQ');
});
