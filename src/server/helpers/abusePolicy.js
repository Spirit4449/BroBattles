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
};

const HTTP_ROUTE_POLICIES = {
  "POST /signup": { bucket: "strict" },
  "POST /login": { bucket: "strict" },
  "POST /upgrade": { bucket: "strict" },
  "POST /buy": { bucket: "strict" },
  "POST /profile/change-username": { bucket: "strict" },
  "POST /profile/change-password": { bucket: "strict" },
  "POST /api/admin/map-editor/save-file": { bucket: "strict" },
  "POST /api/admin/user-search": { bucket: "strict" },
  "POST /api/admin/user-update": { bucket: "strict" },
  "POST /api/admin/runtime": { bucket: "strict" },

  "POST /create-party": { bucket: "medium" },
  "POST /partydata": { bucket: "medium" },
  "POST /leave-party": { bucket: "medium" },
  "POST /party/kick": { bucket: "medium" },
  "POST /party/make-owner": { bucket: "medium" },
  "POST /party/settings/update": { bucket: "medium" },
  "POST /party/join-request": { bucket: "medium" },
  "POST /party/join-request/respond": { bucket: "medium" },
  "POST /selection-preferences": { bucket: "medium" },
  "POST /player-cards/select": { bucket: "medium" },
  "POST /player-cards/buy": { bucket: "medium" },
  "POST /profile-icons/select": { bucket: "medium" },
  "POST /profile-icons/buy": { bucket: "medium" },
  "POST /skins/select": { bucket: "medium" },
  "POST /skins/buy": { bucket: "medium" },
  "POST /trophies/claim": { bucket: "medium" },
  "POST /gamedata": { bucket: "medium" },

  "POST /status": { bucket: "lenient", enforceActiveSuspension: false },
  "POST /party-members": { bucket: "lenient" },
  "POST /party/settings": { bucket: "lenient" },
  "POST /party/discover": { bucket: "lenient" },
  "POST /party/join-requests": { bucket: "lenient" },
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
