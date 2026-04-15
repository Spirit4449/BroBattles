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
const { registerProfileRoutes } = require("./modules/profileRoutes");
const { registerTrophyRoutes } = require("./modules/trophyRoutes");
const { registerChatRoutes } = require("./modules/chatRoutes");

function registerRoutes({ app, io, db, auth, pageRoot, distDir, chatService }) {
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

  registerProfileIconsRoutes({
    app,
    db,
    requireCurrentUser,
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
  });

  registerNotFoundRoute({ app, pageRoot });
}

module.exports = { registerRoutes };
