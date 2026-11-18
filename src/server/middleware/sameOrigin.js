const { getConfig } = require("../config");

function isSameOrigin(req) {
  try {
    const site = req.get("sec-fetch-site");
    if (site === "cross-site") return false;
    // Fetch Metadata is browser-controlled and remains accurate behind TLS proxies.
    if (site === "same-origin") return true;
    const origin = req.get("origin");
    if (!origin || origin === "null") return false;
    const supplied = new URL(origin);
    const direct = new URL(`${req.protocol}://${req.get("host")}`);
    if (supplied.origin === direct.origin) return true;
    return (
      !!getConfig().publicBaseUrl && supplied.origin === new URL(getConfig().publicBaseUrl).origin
    );
  } catch (_) {
    return false;
  }
}

module.exports = { isSameOrigin };
