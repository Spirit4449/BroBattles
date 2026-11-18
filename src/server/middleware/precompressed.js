const { BUNDLE_ENCODINGS, parseVersionedBundle } = require('../../shared/net/bundleVersion');
const { IMMUTABLE } = require('./staticCache');
const fs = require('fs');
const path = require('path');

// Content-addressed bundles get Brotli and gzip copies at build time
// (scripts/build/versionHtmlAssets.cjs). Serving those skips compressing
// megabytes of JavaScript on the Pi for every page load.
const TYPES = { js: 'application/javascript; charset=UTF-8', css: 'text/css; charset=UTF-8' };
const ENCODINGS = Object.entries(BUNDLE_ENCODINGS);

function servePrecompressed(distDir) {
  return (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (!req.path.startsWith('/bundles/')) return next();
    const match = parseVersionedBundle(req.path.slice('/bundles/'.length));
    if (!match) return next();
    // Prefer Brotli whenever it is accepted, regardless of header order.
    const [encoding, suffix] = ENCODINGS.find(([name]) => req.acceptsEncodings(name) === name) || [];
    if (!suffix) return next();
    const file = path.join(distDir, req.path + suffix);
    fs.stat(file, (error, stat) => {
      if (error || !stat.isFile()) return next();
      res.setHeader('Content-Type', TYPES[match.extension]);
      res.setHeader('Content-Encoding', encoding);
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', IMMUTABLE);
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).on('error', next).pipe(res);
    });
  };
}

module.exports = { servePrecompressed };
