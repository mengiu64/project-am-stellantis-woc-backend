'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const REGION = 'eu-west-1';
const TEMPLATE = path.join(__dirname, 'internal-api.yaml');

// Solo i nomi dei ruoli vengono passati: SAM conserva gli altri parametri dello
// stack esistente (UsePreviousValue), quindi API/root/stage non possono cambiare.
function roleParameters(template) {
  return [...template.matchAll(/^ {2}(\w+RoleName):/gm)].map((match) => match[1]);
}

function parseOutputs(stdout) {
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error('Unexpected sam list stack-outputs response');
  return new Map(JSON.parse(stdout.slice(start, end + 1))
    .map(({ OutputKey, OutputValue }) => [OutputKey, OutputValue]));
}

function checkTarget(outputs, apiId, stageName) {
  const url = new URL(outputs.get('InternalApiBaseUrl') || 'invalid:');
  if (!apiId || url.hostname !== `${apiId}.execute-api.${REGION}.amazonaws.com`
      || url.pathname !== `/${stageName}`) {
    throw new Error('Internal REST stack does not target the configured API/stage');
  }
}

function parameterOverrides(template, backendOutputs) {
  return roleParameters(template).map((key) => {
    const role = backendOutputs.get(`Internal${key}`);
    if (!role) throw new Error(`Missing backend output Internal${key}`);
    return `${key}=${role}`;
  });
}

function sam(args, capture) {
  const result = spawnSync('sam', [...args, '--region', REGION], {
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit',
    env: { ...process.env, SAM_CLI_TELEMETRY: '0' },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`sam ${args.slice(0, 2).join(' ')} failed with exit code ${result.status}`);
  return result.stdout;
}

function deploy(environment, bucket, apiId, stageName, runSam = sam) {
  if (!['dev', 'stage', 'prod'].includes(environment)) throw new Error('Expected dev, stage or prod');
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket || '')) throw new Error('Expected the SAM artifacts S3 bucket');
  const stackName = `stla-woc-internal-api-${environment}`;
  const outputs = (stack) => parseOutputs(runSam(['list', 'stack-outputs', '--stack-name', stack, '--output', 'json'], true));
  checkTarget(outputs(stackName), apiId, stageName);
  const overrides = parameterOverrides(fs.readFileSync(TEMPLATE, 'utf8'), outputs(`stla-woc-backend-${environment}`));
  runSam(['deploy', '--template-file', TEMPLATE, '--stack-name', stackName,
    '--s3-bucket', bucket, '--s3-prefix', 'stla-woc-internal-api',
    '--capabilities', 'CAPABILITY_NAMED_IAM', '--no-confirm-changeset', '--no-fail-on-empty-changeset',
    // Senza --tags SAM invia Tags vuoti e CloudFormation rimuoverebbe i tag dello stack.
    '--tags', `Env=${environment}`, 'Project=bsn0027990',
    '--parameter-overrides', ...overrides], false);
}

if (require.main === module) {
  try {
    deploy(process.argv[2], process.argv[3], process.env.WOC_INTERNAL_API_ID, process.env.WOC_INTERNAL_API_STAGE || 'wia');
  } catch (error) {
    console.error(`[internal-api deploy] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { roleParameters, parseOutputs, checkTarget, parameterOverrides, sam, deploy };
