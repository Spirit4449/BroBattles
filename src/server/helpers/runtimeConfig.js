const fs = require("fs");
const { maintenanceRemaining } = require("../../shared/maintenance");
const path = require("path");

function deepMerge(target, source) {
  if (!source || typeof source !== "object") return target;
  const next = Array.isArray(target) ? [...target] : { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof next[key] === "object" &&
      next[key] !== null &&
      !Array.isArray(next[key])
    ) {
      next[key] = deepMerge(next[key], value);
    } else {
      next[key] = value;
    }
  }
  return next;
}

function createRuntimeConfig({ rootDir }) {
  const filePath = path.join(rootDir, "runtime-overrides.json");
  const defaults = {
    maintenanceMode: false,
    maintenanceUntil: null,
    bots: { enabled: false, rolloutPercent: 0 },
    announcements: "",
    rewardMultipliers: {
      coins: 1,
      gems: 1,
    },
  };

  let data = { ...defaults };
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (parsed && typeof parsed === "object") {
        data = deepMerge(defaults, parsed);
      }
    }
  } catch (err) {
    console.warn("[runtimeConfig] Failed to load overrides:", err?.message);
  }


  return {
    get() {
      return { ...data, maintenanceMode: maintenanceRemaining(data.maintenanceUntil) > 0 };
    },
    update(patch) {
      const next = deepMerge(data, patch || {});
      const temporary = `${filePath}.tmp`;
      fs.writeFileSync(temporary, JSON.stringify(next, null, 2), "utf8");
      fs.renameSync(temporary, filePath);
      data = next;
      return { ...data, maintenanceMode: maintenanceRemaining(data.maintenanceUntil) > 0 };
    },
    filePath,
  };
}

module.exports = { createRuntimeConfig };
