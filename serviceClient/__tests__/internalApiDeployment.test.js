'use strict';

const { parametersForDeployment, deploy } = require('../../infrastructure/deploy-internal-api');

function stacks() {
  return {
    internal: {
      Parameters: Object.entries({
        Environment: 'dev', RestApiId: 'private-api', StageName: 'wia',
        RootResourceId: 'existing-root', HqManagerRoleName: 'old-role',
      }).map(([ParameterKey, ParameterValue]) => ({ ParameterKey, ParameterValue })),
    },
    backend: { Outputs: [{ OutputKey: 'InternalHqManagerRoleName', OutputValue: 'current-role' }] },
  };
}

test('preserves existing API parameters and resolves current backend execution roles', () => {
  const { internal, backend } = stacks();
  expect(parametersForDeployment(internal, backend, 'dev', 'private-api', 'wia')).toEqual([
    'Environment=dev', 'RestApiId=private-api', 'StageName=wia',
    'RootResourceId=existing-root', 'HqManagerRoleName=current-role',
  ]);
});

test.each([
  ['stage', 'private-api', 'wia'], ['dev', 'other-api', 'wia'],
  ['dev', 'private-api', 'other-stage'], ['dev', '', 'wia'],
])('rejects environment/API/stage mismatch (%s, %s, %s)', (...args) => {
  const { internal, backend } = stacks();
  expect(() => parametersForDeployment(internal, backend, ...args)).toThrow('does not match');
});

test('missing role outputs fail explicitly instead of retaining a stale role', () => {
  const { internal, backend } = stacks();
  backend.Outputs = [];
  expect(() => parametersForDeployment(internal, backend, 'dev', 'private-api', 'wia'))
    .toThrow('Missing backend output InternalHqManagerRoleName');
});

test('updates only the existing internal stack, without publishing the shared gateway stage', () => {
  const { internal, backend } = stacks();
  const runAws = jest.fn()
    .mockReturnValueOnce({ Stacks: [internal] })
    .mockReturnValueOnce({ Stacks: [backend] });
  deploy('dev', 'private-api', 'wia', runAws);
  expect(runAws.mock.calls[2]).toEqual([[
    'cloudformation', 'deploy', '--stack-name', 'stla-woc-internal-api-dev',
    '--template-file', expect.stringContaining('infrastructure/internal-api.yaml'),
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
    '--parameter-overrides', 'Environment=dev', 'RestApiId=private-api', 'StageName=wia',
    'RootResourceId=existing-root', 'HqManagerRoleName=current-role',
  ], false]);
  expect(runAws).toHaveBeenCalledTimes(3);
});

test('AWS failures propagate and block deployment', () => {
  const runAws = jest.fn(() => { throw new Error('AccessDenied'); });
  expect(() => deploy('dev', 'private-api', 'wia', runAws)).toThrow('AccessDenied');
  expect(() => deploy('unknown', 'private-api', 'wia', runAws)).toThrow('Expected dev, stage or prod');
});
