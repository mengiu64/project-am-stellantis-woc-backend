const {
  SecretsManagerClient,
  GetSecretValueCommand
} = require('@aws-sdk/client-secrets-manager');
const { logger } = require('./logger.js');

const secretsCache = {};

const getSecretsManagerClient = () =>
  new SecretsManagerClient({ region: process.env.AWS_REGION });

const parseSecret = (secretString) => {
  try {
    return JSON.parse(secretString);
  } catch {
    logger.error(`Received secret with secret name ${secretString} is not in JSON format`);
    throw Error('Secret is not in JSON format');
  }
};

async function getSecret(secretName) {
  const client = getSecretsManagerClient();

  try {
    if (secretsCache[secretName]) {
      logger.info('Returning secret from cache..');
      return secretsCache[secretName];
    }

    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await client.send(command);

    if (!response.SecretString) {
      logger.error(`Secret with name ${secretName} not found`);
      throw new Error('Secret not found');
    }

    const parsed = parseSecret(response.SecretString);
    secretsCache[secretName] = parsed;
    logger.info(`Retrieved secret: ${secretName}`);
    return secretsCache[secretName];
  } catch (error) {
    logger.error(`Error while getting secret with name '${secretName}': ${error.stack}`);
    throw error;
  }
}

module.exports = { getSecret };
