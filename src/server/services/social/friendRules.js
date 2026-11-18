const crypto = require("crypto");

const { resolveCharacterKey } = require("../../../shared/characters/characterStats.js");
const { PRIVACY_FIELDS } = require("../../../shared/social/privacy.cjs");

const MAX_FRIENDS = 200;
const MAX_HISTORY_LIMIT = 100;
const SUGGESTION_WINDOW_DAYS = 14;
const SUGGESTION_MIN_GAMES = 2;
const SUGGESTION_LIMIT = 10;
// Friends played with in this window get "now online" lobby hints.
const TEAMMATE_WINDOW_DAYS = 30;
// Repeat-request protection, per sender -> recipient pair.
const DECLINE_COOLDOWN_MINUTES = 10;
const MAX_DECLINES = 3;
const DECLINE_WINDOW_DAYS = 30;
const MAX_REQUESTS_PER_DAY = 5;
// No 0/O/1/I so codes are easy to read aloud and type.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const FRIEND_CODE_PATTERN = /^[A-Z2-9]{4}-?[A-Z2-9]{4}$/i;
// Joined as `p` wherever another player's privacy decides what we send.
const PRIVACY_COLUMNS = PRIVACY_FIELDS.map((field) => `p.${field.column}`).join(", ");
// Settings that change what friends see in their list.
const FRIEND_VISIBLE_PRIVACY = new Set(["messages", "partyInvites", "lastSeen"]);

function formatWait(ms) {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

function isGuestRow(row) {
  return row?.expires_at !== null && row?.expires_at !== undefined;
}

function randomFriendCode() {
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return `${out.slice(0, 4)}-${out.slice(4)}`;
}

function normalizeFriendCode(value) {
  const raw = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
  if (!FRIEND_CODE_PATTERN.test(raw)) return null;
  const compact = raw.replace("-", "");
  return `${compact.slice(0, 4)}-${compact.slice(4)}`;
}

function toPublicUser(row, status = "offline") {
  return {
    userId: Number(row.user_id),
    name: String(row.name || ""),
    charClass: resolveCharacterKey(row.char_class),
    profileIconId: row.selected_profile_icon_id ? String(row.selected_profile_icon_id) : null,
    trophies: Number(row.trophies) || 0,
    status,
  };
}

module.exports = {
  DECLINE_COOLDOWN_MINUTES,
  DECLINE_WINDOW_DAYS,
  FRIEND_VISIBLE_PRIVACY,
  MAX_DECLINES,
  MAX_FRIENDS,
  MAX_HISTORY_LIMIT,
  MAX_REQUESTS_PER_DAY,
  PRIVACY_COLUMNS,
  SUGGESTION_LIMIT,
  SUGGESTION_MIN_GAMES,
  SUGGESTION_WINDOW_DAYS,
  TEAMMATE_WINDOW_DAYS,
  formatWait,
  isGuestRow,
  normalizeFriendCode,
  randomFriendCode,
  toPublicUser,
};
