// HTTP routes shared by the browser and Express. Values also identify saved links.
const API_PATHS = Object.freeze({
  API_ADMIN_BOOTSTRAP: "/api/admin/bootstrap",
  API_ADMIN_FEEDBACK: "/api/admin/feedback",
  API_ADMIN_GRANT: "/api/admin/grant",
  API_ADMIN_GRANTS: "/api/admin/grants",
  API_ADMIN_MAP_PLAYTESTS: "/api/admin/map-playtests",
  API_ADMIN_MAPS: "/api/admin/maps",
  API_ADMIN_MAPS_UPLOAD: "/api/admin/maps/upload",
  API_ADMIN_RUNTIME: "/api/admin/runtime",
  API_ADMIN_SHOP_CATALOG: "/api/admin/shop/catalog",
  API_ADMIN_SHOP_PREVIEW: "/api/admin/shop/preview",
  API_ADMIN_SHOP_REFRESH: "/api/admin/shop/refresh",
  API_ADMIN_SHOP_STATUS: "/api/admin/shop/status",
  API_ADMIN_SUPPORT: "/api/admin/support",
  API_ADMIN_USER_SEARCH: "/api/admin/user-search",
  API_ADMIN_USER_UPDATE: "/api/admin/user-update",
  API_ADMIN_USERS: "/api/admin/users",
  API_FEEDBACK: "/api/feedback",
  API_LEGAL_ACCEPT: "/api/legal/accept",
  API_LEGAL_STATUS: "/api/legal/status",
  API_SHOP_BOOTSTRAP: "/api/shop/bootstrap",
  API_SHOP_CHECKOUT_SESSION: "/api/shop/checkout-session",
  API_SHOP_CHECKOUT_STATUS: "/api/shop/checkout-status",
  API_SHOP_CLAIM_DAILY: "/api/shop/claim-daily",
  API_SHOP_PURCHASE: "/api/shop/purchase",
  API_SHOP_VIEWED: "/api/shop/viewed",
  API_SITE_HELP_SEARCH: "/api/site/help-search",
  API_SITE_RUNTIME: "/api/site/runtime",
  API_SITE_SESSION: "/api/site/session",
  API_SUPPORT_REPORTS: "/api/support/reports",
  API_SUPPORT_REQUESTS: "/api/support/requests",
  API_VERSION: "/api/version",
  BUY: "/buy",
  CREATE_PARTY: "/create-party",
  FRIENDS: "/friends",
  FRIENDS_CANCEL: "/friends/cancel",
  FRIENDS_MESSAGES_HISTORY: "/friends/messages/history",
  FRIENDS_MESSAGES_REACT: "/friends/messages/react",
  FRIENDS_MESSAGES_READ: "/friends/messages/read",
  FRIENDS_MESSAGES_SEND: "/friends/messages/send",
  FRIENDS_PARTY_INVITE: "/friends/party-invite",
  FRIENDS_PRIVACY: "/friends/privacy",
  FRIENDS_RELATIONSHIP: "/friends/relationship",
  FRIENDS_REMOVE: "/friends/remove",
  FRIENDS_REQUEST: "/friends/request",
  FRIENDS_RESPOND: "/friends/respond",
  FRIENDS_SUGGESTIONS: "/friends/suggestions",
  GAMEDATA: "/gamedata",
  LEADERBOARD_TROPHIES: "/leaderboard/trophies",
  LEAVE_PARTY: "/leave-party",
  LOGIN: "/login",
  LOGOUT: "/logout",
  PARTY_CHAT_HISTORY: "/party-chat/history",
  PARTY_CHAT_REACT: "/party-chat/react",
  PARTY_CHAT_READ: "/party-chat/read",
  PARTY_CHAT_SEND: "/party-chat/send",
  PARTY_MEMBERS: "/party-members",
  PARTY_DISCOVER: "/party/discover",
  PARTY_JOIN_REQUEST: "/party/join-request",
  PARTY_JOIN_REQUEST_RESPOND: "/party/join-request/respond",
  PARTY_JOIN_REQUESTS: "/party/join-requests",
  PARTY_KICK: "/party/kick",
  PARTY_MAKE_OWNER: "/party/make-owner",
  PARTY_SETTINGS: "/party/settings",
  PARTY_SETTINGS_UPDATE: "/party/settings/update",
  PARTYDATA: "/partydata",
  PLAYER_CARDS_CATALOG: "/player-cards/catalog",
  PLAYER_CARDS_OWNED: "/player-cards/owned",
  PLAYER_CARDS_SELECT: "/player-cards/select",
  PROFILE_ICONS_CATALOG: "/profile-icons/catalog",
  PROFILE_ICONS_OWNED: "/profile-icons/owned",
  PROFILE_ICONS_SELECT: "/profile-icons/select",
  PROFILE_CHANGE_PASSWORD: "/profile/change-password",
  PROFILE_BATTLES: "/profile/battles",
  PROFILE_CHANGE_USERNAME: "/profile/change-username",
  PROFILE_DATA: "/profile/data",
  PROFILE_EMAIL: "/profile/email",
  PROFILE_EMAIL_MARKETING: "/profile/email/marketing",
  PROFILE_EMAIL_SEND_CODE: "/profile/email/send-code",
  PROFILE_EMAIL_VERIFY: "/profile/email/verify",
  PROFILE_VIEW: "/profile/view",
  SELECTION_PREFERENCES: "/selection-preferences",
  SIGNUP: "/signup",
  SKINS_OWNED: "/skins/owned",
  SKINS_SELECT: "/skins/select",
  STATUS: "/status",
  TITLES_SELECT: "/titles/select",
  TROPHIES_CLAIM: "/trophies/claim",
  TROPHIES_PROGRESSION: "/trophies/progression",
  UPGRADE: "/upgrade",
  USERNAME_AVAILABILITY: "/username-availability",
});

const adminModerationPaths = Object.freeze({
  ban: "/api/admin/user-ban",
  suspend: "/api/admin/user-suspend",
  unban: "/api/admin/user-unban",
});

function recordPath(base, id = ":id", action) {
  const segment = id === ":id" ? id : encodeURIComponent(id);
  return action ? `${base}/${segment}/${action}` : `${base}/${segment}`;
}

function adminUserPath(id, action) {
  return recordPath(API_PATHS.API_ADMIN_USERS, id, action);
}

function adminModerationPath(action) {
  return adminModerationPaths[action];
}

function adminInboxPath(kind, id, action) {
  const base = kind === "support" ? API_PATHS.API_ADMIN_SUPPORT : API_PATHS.API_ADMIN_FEEDBACK;
  return id === undefined ? base : recordPath(base, id, action);
}

function supportRequestPath(id, action) {
  return recordPath(API_PATHS.API_SUPPORT_REQUESTS, id, action);
}

exports.API_PATHS = API_PATHS;
exports.adminUserPath = adminUserPath;
exports.adminModerationPath = adminModerationPath;
exports.adminInboxPath = adminInboxPath;
exports.supportRequestPath = supportRequestPath;


// The Express pattern is supplied explicitly so a missing client id cannot
// accidentally produce a valid request to the collection endpoint.
exports.mapDocumentPath = id => `${API_PATHS.API_ADMIN_MAPS}/${id}`;
exports.mapPlaytestPath = session => `${API_PATHS.API_ADMIN_MAP_PLAYTESTS}/${session}`;
