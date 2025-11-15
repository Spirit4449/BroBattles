const fs = require("fs");
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

  function persist() {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf8");
    } catch (err) {
      console.warn(
        "[runtimeConfig] Failed to persist overrides:",
        err?.message
      );
    }
  }

  return {
    get() {
      return { ...data };
    },
    update(patch) {
      data = deepMerge(data, patch || {});
      persist();
      return { ...data };
    },
    filePath,
  };
}

module.exports = { createRuntimeConfig };
