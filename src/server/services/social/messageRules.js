const { CHAT_BODY_MAX } = require("../../../shared/social/textRules.js");

function sanitizeBody(body) {
  return String(body || "")
    .trim()
    .slice(0, CHAT_BODY_MAX);
}

function normalizeReaction(reaction) {
  return String(reaction || "")
    .trim()
    .slice(0, 16);
}

function shouldStoreReaction(current, requested) {
  return Boolean(requested) && requested !== String(current || "");
}

module.exports = { sanitizeBody, normalizeReaction, shouldStoreReaction };
