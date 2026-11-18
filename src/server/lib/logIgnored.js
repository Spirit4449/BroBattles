// Best-effort operations should report failures without flooding a busy server.
const lastWarning = new Map();
const WARNING_INTERVAL_MS = 30_000;

function logIgnored(scope, error) {
  const now = Date.now();
  const previous = lastWarning.get(scope);
  if (previous !== undefined && now - previous < WARNING_INTERVAL_MS) return;
  lastWarning.set(scope, now);
  console.warn(`[${scope}]`, error?.code || error?.message || String(error));
}

module.exports = { logIgnored };
