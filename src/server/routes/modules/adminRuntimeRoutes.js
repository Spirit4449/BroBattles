const { API_PATHS } = require("../../../shared/net/apiPaths.js");

function registerAdminRuntimeRoutes({ app, requireAdminUser, sendUnauthorized, runtimeConfig }) {
  app.post(API_PATHS.API_ADMIN_RUNTIME, async (req, res) => {
    const admin = await requireAdminUser(req, res);
    if (!admin) return sendUnauthorized(res);
    try {
      const body = req.body || {};
      const patch = {};
      if (typeof body.maintenanceUntil !== "undefined") {
        const until = body.maintenanceUntil;
        if (
          until !== null &&
          (typeof until !== "string" ||
            !Number.isFinite(Date.parse(until)) ||
            Date.parse(until) <= Date.now())
        )
          return res.status(400).json({ error: "Choose a maintenance end time in the future" });
        patch.maintenanceUntil = until === null ? null : new Date(until).toISOString();
        patch.maintenanceMode = until !== null;
      }
      if (typeof body.announcements !== "undefined") {
        if (typeof body.announcements !== "string" || body.announcements.length > 500)
          return res.status(400).json({ error: "Announcement must be at most 500 characters" });
        patch.announcements = body.announcements.trim();
      }
      const multipliers = body.rewardMultipliers;
      if (multipliers && typeof multipliers === "object") {
        patch.rewardMultipliers = {};
        for (const currency of ["coins", "gems"]) {
          if (typeof multipliers[currency] === "undefined") continue;
          const value = Number(multipliers[currency]);
          if (!(value > 0 && value <= 10))
            return res
              .status(400)
              .json({
                error: `The ${currency === "coins" ? "coin" : "gem"} multiplier must be above 0 and at most 10`,
              });
          patch.rewardMultipliers[currency] = value;
        }
      }
      for (const [key, min] of [
        ["rewardFloor", 0],
        ["rewardCeiling", 1],
      ]) {
        if (typeof body[key] === "undefined") continue;
        const value = Number(body[key]);
        if (!Number.isInteger(value) || value < min || value > 1_000_000)
          return res
            .status(400)
            .json({
              error: `${key === "rewardFloor" ? "Coin floor" : "Coin ceiling"} must be a whole number from ${min} to 1,000,000`,
            });
        patch[key] = value;
      }
      const current =
        runtimeConfig && typeof runtimeConfig.get === "function" ? runtimeConfig.get() : {};
      const floor = patch.rewardFloor ?? current.rewardFloor;
      const ceiling = patch.rewardCeiling ?? current.rewardCeiling;
      if (Number.isFinite(floor) && Number.isFinite(ceiling) && floor > ceiling)
        return res.status(400).json({ error: "The coin floor can't be above the ceiling" });
      const updated =
        runtimeConfig && typeof runtimeConfig.update === "function"
          ? runtimeConfig.update(patch)
          : patch;
      console.log(`[admin] ${admin.name} updated runtime config`, patch);
      return res.json({ success: true, runtime: updated });
    } catch (err) {
      console.error("[admin] runtime update error", err);
      return res.status(500).json({ success: false, error: "Failed to update runtime" });
    }
  });
}

module.exports = { registerAdminRuntimeRoutes };
