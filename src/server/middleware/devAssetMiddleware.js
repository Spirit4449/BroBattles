// webpack-dev-middleware 7 can call next() after serving an asset, including
// after ending a 304/HEAD response or when its file stream becomes ready.
// Express static/page handlers must only receive requests webpack did not own.
function isolateDevAssetResponse(middleware) {
  return (req, res, next) => {
    let streaming = false;
    const onPipe = () => { streaming = true; };
    res.once('pipe', onPipe);
    return middleware(req, res, error => {
      res.off('pipe', onPipe);
      if (error) return next(error);
      if (streaming || res.headersSent || res.writableEnded) return;
      return next();
    });
  };
}
module.exports = { isolateDevAssetResponse };
