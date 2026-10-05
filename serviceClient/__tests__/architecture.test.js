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
