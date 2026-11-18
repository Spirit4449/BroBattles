const { API_PATHS } = require("../../../shared/net/apiPaths.js");

const ABUSE_DECAY_WINDOW_MS = 5 * 60 * 1000;
const ABUSE_LOG_DECISIONS = true;

const CHAT_ACTION_LIMITS = {
  message: {
    limit: 8,
    windowMs: 10000,
    minuteLimit: 20,
    minuteWindowMs: 60 * 1000,
  },
  reaction: { limit: 10, windowMs: 10000 },
};

const HTTP_BUCKETS = {
  strict: { limit: 8, windowMs: 10000, anonLimit: 4 },
  medium: { limit: 14, windowMs: 10000, anonLimit: 7 },
  lenient: { limit: 26, windowMs: 10000, anonLimit: 12 },
  // Equipping is a cheap write that players repeat while browsing their
  // collection, so it counts separately from the shared per-user allowance.
  equip: { limit: 20, windowMs: 10000, anonLimit: 15, scope: "equip" },
};

const HTTP_ROUTE_POLICIES = {
  [`GET ${API_PATHS.USERNAME_AVAILABILITY}`]: { bucket: "medium", enforceActiveSuspension: false },
  [`POST ${API_PATHS.SIGNUP}`]: { bucket: "strict" },
  [`POST ${API_PATHS.LOGIN}`]: { bucket: "strict", allowBanned: true },
  [`POST ${API_PATHS.BUY}`]: { bucket: "strict" },
  [`POST ${API_PATHS.UPGRADE}`]: { bucket: "strict", countFailuresOnly: true },
  [`POST ${API_PATHS.PROFILE_CHANGE_USERNAME}`]: { bucket: "strict" },
  [`POST ${API_PATHS.PROFILE_CHANGE_PASSWORD}`]: { bucket: "strict" },
  // Admin endpoints enforce requireAdminUser in their route handlers and stay
  // outside gameplay request counters and matchmaking suspensions.
  [`POST ${API_PATHS.API_SHOP_CLAIM_DAILY}`]: { bucket: "strict" },
  [`POST ${API_PATHS.API_SHOP_PURCHASE}`]: { bucket: "strict" },
  [`POST ${API_PATHS.API_SHOP_CHECKOUT_SESSION}`]: { bucket: "strict" },

  [`POST ${API_PATHS.CREATE_PARTY}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTYDATA}`]: { bucket: "medium" },
  [`POST ${API_PATHS.LEAVE_PARTY}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTY_KICK}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTY_MAKE_OWNER}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTY_SETTINGS_UPDATE}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTY_JOIN_REQUEST}`]: { bucket: "medium" },
  [`POST ${API_PATHS.PARTY_JOIN_REQUEST_RESPOND}`]: { bucket: "medium" },
  [`POST ${API_PATHS.SELECTION_PREFERENCES}`]: { bucket: "equip" },
  [`POST ${API_PATHS.PLAYER_CARDS_SELECT}`]: { bucket: "equip" },
  [`POST ${API_PATHS.PROFILE_ICONS_SELECT}`]: { bucket: "equip" },
  [`POST ${API_PATHS.SKINS_SELECT}`]: { bucket: "equip" },
  [`POST ${API_PATHS.TROPHIES_CLAIM}`]: { bucket: "medium" },
  [`POST ${API_PATHS.GAMEDATA}`]: { bucket: "medium" },

  [`POST ${API_PATHS.STATUS}`]: { bucket: "lenient", enforceActiveSuspension: false },
  [`POST ${API_PATHS.PARTY_MEMBERS}`]: { bucket: "lenient" },
  [`POST ${API_PATHS.PARTY_SETTINGS}`]: { bucket: "lenient" },
  [`POST ${API_PATHS.PARTY_DISCOVER}`]: { bucket: "lenient" },
  [`POST ${API_PATHS.PARTY_JOIN_REQUESTS}`]: { bucket: "lenient" },
};

const HTTP_ESCALATION_STEPS = [
  { level: 1, type: "mm_suspend", durationMs: 30 * 1000 },
  { level: 2, type: "mm_suspend", durationMs: 5 * 60 * 1000 },
  { level: 3, type: "mm_suspend", durationMs: 30 * 60 * 1000 },
  { level: 4, type: "ban" },
];

const CHAT_ESCALATION_STEPS = [
  { level: 1, type: "warn", message: "You are sending messages too fast." },
  {
    level: 2,
    type: "warn",
    message: "Repeated spamming can result in a suspension.",
  },
  {
    level: 3,
    type: "warn",
    message: "Continued violations will result in a suspension.",
  },
  { level: 4, type: "chat_suspend", durationMs: 30 * 1000 },
  { level: 5, type: "chat_suspend", durationMs: 3 * 60 * 1000 },
  {
    level: 6,
    type: "warn",
    message: "Continued abuse will lead to a permanent account ban.",
  },
  { level: 7, type: "chat_suspend", durationMs: 30 * 60 * 1000 },
  { level: 8, type: "ban" },
];

module.exports = {
  ABUSE_LOG_DECISIONS,
  ABUSE_DECAY_WINDOW_MS,
  CHAT_ACTION_LIMITS,
  CHAT_ESCALATION_STEPS,
  HTTP_BUCKETS,
  HTTP_ROUTE_POLICIES,
  HTTP_ESCALATION_STEPS,
};
