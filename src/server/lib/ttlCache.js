// Share in-flight loads. A rejected or expired entry is retried on the next request.
function createTtlCache({ ttlMs, maxEntries, now = Date.now }) {
  const entries = new Map();
  return function load(key, read) {
    const t = now();
    const cached = entries.get(key);
    if (cached && t < cached.expiresAt) return cached.value;
    entries.delete(key);
    if (entries.size >= maxEntries) entries.delete(entries.keys().next().value);
    const entry = { expiresAt: t + ttlMs };
    entry.value = Promise.resolve().then(read).catch(error => {
      if (entries.get(key) === entry) entries.delete(key);
      throw error;
    });
    entries.set(key, entry);
    return entry.value;
  };
}

module.exports = { createTtlCache };
