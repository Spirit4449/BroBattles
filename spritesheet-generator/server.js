const express = require("express");
const multer = require("multer");
const fs = require("fs/promises");
const path = require("path");

const {
  ANIMATION_DEFS,
  DEFAULT_FPS,
  addAnimationToSession,
  createSession,
  ensureBaseDirectories,
  exportBundleFromManifest,
  readSessionMetadata,
  updateSessionDetails,
} = require("./lib/spritesheetGenerator");

const PORT = Number(process.env.PORT) || 3015;
const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, "public");
const TMP_DIR = path.join(ROOT_DIR, "tmp");
const OUTPUT_DIR = path.join(ROOT_DIR, "output");
const STAGING_DIR = path.join(TMP_DIR, "uploads");
const SESSION_DIR = path.join(TMP_DIR, "sessions");

const singleUpload = multer({
  dest: STAGING_DIR,
  limits: { fileSize: 512 * 1024 * 1024, files: 1 },
});

const anyUpload = multer({
  dest: STAGING_DIR,
  limits: { fileSize: 32 * 1024 * 1024, files: 400 },
});

const app = express();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/output", express.static(OUTPUT_DIR));
app.use("/preview", express.static(SESSION_DIR));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    defaultFps: DEFAULT_FPS,
    outputDir: OUTPUT_DIR,
    previewDir: SESSION_DIR,
    animations: ANIMATION_DEFS,
  });
});

app.post("/api/session/init", async (req, res) => {
  try {
    const session = await createSession({
      tempRoot: TMP_DIR,
      characterName: req.body.characterName,
      keyColor: req.body.keyColor,
      tolerance: Number(req.body.tolerance),
    });
    return res.json({ ok: true, session });
  } catch (error) {
    return res.status(400).json({ error: buildErrorMessage(error) });
  }
});

app.get("/api/session/:sessionId", async (req, res) => {
  try {
    const session = await readSessionMetadata(req.params.sessionId, TMP_DIR);
    return res.json({ ok: true, session });
  } catch (error) {
    return res.status(404).json({ error: "Session not found." });
  }
});

app.post(
  "/api/session/:sessionId/animation",
  singleUpload.single("video"),
  async (req, res) => {
    const stagedFile = req.file;
    try {
      if (!stagedFile) {
        return res.status(400).json({ error: "Animation video is required." });
      }

      const sessionId = String(req.params.sessionId || "").trim();
      const atlasPrefix = String(req.body.atlasPrefix || "").trim();
      const fps = Number(req.body.fps);
      const characterName = String(req.body.characterName || "").trim();
      const keyColor = String(req.body.keyColor || "").trim();
      const tolerance = Number(req.body.tolerance);

      await updateSessionDetails({
        tempRoot: TMP_DIR,
        sessionId,
        characterName,
        keyColor,
        tolerance,
      });

      const session = await addAnimationToSession({
        tempRoot: TMP_DIR,
        sessionId,
        atlasPrefix,
        fps,
        uploadedFile: stagedFile,
      });

      return res.json({ ok: true, session });
    } catch (error) {
      return res.status(500).json({ error: buildErrorMessage(error) });
    } finally {
      if (stagedFile) {
        await fs.rm(stagedFile.path, { force: true });
      }
    }
  },
);

app.post("/api/export", anyUpload.any(), async (req, res) => {
  try {
    const manifest = JSON.parse(String(req.body.manifest || "{}"));
    const result = await exportBundleFromManifest({
      outputRoot: OUTPUT_DIR,
      manifest,
      uploadedFiles: req.files || [],
    });

    return res.json({
      ok: true,
      character: result.characterKey,
      keyColor: result.keyColor,
      tolerance: result.tolerance,
      cellSize: result.cellSize,
      frameCounts: result.frameCounts,
      fpsByAnimation: result.fpsByAnimation,
      generatedAt: result.generatedAt,
      urls: {
        body: `/output/${encodeURIComponent(result.characterKey)}/body.webp`,
        spritesheet: `/output/${encodeURIComponent(result.characterKey)}/spritesheet.webp`,
        atlas: `/output/${encodeURIComponent(result.characterKey)}/animations.json`,
        notes: `/output/${encodeURIComponent(result.characterKey)}/import-notes.md`,
        zip: `/output/${encodeURIComponent(result.characterKey)}.zip`,
      },
    });
  } catch (error) {
    return res.status(500).json({ error: buildErrorMessage(error) });
  } finally {
    await cleanupStagedFiles(req.files || []);
  }
});

function buildErrorMessage(error) {
  return error && error.code === "ENOENT" && String(error.path || "").includes("ffmpeg")
    ? "ffmpeg was not found on PATH. Install ffmpeg and restart the server."
    : error.message || "Request failed.";
}

async function cleanupStagedFiles(files) {
  await Promise.all((files || []).map((file) => fs.rm(file.path, { force: true })));
}

async function start() {
  await ensureBaseDirectories(ROOT_DIR);
  await fs.mkdir(STAGING_DIR, { recursive: true });

  app.listen(PORT, () => {
    console.log(`Spritesheet generator running at http://localhost:${PORT}`);
  });
}

start().catch((error) => {
  console.error("Failed to start spritesheet generator:", error);
  process.exit(1);
});
