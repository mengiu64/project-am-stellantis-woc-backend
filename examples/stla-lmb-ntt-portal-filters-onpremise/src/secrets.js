const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
const { logger } = require('./logger.js');
const { NTTInternalServerError } = require('./responseHelper.js');

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION });
const ssmClient = new SSMClient({ region: process.env.AWS_REGION });

let credentials;
let apicUrl;

const parseSecret = (secretString) => {
  try {
    return JSON.parse(secretString);
  } catch {
    return secretString;
  }
};

async function getSecretConfig(secretName) {
  try {
    if (credentials) {
      return credentials;
    }

    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsClient.send(command);

    if (!response.SecretString) {
      logger.error('Secret for credentials not found');
      throw new NTTInternalServerError('Internal Server Error');
    }
    credentials = parseSecret(response.SecretString);
    logger.info('Retrieved secret for credentials');
    return credentials;
  } catch (error) {
    if (error instanceof NTTInternalServerError) {
      throw error;
    }
    logger.error(`Error while getting secrets: ${error.stack}`);
    throw new NTTInternalServerError('Internal Server Error');
  }
}

async function getURLParameter(parameterName) {
  if (apicUrl) {
    logger.info('Apic URL parameter retrieved from cache..');
    return apicUrl;
  }

  try {
    const command = new GetParameterCommand({ Name: parameterName });
    const response = await ssmClient.send(command);

    if (!response.Parameter?.Value) {
      logger.error('APIC URL parameter not found');
      throw new NTTInternalServerError('Internal Server Error');
    }

    apicUrl = response.Parameter.Value;
    logger.info('Retrieved APIC URL parameter');
    return apicUrl;
  } catch (error) {
    if (error instanceof NTTInternalServerError) {
      throw error;
    }
    logger.error(`Error while getting parameter: ${error.stack}`);
    throw new NTTInternalServerError('Internal Server Error');
  }
}

module.exports = { getSecretConfig, getURLParameter };
