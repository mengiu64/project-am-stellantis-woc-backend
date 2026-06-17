const { getProfileByUsername } = require('./auth.js');
const { logger } = require('./logger.js');
const { getSecret } = require('./secrets.js');

const profiles = process.env.PROFILES.split(',');

exports.handler = async (event) => {
  const secret = await getSecret(
    process.env.MYPEOPLE
  );

  const username = event.request.userAttributes.name;
  const email = event.request.userAttributes.email;
  const firstName = event.request.userAttributes['custom:firstname'];
  const lastName = event.request.userAttributes['custom:lastname'];
  const country = event.request.userAttributes['custom:country'];
  const groups = event.request.userAttributes['custom:groups'];
  logger.info(`Generating token for user with username: ${username}`);

  const user = await getProfileByUsername(secret.domain, secret.pfx, secret.passphrase, secret.identifier, username);
  const nttApplication = getValidApplication(user);
  if (nttApplication) {
    const markets = nttApplication.HQATTRIBUTES.MARKETS;
    const role = getEnforcedRole(nttApplication.PROFILE);
    const claims = {};
    claims['ntt_context'] = {
      username,
      email,
      firstName,
      lastName,
      country,
      groups,
      role,
      markets
    };
    event.response = {
      claimsAndScopeOverrideDetails: {
        idTokenGeneration: {
          claimsToAddOrOverride: claims
        },
        accessTokenGeneration: {
          claimsToAddOrOverride: claims
        }
      }
    };
    logger.info(`User '${username}' is authorized`);
  } else {
    logger.info(`User '${username}' is not authorized`);
  }

  return event;
};

function getEnforcedRole(mainRole) {
  const enforcedRole = process.env.ENFORCE_ROLE;
  if (enforcedRole && profiles.includes(enforcedRole)) {
    return enforcedRole;
  }
  return mainRole;
}

function getValidApplication(user) {
  return user?.Applications?.find(app =>
    app.APPLICATION === process.env.APPLICATION &&
    profiles.includes(app.PROFILE)
  );
}
