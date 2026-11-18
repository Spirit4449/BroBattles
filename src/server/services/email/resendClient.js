const { getConfig } = require("../../config");
const config = require("../../../shared/site/siteConfig.json");
function resendRequest(path, options) {
  return fetch("https://api.resend.com" + path, options);
}
function apiKey() {
  return getConfig().email.apiKey;
}
async function sendEmail(to, content, idempotencyKey) {
  if (!apiKey()) throw new Error("Email is not configured");
  const response = await resendRequest("/emails", {
    method: "POST",
    signal: AbortSignal.timeout(15000),
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      "Content-Type": "application/json",
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: JSON.stringify({
      from: getConfig().email.from,
      to: [to],
      reply_to: config.supportEmail,
      ...content,
      headers: { ...(content.headers || {}) },
    }),
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
}
module.exports = { sendEmail, resendRequest };
