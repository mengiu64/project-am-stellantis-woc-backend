'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

function parametersForDeployment(internalStack, backendStack, environment, apiId, stageName) {
  const parameters = new Map(internalStack.Parameters.map(({ ParameterKey, ParameterValue }) =>
    [ParameterKey, ParameterValue]));
  for (const [key, expected] of Object.entries({
    Environment: environment, RestApiId: apiId, StageName: stageName,
  })) {
    if (!expected || parameters.get(key) !== expected) {
      throw new Error(`Internal REST stack parameter ${key} does not match the deployment environment`);
    }
  }
  const outputs = new Map(backendStack.Outputs.map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
  for (const key of parameters.keys()) {
    if (!key.endsWith('RoleName')) continue;
    const role = outputs.get(`Internal${key}`);
    if (!role) throw new Error(`Missing backend output Internal${key}`);
    parameters.set(key, role);
  }
  return [...parameters].map(([key, value]) => `${key}=${value}`);
}

function aws(args, json = true) {
  const result = spawnSync('aws', [...args, '--region', 'eu-west-1', '--no-cli-pager',
    ...(json ? ['--output', 'json'] : [])], { encoding: 'utf8', stdio: json ? 'pipe' : 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`AWS ${args.slice(0, 2).join(' ')} failed: ${result.stderr || result.status}`);
  return json ? JSON.parse(result.stdout) : undefined;
}

function deploy(environment, apiId, stageName, runAws = aws) {
  if (!['dev', 'stage', 'prod'].includes(environment)) throw new Error('Expected dev, stage or prod');
  const stackName = `stla-woc-internal-api-${environment}`;
  const internal = runAws(['cloudformation', 'describe-stacks', '--stack-name', stackName]).Stacks[0];
  const backend = runAws(['cloudformation', 'describe-stacks', '--stack-name',
    `stla-woc-backend-${environment}`]).Stacks[0];
  const parameters = parametersForDeployment(internal, backend, environment, apiId, stageName);
  runAws(['cloudformation', 'deploy', '--stack-name', stackName,
    '--template-file', path.join(__dirname, 'internal-api.yaml'),
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-fail-on-empty-changeset',
    '--parameter-overrides', ...parameters], false);
}

if (require.main === module) {
  try {
    deploy(process.argv[2], process.env.WOC_INTERNAL_API_ID, process.env.WOC_INTERNAL_API_STAGE || 'wia');
  } catch (error) {
    console.error(`[internal-api deploy] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { parametersForDeployment, deploy };
