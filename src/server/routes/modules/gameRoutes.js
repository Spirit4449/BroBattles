const fs = require("fs");
const path = require("path");
const { buildGameDataForMatch } = require("../../services/gameDataService");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MAP_SOURCE_BY_ID = {
  1: path.join(REPO_ROOT, "src", "maps", "lushyPeaks.js"),
  2: path.join(REPO_ROOT, "src", "maps", "mangroveMeadow.js"),
  3: path.join(REPO_ROOT, "src", "maps", "serenity.js"),
};

function jsonPretty(value) {
  return JSON.stringify(value, null, 2);
}

function findConstObjectReplacementRange(source, constName) {
  const marker = `const ${constName} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return null;

  let cursor = markerIndex + marker.length;
  while (cursor < source.length && /\s/.test(source[cursor])) cursor += 1;
  if (source[cursor] !== "{") return null;

  const objectStart = cursor;
  let depth = 0;
  let quote = "";
  let escaping = false;
  for (let i = objectStart; i < source.length; i += 1) {
    const ch = source[i];

    if (quote) {
      if (escaping) {
        escaping = false;
        continue;
      }
      if (ch === "\\") {
        escaping = true;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        let after = i + 1;
        while (after < source.length && /\s/.test(source[after])) after += 1;
        if (source[after] === ";") after += 1;
        return { start: markerIndex, end: after };
      }
    }
  }
  return null;
}

function replaceConstObject(source, constName, nextObject) {
  const range = findConstObjectReplacementRange(source, constName);
  if (!range) return source;
  const replacement = `const ${constName} = ${jsonPretty(nextObject)};`;
  return source.slice(0, range.start) + replacement + source.slice(range.end);
}

function hasConstObject(source, constName) {
  return !!findConstObjectReplacementRange(source, constName);
}

function replaceLayoutToggle(source, enabled) {
  const replacement = `const USE_LAYOUT_CONFIG_ONLY = ${enabled ? "true" : "false"};`;
  if (/const\s+USE_LAYOUT_CONFIG_ONLY\s*=\s*(true|false)\s*;/.test(source)) {
    return source.replace(
      /const\s+USE_LAYOUT_CONFIG_ONLY\s*=\s*(true|false)\s*;/,
      replacement,
    );
  }
  return source;
}

function registerGameRoutes({ app, db, requireCurrentUser, isAdminUser }) {
  app.post("/gamedata", async (req, res) => {
    console.log("Fetching game data for match:", req.body);
    try {
      const result = await buildGameDataForMatch({
        db,
        requireCurrentUser,
        isAdminUser,
        req,
        res,
      });
      if (result.handled) return;
      if (!result.ok) {
        return res.status(result.statusCode || 400).json(result.payload || {});
      }
      return res.json(result.payload);
    } catch (error) {
      console.error("gamedata error:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

  app.post("/api/admin/map-editor/save-file", async (req, res) => {
    try {
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({
          success: false,
          error: "Map file save is only enabled in development",
        });
      }

      const user = await requireCurrentUser(req, res);
      if (!user || !isAdminUser(user)) {
        return res
          .status(403)
          .json({ success: false, error: "Admin access required" });
      }

      const mapId = Number(req.body?.mapId);
      const payload = req.body?.payload || {};
      const savePath = MAP_SOURCE_BY_ID[mapId];
      if (!savePath) {
        return res.status(400).json({
          success: false,
          error: `Unsupported mapId: ${String(req.body?.mapId || "")}`,
        });
      }
      if (!fs.existsSync(savePath)) {
        return res.status(404).json({
          success: false,
          error: "Map source file not found",
        });
      }

      const platforms = Array.isArray(payload.platforms)
        ? payload.platforms
        : [];
      const hitboxes = Array.isArray(payload.hitboxes) ? payload.hitboxes : [];
      const spawns =
        payload?.spawns && typeof payload.spawns === "object"
          ? payload.spawns
          : null;
      const enableLayoutConfigOnly = req.body?.enableLayoutConfigOnly !== false;
      const updateSpawnConfig = req.body?.updateSpawnConfig !== false;

      let source = fs.readFileSync(savePath, "utf8");
      if (!hasConstObject(source, "MAP_LAYOUT_CONFIG")) {
        return res.status(400).json({
          success: false,
          error: "MAP_LAYOUT_CONFIG not found in target map file",
        });
      }
      if (updateSpawnConfig && !hasConstObject(source, "SPAWN_CONFIG")) {
        return res.status(400).json({
          success: false,
          error: "SPAWN_CONFIG not found in target map file",
        });
      }
      if (
        !/const\s+USE_LAYOUT_CONFIG_ONLY\s*=\s*(true|false)\s*;/.test(source)
      ) {
        return res.status(400).json({
          success: false,
          error: "USE_LAYOUT_CONFIG_ONLY toggle not found in target map file",
        });
      }

      source = replaceConstObject(source, "MAP_LAYOUT_CONFIG", {
        platforms,
        hitboxes,
      });
      source = replaceLayoutToggle(source, enableLayoutConfigOnly);
      if (updateSpawnConfig && spawns) {
        source = replaceConstObject(source, "SPAWN_CONFIG", spawns);
      }

      fs.writeFileSync(savePath, source, "utf8");
      return res.json({
        success: true,
        mapId,
        file: path.relative(REPO_ROOT, savePath).replace(/\\/g, "/"),
      });
    } catch (error) {
      console.error("[map-editor] save-file error", error);
      return res.status(500).json({
        success: false,
        error: "Failed to save map file",
      });
    }
  });
}

module.exports = { registerGameRoutes };
