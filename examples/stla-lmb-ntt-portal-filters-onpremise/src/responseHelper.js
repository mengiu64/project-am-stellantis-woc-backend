function addHeaders() {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': '*'
  };
}

const successResponse = (data) => ({
  statusCode: 200,
  headers: addHeaders(),
  body: JSON.stringify(data)
});

const errorResponse = (error) => ({
  statusCode: error.statusCode,
  headers: addHeaders(),
  body: JSON.stringify(error)
});

const ERROR_CODE = Object.freeze({
  BAD_REQUEST: 'BAD_REQUEST',
  RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
  INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  CLIENT_ERROR: 'CLIENT_ERROR'
});

class NTTError extends Error {
  constructor(error, statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.message = message;
    this.error = error;
  }

  toJSON() {
    return {
      statusCode: this.statusCode,
      error: this.error,
      message: this.message
    };
  }
}

class NTTBadRequestError extends NTTError {
  constructor(message) {
    super(ERROR_CODE.BAD_REQUEST, 400, message);
  }
}

class NTTUnauthorizedError extends NTTError {
  constructor(message) {
    super(ERROR_CODE.UNAUTHORIZED, 401, message);
  }
}

class NTTForbiddenError extends NTTError {
  constructor(message) {
    super(ERROR_CODE.FORBIDDEN, 403, message);
  }
}

class NTTInternalServerError extends NTTError {
  constructor(message) {
    super(ERROR_CODE.INTERNAL_SERVER_ERROR, 500, message);
  }
}

module.exports = {
  successResponse,
  errorResponse,
  ERROR_CODE,
  NTTError,
  NTTBadRequestError,
  NTTUnauthorizedError,
  NTTForbiddenError,
  NTTInternalServerError
};
