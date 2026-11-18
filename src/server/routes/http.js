const { httpError } = require("../services/httpError");

const errorOptions = Symbol("routeErrorOptions");
const NOT_AUTHENTICATED = "Not authenticated";

function sendError(res, error, {
  label = "[http]",
  fallback = "Internal server error",
  defaultStatus = 500,
  shape = "success-flag",
  messageField = "error",
  extra,
} = {}) {
  const candidate = Number(error?.status ?? error?.statusCode);
  const status = Number.isInteger(candidate) && candidate >= 400 && candidate <= 599
    ? candidate
    : defaultStatus;
  if (status >= 500) console.error(label, error);
  return res.status(status).json({
    ...(shape === "success-flag" ? { success: false } : {}),
    [messageField]: status >= 500 ? fallback : error?.message || fallback,
    ...extra?.(error),
  });
}

function routeErrorMiddleware(error, _req, res, next) {
  const options = res[errorOptions];
  if (!options || res.headersSent) return next(error);
  return sendError(res, error, options);
}

function asyncRoute(label, handler, options = {}) {
  return async (req, res, next) => {
    try {
      return await handler(req, res, next);
    } catch (error) {
      const mapped = options.mapError?.(error) ?? error;
      res[errorOptions] = { label, ...options };
      if (typeof next === "function") return next(mapped);
      return routeErrorMiddleware(mapped, req, res, (thrown) => { throw thrown; });
    }
  };
}

function authedRoute(requireCurrentUser, label, handler, options = {}) {
  return asyncRoute(label, async (req, res) => {
    const user = await requireCurrentUser(req, res);
    if (!user) {
      return sendError(res, httpError(401, options.authMessage ?? NOT_AUTHENTICATED), {
        shape: options.shape,
      });
    }
    return handler(req, res, user);
  }, options);
}

module.exports = { asyncRoute, authedRoute, sendError, routeErrorMiddleware, NOT_AUTHENTICATED };
