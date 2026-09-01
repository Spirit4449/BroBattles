const {
  registerPageRoutes,
  registerNotFoundRoute,
} = require("./modules/pageRoutes");
const { registerStatusRoutes } = require("./modules/statusRoutes");
const { registerPartyRoutes } = require("./modules/partyRoutes");
const { registerGameRoutes } = require("./modules/gameRoutes");
const { registerAuthRoutes } = require("./modules/authRoutes");
const { registerPlayerCardsRoutes } = require("./modules/playerCardsRoutes");
const { registerProfileIconsRoutes } = require("./modules/profileIconsRoutes");
const { registerSkinsRoutes } = require("./modules/skinsRoutes");
const { registerProfileRoutes } = require("./modules/profileRoutes");
const { registerTrophyRoutes } = require("./modules/trophyRoutes");
const { registerChatRoutes } = require("./modules/chatRoutes");
const { registerShopRoutes } = require("./modules/shopRoutes");

function registerRoutes({
  app,
  io,
  db,
  auth,
  pageRoot,
  distDir,
  chatService,
  abuseControl,
  shopService,
  stripeShopService,
}) {
  const { getOrCreateCurrentUser, requireCurrentUser, isGuest, isAdminUser } =
    auth;

  registerPageRoutes({
    app,
    db,
    getOrCreateCurrentUser,
    pageRoot,
    distDir,
  });

  registerStatusRoutes({
    app,
    db,
    getOrCreateCurrentUser,
    requireCurrentUser,
    isGuest,
    isAdminUser,
  });

  registerPartyRoutes({
    app,
    io,
    db,
    requireCurrentUser,
  });

  registerGameRoutes({
    app,
    db,
    requireCurrentUser,
    isAdminUser,
    abuseControl,
  });

  registerAuthRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerPlayerCardsRoutes({
    app,
    db,
    requireCurrentUser,
    shopService,
  });

  registerProfileIconsRoutes({
    app,
    db,
    requireCurrentUser,
    shopService,
  });

  registerSkinsRoutes({
    app,
    db,
    requireCurrentUser,
    shopService,
  });

  registerShopRoutes({
    app,
    requireCurrentUser,
    shopService,
    stripeShopService,
  });

  registerProfileRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerTrophyRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerChatRoutes({
    app,
    requireCurrentUser,
    chatService,
    abuseControl,
  });

  registerNotFoundRoute({ app, pageRoot });
}

module.exports = { registerRoutes };
