const { makeHttpsRequest } = require('./https-request');
const { logger } = require('./logger');

async function getProfileByUsername(domain, pfx, passphrase, identifier, username) {
  try {

    const pfxBuffer = Buffer.from(pfx, 'base64');
    const url = `${domain}/URSma.svc/readUserProfiles/` +
      `?identifier=${identifier}&username=${encodeURIComponent(username)}`;
    logger.info(`Getting profile information from url '${url}'`);
    const response = await makeHttpsRequest(url, pfxBuffer, passphrase);
    return response.Response.User || null;
  } catch (error) {
    logger.error('Error while calling get profile: ', error);
  }
  return null;
}

module.exports = { getProfileByUsername };