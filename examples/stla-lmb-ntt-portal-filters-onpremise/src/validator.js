const { NTTBadRequestError, NTTUnauthorizedError, NTTForbiddenError } = require('./responseHelper.js');
const { logger } = require('./logger.js');
const Joi = require('joi');

const ROLES = {
  ADMINISTRATOR: 'ADMINISTRATOR',
  MARKET: 'MARKET',
  VIEWER: 'VIEWER'
};

function validateAuthorizer(authorizer) {
  if (!authorizer?.claims?.ntt_context) {
    logger.warn('Invalid authorizer');
    throw new NTTUnauthorizedError('Invalid token');
  }
  let userInfo;
  try {
    userInfo = JSON.parse(authorizer.claims.ntt_context);
  } catch (e) {
    logger.warn('Error while parsing authorizer claims: ', e);
    throw new NTTUnauthorizedError('Invalid JSON context claims');
  }

  const username = validateClaimsField(userInfo.username);
  const markets = validateClaimsField(userInfo.markets);
  const role = validateClaimsField(userInfo.role);

  return {
    username: username,
    markets: markets,
    role: role,
    marketsToInclude: role === ROLES.ADMINISTRATOR? null : markets 
  };
}

function validateClaimsField(field) {
  if (!field)  {
    logger.warn('Provided claims invalid');
    throw new NTTUnauthorizedError('Invalid claims');
  }

  return field;
}

function validateQueryParams(data, authorizer) {
  const { value, error: validationError } = validate(data);
  if (validationError) {
    const messages = validationError.details
      .map((err) => err.message)
      .join(';');
    logger.warn(`Invalid input received: ${messages}`);
    throw new NTTBadRequestError(messages);
  }

  if (authorizer.marketsToInclude && !authorizer.marketsToInclude.includes(value.codmarket)) {
    logger.warn('User doesn\'t have access to given market');
    throw new NTTForbiddenError('You don\'t have permission for the given market');
  }

  return value;
}

function validate(data) {
  const queryParametersSchema = Joi.object({
    type: Joi.string().valid('dealers', 'dealer_locations').required(),
    codmarket: Joi.string().required(),
    codbrand: Joi.string().required(),
    codactivity: Joi.string().min(2).max(2).required(),
    codnation: Joi.string().max(4).when('type', {
      is: Joi.valid('dealers'),
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    name: Joi.string().when('type', {
      is: Joi.valid('dealers'),
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    }),
    coddealer: Joi.string().when('type', {
      is: Joi.valid('dealer_locations'),
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    landtype: Joi.string().when('type', {
      is: Joi.valid('dealer_locations'),
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    }),
    comtype: Joi.string().valid('AP', 'TE').when('type', {
      is: Joi.valid('dealer_locations'),
      then: Joi.required(),
      otherwise: Joi.forbidden()
    }),
    startrecord:  Joi.number().integer().min(0).default(0).when('type', {
      is: Joi.valid('dealers'),
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    }),
    maxrecord: Joi.number().integer().min(1).default(20).when('type', {
      is: Joi.valid('dealers'),
      then: Joi.optional(),
      otherwise: Joi.forbidden()
    })
  });

  return queryParametersSchema.validate(data, { abortEarly: false });
}

module.exports = { validateQueryParams, validateAuthorizer };
