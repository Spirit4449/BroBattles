const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { capacityFromMode, capacityFromSelection } = require("./partyRules");

function randomString(length, numbersOnly = false) {
  const letters = numbersOnly
    ? "0123456789"
    : "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from(
    { length },
    () => letters[Math.floor(Math.random() * letters.length)],
  ).join("");
}

function resolveCookieSecret(rootDir, envSecret) {
  const fromEnv = envSecret;
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv);
  const secretPath = path.join(rootDir, ".cookie-secret");
  try {
    if (fs.existsSync(secretPath)) {
      const s = fs.readFileSync(secretPath, "utf8").trim();
      if (s) return s;
    }
  } catch (_) {}
  const newSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.writeFileSync(secretPath, newSecret, { encoding: "utf8" });
  } catch (_) {}
  return newSecret;
}

module.exports = {
  capacityFromMode,
  capacityFromSelection,
  randomString,
  resolveCookieSecret,
};
