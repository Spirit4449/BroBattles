async function getBootstrap({ db, user, runtimeConfig, shopService, stripeShopService }) {
  const [{ users = 0 }] = await db.runQuery("SELECT COUNT(*) AS users FROM users");
  const [{ guests = 0 }] = await db.runQuery(
    "SELECT COUNT(*) AS guests FROM users WHERE expires_at > NOW()",
  );
  const [{ parties = 0 }] = await db.runQuery("SELECT COUNT(*) AS parties FROM parties");
  const [{ live_matches = 0 }] = await db.runQuery(
    "SELECT COUNT(*) AS live_matches FROM matches WHERE status = 'live'",
  );
  const recentMatches = await db.runQuery(
    "SELECT match_id, status, mode, map, created_at FROM matches ORDER BY match_id DESC LIMIT 6",
  );
  const recentUsers = await db.runQuery(
    `SELECT user_id, name, coins, gems, trophies, status, char_class,
            selected_profile_icon_id, expires_at, created_at
       FROM users
      ORDER BY updated_at DESC
      LIMIT 6`,
  );
  const runtimeData =
    runtimeConfig && typeof runtimeConfig.get === "function"
      ? runtimeConfig.get()
      : runtimeConfig || {};
  const shop = {
    ...(await shopService.getAdminStatus()),
    payment: {
      ...stripeShopService.getConfigurationStatus(),
      listener: stripeShopService.listener.getStatus(),
    },
  };
  return {
    success: true,
    admin: { name: user.name, userId: user.user_id },
    stats: {
      users,
      guests,
      parties,
      live_matches,
    },
    recentMatches,
    recentUsers,
    runtime: runtimeData,
    shop,
  };
}

module.exports = { getBootstrap };
