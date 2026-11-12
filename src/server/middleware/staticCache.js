const crypto = require('crypto');
const fs = require('fs');

const IMMUTABLE = 'public, max-age=31536000, immutable';
// Unversioned art is reused for ten minutes without revalidating. Lobby
// warming fills the HTTP cache shortly before a match, so Phaser's requests for
// those files no longer each wait on a 304 round trip. Replaced art can show for
// up to ten minutes after a deploy.
const SHORT_LIVED = 'public, max-age=600';
const contentHashes = new Map();

// Hex prefix of the file's SHA-256, the same value catalogs put in `?v=`.
function contentVersion(filePath, stat) {
  const metadata = stat || fs.statSync(filePath);
  const key = `${metadata.size}:${metadata.mtimeMs}:${metadata.ctimeMs}`;
  if (contentHashes.get(filePath)?.key !== key) {
    contentHashes.set(filePath, { key, hash: crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex') });
  }
  return contentHashes.get(filePath).hash;
}

// A `?v=` asset URL is immutable only while the version still names these
// exact bytes; a stale or guessed version keeps revalidating.
function versionMatches(res, filePath, stat) {
  if (!/[\\/]assets[\\/]player-cards[\\/][a-z0-9-]+[\\/][a-z0-9-]+-animated\.(webm|mov)$/.test(filePath)) return false;
  let version;
  try { version = new URL(res.req?.originalUrl || res.req?.url || '', 'http://local').searchParams.get('v'); } catch (_) { return false; }
  if (!/^[a-f0-9]{12,64}$/.test(version || '')) return false;
  try { return contentVersion(filePath, stat).startsWith(version); } catch (_) { return false; }
}

// Only content-addressed build outputs are safe to cache across deployments.
function setStaticCacheHeaders(res, filePath, stat) {
  if (/[\\/]bundles[\\/][^\\/]+\.[a-f0-9]{16}\.(?:js|css)$/.test(filePath)
    || /[\\/]assets[\\/]map-revisions[\\/][a-f0-9]{64}\.(?:webp|png|jpg|jpeg|json)$/.test(filePath)
    || versionMatches(res, filePath, stat)) {
    res.setHeader('Cache-Control', IMMUTABLE);
  } else if (/[\\/]assets[\\/]/.test(filePath)
    && !/[\\/]assets[\\/]map-revisions[\\/]/.test(filePath)
    && !/-animated\.(?:webm|mov)$/.test(filePath)) {
    // Map revisions and card videos keep their own content-version rules.
    res.setHeader('Cache-Control', SHORT_LIVED);
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0');
  }
}

module.exports = { setStaticCacheHeaders, contentVersion };
