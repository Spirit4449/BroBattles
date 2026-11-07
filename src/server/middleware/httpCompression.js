const compression = require("compression");

// Compress HTTP assets/JSON, leaving latency-sensitive Socket.IO frames alone.
// Streaming responses must flush immediately (including the dev HMR stream).
module.exports = compression({
  threshold: 1024,
  filter(req, res) {
    if (String(res.getHeader("Content-Type") || "").startsWith("text/event-stream")) return false;
    return compression.filter(req, res);
  },
});
