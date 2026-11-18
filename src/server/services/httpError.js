class ServiceError extends Error {
  constructor(status, message, { code, details } = {}) {
    super(message);
    this.name = "ServiceError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  get statusCode() {
    return this.status;
  }
}

function httpError(status, message, extra) {
  return new ServiceError(status, message, extra);
}

module.exports = { ServiceError, httpError };
