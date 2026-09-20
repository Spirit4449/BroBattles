// Only content-addressed build outputs are safe to cache across deployments.
function setStaticCacheHeaders(res, filePath) {
  if (/[\\/]bundles[\\/][^\\/]+\.[a-f0-9]{16}\.(?:js|css)$/.test(filePath)) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=0');
  }
}

module.exports = { setStaticCacheHeaders };
