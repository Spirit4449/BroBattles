// Bounded sliding windows. Unknown identities fail closed when capacity is reached.
function createRequestWindow({ maxKeys = 10000, maxEvents = 1024 } = {}) {
  const buckets = new Map();
  let nextSweep = 0;
  function count(key, windowMs, now = Date.now(), mark = true) {
    if (now >= nextSweep || buckets.size >= maxKeys) {
      for (const [id, bucket] of buckets) if (bucket.expires <= now) buckets.delete(id);
      nextSweep = now + 10000;
    }
    let bucket = buckets.get(key);
    if (!bucket) {
      if (!mark) return 0;
      if (buckets.size >= maxKeys) return Infinity;
      bucket = { events: [], expires: now + windowMs };
      buckets.set(key, bucket);
    }
    while (bucket.events.length && bucket.events[0] <= now - windowMs) bucket.events.shift();
    if (mark) {
      if (bucket.events.length >= maxEvents) return Infinity;
      bucket.events.push(now);
      bucket.expires = now + windowMs;
    }
    return bucket.events.length;
  }
  return { count, get size() { return buckets.size; } };
}
module.exports = { createRequestWindow };
