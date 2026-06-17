const { logger } = require('./logger.js');
const {
  errorResponse,
  successResponse,
  NTTError,
  NTTInternalServerError
} = require('./responseHelper.js');
const { validateQueryParams, validateAuthorizer } = require('./validator.js');
const { getFilters } = require('./service.js');

exports.handler = async (event) => {
  try {
    const authorizer = validateAuthorizer(event.requestContext.authorizer);
    const queryParams = event.queryStringParameters || {};

    const request = validateQueryParams(queryParams, authorizer);
    logger.info('Received valid request');

    const results = await getFilters(request);
    return successResponse(results);
  } catch (error) {
    if (error instanceof NTTError) {
      return errorResponse(error);
    }
    logger.error(`Unexpected error: ${error.stack}`);
    return errorResponse(new NTTInternalServerError('Internal server error'));
  }
};
