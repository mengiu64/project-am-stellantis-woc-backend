'use strict';

jest.mock('child_process', () => ({ spawnSync: jest.fn() }));

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  roleParameters, parseOutputs, checkTarget, parameterOverrides, sam, deploy,
} = require('../../infrastructure/deploy-internal-api');

const template = fs.readFileSync(path.join(__dirname, '../../infrastructure/internal-api.yaml'), 'utf8');
const internalOutputs = JSON.stringify([{
  OutputKey: 'InternalApiBaseUrl',
  OutputValue: 'https://private-api.execute-api.eu-west-1.amazonaws.com/wia',
}]);
const roles = roleParameters(template);
const backendOutputs = JSON.stringify(roles.map((key) => ({ OutputKey: `Internal${key}`, OutputValue: `current-${key}` })));

afterEach(() => jest.resetAllMocks());

test('only execution-role parameters are overridden; API, root and stage keep their previous values', () => {
  expect(roles).toHaveLength(9);
  expect(roles).toContain('HqManagerRoleName');
  expect(roles).not.toEqual(expect.arrayContaining(['Environment', 'RestApiId', 'RootResourceId', 'StageName']));
  expect(parameterOverrides(template, parseOutputs(backendOutputs)))
    .toEqual(roles.map((key) => `${key}=current-${key}`));
});

test('missing role outputs fail explicitly instead of retaining a stale role', () => {
  expect(() => parameterOverrides(template, new Map()))
    .toThrow('Missing backend output InternalPkManagerRoleName');
});

test('stack outputs are parsed from SAM JSON, ignoring surrounding notices', () => {
  expect(parseOutputs(`SAM CLI update available\n${internalOutputs}\n`).get('InternalApiBaseUrl'))
    .toBe('https://private-api.execute-api.eu-west-1.amazonaws.com/wia');
  expect(() => parseOutputs('Error: stack does not exist')).toThrow('Unexpected sam list stack-outputs response');
});

test.each([
  ['other-api', 'wia'], ['private-api', 'other-stage'], ['', 'wia'],
])('rejects a stack bound to a different API/stage (%s, %s)', (apiId, stageName) => {
  expect(() => checkTarget(parseOutputs(internalOutputs), apiId, stageName)).toThrow('does not target');
});

test('a stack without the base URL output is rejected', () => {
  expect(() => checkTarget(new Map(), 'private-api', 'wia')).toThrow('does not target');
});

test('updates only the existing internal stack, keeping its tags and without publishing the shared gateway stage', () => {
  const runSam = jest.fn()
    .mockReturnValueOnce(internalOutputs)
    .mockReturnValueOnce(backendOutputs);
  deploy('dev', 's3-np-bsn0027990-dev-ops', 'private-api', 'wia', runSam);
  expect(runSam.mock.calls).toEqual([
    [['list', 'stack-outputs', '--stack-name', 'stla-woc-internal-api-dev', '--output', 'json'], true],
    [['list', 'stack-outputs', '--stack-name', 'stla-woc-backend-dev', '--output', 'json'], true],
    [[
      'deploy', '--template-file', expect.stringContaining(path.join('infrastructure', 'internal-api.yaml')),
      '--stack-name', 'stla-woc-internal-api-dev',
      '--s3-bucket', 's3-np-bsn0027990-dev-ops', '--s3-prefix', 'stla-woc-internal-api',
      '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-confirm-changeset', '--no-fail-on-empty-changeset',
      '--tags', 'Env=dev', 'Project=bsn0027990',
      '--parameter-overrides', ...roles.map((key) => `${key}=current-${key}`),
    ], false],
  ]);
});

test('target mismatch blocks deployment before reading backend roles', () => {
  const runSam = jest.fn().mockReturnValueOnce(internalOutputs);
  expect(() => deploy('stage', 's3-np-bsn0027990-stage-ops', 'other-api', 'wia', runSam)).toThrow('does not target');
  expect(runSam).toHaveBeenCalledTimes(1);
});

test('invalid arguments and SAM failures block deployment', () => {
  const runSam = jest.fn(() => { throw new Error('AccessDenied'); });
  expect(() => deploy('dev', 's3-np-bsn0027990-dev-ops', 'private-api', 'wia', runSam)).toThrow('AccessDenied');
  expect(() => deploy('unknown', 's3-np-bsn0027990-dev-ops', 'private-api', 'wia', runSam)).toThrow('Expected dev, stage or prod');
  expect(() => deploy('prod', '', 'private-api', 'wia', runSam)).toThrow('Expected the SAM artifacts S3 bucket');
  expect(runSam).toHaveBeenCalledTimes(1);
});

test('SAM runs in eu-west-1 without telemetry and reports failures', () => {
  const spawn = spawnSync
    .mockReturnValueOnce({ status: 0, stdout: '[]' })
    .mockReturnValueOnce({ status: 0, stdout: null })
    .mockReturnValueOnce({ status: 1 })
    .mockReturnValueOnce({ error: new Error('spawnSync sam ENOENT') });
  expect(sam(['list', 'stack-outputs'], true)).toBe('[]');
  expect(spawn).toHaveBeenLastCalledWith('sam', ['list', 'stack-outputs', '--region', 'eu-west-1'], expect.objectContaining({
    stdio: ['ignore', 'pipe', 'inherit'], env: expect.objectContaining({ SAM_CLI_TELEMETRY: '0' }),
  }));
  sam(['deploy'], false);
  expect(spawn).toHaveBeenLastCalledWith('sam', ['deploy', '--region', 'eu-west-1'], expect.objectContaining({ stdio: 'inherit' }));
  expect(() => sam(['deploy'], false)).toThrow('sam deploy failed with exit code 1');
  expect(() => sam(['deploy'], false)).toThrow('ENOENT');
});
