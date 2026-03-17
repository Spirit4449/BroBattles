const {
  registerPageRoutes,
  registerNotFoundRoute,
} = require("./modules/pageRoutes");
const { registerStatusRoutes } = require("./modules/statusRoutes");
const { registerPartyRoutes } = require("./modules/partyRoutes");
const { registerGameRoutes } = require("./modules/gameRoutes");
const { registerAuthRoutes } = require("./modules/authRoutes");

function registerRoutes({ app, io, db, auth, pageRoot, distDir }) {
  const { getOrCreateCurrentUser, requireCurrentUser, isGuest } = auth;

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
    isGuest,
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
  });

  registerAuthRoutes({
    app,
    db,
    requireCurrentUser,
  });

  registerNotFoundRoute({ app, pageRoot });
}

module.exports = { registerRoutes };
