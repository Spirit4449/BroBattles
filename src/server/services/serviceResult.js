// Service results the route layer turns into an HTTP error response.
function failure(statusCode, payload) {
  return { ok: false, statusCode, payload };
}

module.exports = { failure };
