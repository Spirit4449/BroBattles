// The production build creates these sidecars; the server prefers Brotli.
const { deepFreeze } = require('../deepFreeze');
const BUNDLE_ENCODINGS = deepFreeze({ br: '.br', gzip: '.gz' });
const BUNDLE_HASH_LENGTH = 16;
const hashedName = new RegExp(`^([^/\\\\]+)\\.[a-f0-9]{${BUNDLE_HASH_LENGTH}}\\.(js|css)$`);

function parseVersionedBundle(name) {
  const match = hashedName.exec(name);
  return match ? { base: match[1], extension: match[2] } : null;
}

module.exports = { BUNDLE_ENCODINGS, BUNDLE_HASH_LENGTH, parseVersionedBundle };
