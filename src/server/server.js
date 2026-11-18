async function startServer() {
  // Console output must never block the game loop on a busy disk.
  require("./lib/asyncConsole").installAsyncConsole();

  // Load environment variables from .env file
  require("dotenv").config();
  const config = require("./config").initializeConfig();
  if (!config.admin.users.length)
    console.warn("[auth] ADMIN_USERS is empty: no administrator accounts exist.");

  const db = require("./core/sql.js");
  const { createApplication } = require("./application");
  const { app, server, io, socketApi, matchResults, stripeShopService, stripeListener, dispose } =
    await createApplication({ db, config });
  const { port } = config;
  let ownership, jobs, stopping;
  function stop() {
    if (!stopping)
      stopping = (async () => {
        process.off("SIGTERM", shutdown);
        process.off("SIGINT", shutdown);
        if (!config.isProd) process.off("SIGUSR2", shutdown);
        const tasks = [jobs?.stop(), dispose()];
        const results = await Promise.allSettled(tasks);
        try {
          await db.closePool();
        } finally {
          await ownership?.release();
        }
        for (const result of results) if (result.status === "rejected") throw result.reason;
      })();
    return stopping;
  }
  function shutdown(signal) {
    setTimeout(() => process.exit(1), 15000).unref();
    void stop().then(
      () => {
        // Nodemon waits for its child to finish handling SIGUSR2 before restart.
        if (signal === "SIGUSR2") process.kill(process.pid, "SIGUSR2");
        else process.exit(0);
      },
      (error) => {
        console.error("[shutdown]", error);
        process.exit(1);
      },
    );
  }
  try {
    ownership = await require("./services/runtimeOwnershipService").acquireRuntimeOwnership({
      connect: db.openRuntimeConnection,
      database: db.databaseName,
      onLost: (error) => {
        console.error("[runtime] ownership lost", error.message);
        process.exit(1);
      },
    });
    await matchResults.prepare();
    await matchResults.reconcile();
    // A stopped process cannot resume an in-memory simulation from its initial roster.
    // Preserve unsettled outcomes so journal reconciliation can finish their rewards.
    const pendingIds = await matchResults.pendingMatchIds();
    await require("./services/match/matchLifecycleService").cancelInterruptedMatches(
      db,
      pendingIds,
    );
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, "0.0.0.0", () => {
        server.off("error", reject);
        resolve();
      });
    });
    jobs = require("./jobs").startJobs({ db, io, matchResults, stripeShopService, socketApi });
    socketApi.start();
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    if (!config.isProd) process.once("SIGUSR2", shutdown);
    console.log("✅ Database connected");
    // Parse map metadata once up front so the first /status requests don't.
    try {
      require("./services/maps/mapRepository").mapRepository.listMetadata();
    } catch (error) {
      console.warn("[maps] unable to warm metadata cache", error.message);
    }
    void stripeListener
      .start(port)
      .catch((error) => console.error("[shop:stripe] listener failed", error));
    console.log(
      `Server listening on 0.0.0.0:${port} (cookies secure=${config.cookies.secure}, env=${config.nodeEnv})`,
    );
    return { app, server, stop };
  } catch (e) {
    console.error("[server] startup failed", e);
    await stop().catch((error) => console.error("[server] startup cleanup failed", error));
    throw e;
  }
}

if (require.main === module) {
  process.on("unhandledRejection", (reason) =>
    console.error("[process] unhandled promise rejection", reason),
  );
  startServer().catch(() => process.exit(1));
}
module.exports = { startServer };
