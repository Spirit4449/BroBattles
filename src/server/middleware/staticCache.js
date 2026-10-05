// Only content-addressed build outputs are safe to cache across deployments.
function setStaticCacheHeaders(res, filePath) {
  if (/[\\/]bundles[\\/][^\\/]+\.[a-f0-9]{16}\.(?:js|css)$/.test(filePath)
    || /[\\/]assets[\\/]map-revisions[\\/][a-f0-9]{64}\.(?:webp|png|jpg|jpeg|json)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0');
  }
}

module.exports = { setStaticCacheHeaders };
