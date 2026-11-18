const { routeErrorMiddleware } = require("./http");
const { registerTitlesRoutes } = require("./modules/titlesRoutes");
const { registerSiteRoutes } = require("./modules/siteRoutes");
const { registerMapEditorRoutes } = require("./modules/mapEditorRoutes");
const { registerEconomyRoutes } = require("./modules/economy");
const { registerAdminRoutes } = require("./modules/admin");
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
const { registerEmailRoutes } = require("./modules/emailRoutes");
const { registerProfileRoutes } = require("./modules/profileRoutes");
const { registerTrophyRoutes } = require("./modules/trophyRoutes");
const { registerChatRoutes } = require("./modules/chatRoutes");
const { registerShopRoutes } = require("./modules/shopRoutes");
const { registerFriendRoutes } = require("./modules/friendRoutes");

function registerRoutes({
  app,
  io,
  db,
  auth,
  pageRoot,
  distDir,
  runtimeConfig,
  chatService,
  abuseControl,
  shopService,
  stripeShopService,
  friendService,
  mapPlaytests,
}) {
  registerEconomyRoutes({ app, io, db, auth });
  registerAdminRoutes({ app, io, db, auth, pageRoot, distDir, runtimeConfig, shopService, stripeShopService });
  const { getOrCreateCurrentUser, requireCurrentUser, isGuest, isAdminUser } =
    auth;

  registerMapEditorRoutes({app, requireCurrentUser, isAdminUser, pageRoot, mapPlaytests});

  registerSiteRoutes({ app, db, auth });

  registerPageRoutes({
    app,
    db,
    getOrCreateCurrentUser,
    requireCurrentUser,
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
  });

  registerTitlesRoutes({ app, db, requireCurrentUser });

  registerProfileIconsRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerSkinsRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerShopRoutes({
    app,
    requireCurrentUser,
    shopService,
    stripeShopService,
  });

  registerEmailRoutes({ app, db, requireCurrentUser });
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

  registerFriendRoutes({
    app,
    requireCurrentUser,
    friendService,
    abuseControl,
  });

  registerNotFoundRoute({ app, pageRoot });
  app.use(routeErrorMiddleware);
}

module.exports = { registerRoutes };
