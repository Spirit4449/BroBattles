const { randomInt } = require("node:crypto");
const { VERIFICATION_CODE_LENGTH } = require("../../../shared/social/verificationCode");

const VERIFICATION_CODE_TTL_MINUTES = 10;
const VERIFICATION_CODE_MAX_ATTEMPTS = 5;

function generateVerificationCode() {
  return String(randomInt(10 ** (VERIFICATION_CODE_LENGTH - 1), 10 ** VERIFICATION_CODE_LENGTH));
}

module.exports = { VERIFICATION_CODE_TTL_MINUTES, VERIFICATION_CODE_MAX_ATTEMPTS, generateVerificationCode };
