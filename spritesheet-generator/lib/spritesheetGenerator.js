const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const archiver = require("archiver");
const sharp = require("sharp");

const DEFAULT_FPS = 15;
const DEFAULT_KEY_COLOR = "#00ff00";
const DEFAULT_TOLERANCE = 26;
const ZERO_PAD = 2;

const ANIMATION_DEFS = [
  { atlasPrefix: "idle", label: "Idle" },
  { atlasPrefix: "running", label: "Running" },
  { atlasPrefix: "jumping", label: "Jumping" },
  { atlasPrefix: "falling", label: "Falling" },
  { atlasPrefix: "attack", label: "Attack" },
  { atlasPrefix: "dying", label: "Dead" },
  { atlasPrefix: "wall", label: "Wall Jump", singleFrame: true },
  { atlasPrefix: "special", label: "Special" },
];

const ANIMATION_BY_PREFIX = Object.fromEntries(
  ANIMATION_DEFS.map((animation) => [animation.atlasPrefix, animation]),
);

function sanitizeCharacterKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, "-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseHexColor(hex) {
  const normalized = String(hex || DEFAULT_KEY_COLOR).trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);
  if (!match) {
    throw new Error("Background key color must be a 6-digit hex value like #00ff00.");
  }

  const raw = match[1];
  return {
    hex: `#${raw.toLowerCase()}`,
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function clampTolerance(value) {
  if (!Number.isFinite(value)) return DEFAULT_TOLERANCE;
  return Math.max(0, Math.min(120, Math.round(value)));
}

function clampFps(value) {
  if (!Number.isFinite(value)) return DEFAULT_FPS;
  return Math.max(1, Math.min(60, Math.round(value)));
}

async function ensureBaseDirectories(rootDir) {
  await Promise.all([
    fsp.mkdir(path.join(rootDir, "lib"), { recursive: true }),
    fsp.mkdir(path.join(rootDir, "public"), { recursive: true }),
    fsp.mkdir(path.join(rootDir, "tmp", "sessions"), { recursive: true }),
    fsp.mkdir(path.join(rootDir, "tmp", "uploads"), { recursive: true }),
    fsp.mkdir(path.join(rootDir, "output"), { recursive: true }),
  ]);
}

async function createSession({ tempRoot, characterName, keyColor, tolerance }) {
  const characterKey = sanitizeCharacterKey(characterName);
  if (!characterKey) {
    throw new Error("Character name is required.");
  }

  const parsedColor = parseHexColor(keyColor);
  const toleranceValue = clampTolerance(tolerance);
  const sessionId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const sessionRoot = getSessionRoot(tempRoot, sessionId);

  await Promise.all([
    fsp.mkdir(path.join(sessionRoot, "previews"), { recursive: true }),
    fsp.mkdir(path.join(sessionRoot, "work"), { recursive: true }),
  ]);

  const metadata = {
    sessionId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    characterKey,
    keyColor: parsedColor.hex,
    tolerance: toleranceValue,
    animations: ANIMATION_DEFS.map((animation) => ({
      atlasPrefix: animation.atlasPrefix,
      label: animation.label,
      singleFrame: !!animation.singleFrame,
      fps: DEFAULT_FPS,
      frames: [],
    })),
  };

  await saveSessionMetadata(tempRoot, sessionId, metadata);
  return metadata;
}

async function updateSessionDetails({
  tempRoot,
  sessionId,
  characterName,
  keyColor,
  tolerance,
}) {
  const metadata = await readSessionMetadata(sessionId, tempRoot);
  const nextCharacterKey = sanitizeCharacterKey(characterName) || metadata.characterKey;
  const parsedColor = parseHexColor(keyColor || metadata.keyColor);
  const toleranceValue = clampTolerance(
    Number.isFinite(tolerance) ? tolerance : metadata.tolerance,
  );

  const nextMetadata = {
    ...metadata,
    characterKey: nextCharacterKey,
    keyColor: parsedColor.hex,
    tolerance: toleranceValue,
    updatedAt: new Date().toISOString(),
  };

  await saveSessionMetadata(tempRoot, sessionId, nextMetadata);
  return nextMetadata;
}

async function addAnimationToSession({
  tempRoot,
  sessionId,
  atlasPrefix,
  fps,
  uploadedFile,
}) {
  const animationDef = ANIMATION_BY_PREFIX[atlasPrefix];
  if (!animationDef) {
    throw new Error(`Unknown animation type: ${atlasPrefix}`);
  }

  const metadata = await readSessionMetadata(sessionId, tempRoot);
  const sessionRoot = getSessionRoot(tempRoot, sessionId);
  const parsedColor = parseHexColor(metadata.keyColor);
  const toleranceValue = clampTolerance(metadata.tolerance);
  const animationFps = clampFps(fps);
  const workRoot = path.join(sessionRoot, "work", `${atlasPrefix}-${Date.now()}`);
  const extractedDir = path.join(workRoot, "extracted");
  const croppedDir = path.join(workRoot, "cropped");
  const previewDir = path.join(sessionRoot, "previews", atlasPrefix);

  await Promise.all([
    fsp.mkdir(extractedDir, { recursive: true }),
    fsp.mkdir(croppedDir, { recursive: true }),
    fsp.rm(previewDir, { recursive: true, force: true }),
    fsp.mkdir(previewDir, { recursive: true }),
  ]);

  try {
    await extractFrames(uploadedFile.path, extractedDir, animationFps);
    let framePaths = await listPngFiles(extractedDir);
    if (animationDef.singleFrame) {
      framePaths = framePaths.slice(0, 1);
    }

    if (!framePaths.length) {
      throw new Error(`No frames were extracted for ${animationDef.label}.`);
    }

    const frames = [];
    for (let index = 0; index < framePaths.length; index += 1) {
      const framePath = framePaths[index];
      const croppedFramePath = path.join(
        croppedDir,
        `${atlasPrefix}-${String(index).padStart(4, "0")}.png`,
      );

      const frameInfo = await removeBackgroundAndTrim({
        inputPath: framePath,
        outputPath: croppedFramePath,
        color: parsedColor,
        tolerance: toleranceValue,
      });

      const canonicalName = `${atlasPrefix}${String(index).padStart(ZERO_PAD, "0")}`;
      const previewPath = path.join(previewDir, `${canonicalName}.png`);
      await sharp(croppedFramePath).png().toFile(previewPath);

      const relativePath = path.posix.join("previews", atlasPrefix, `${canonicalName}.png`);
      frames.push({
        id: `${atlasPrefix}-${crypto.randomBytes(3).toString("hex")}`,
        index,
        fileName: canonicalName,
        relativePath,
        url: `/preview/${sessionId}/${relativePath}`,
        width: frameInfo.width,
        height: frameInfo.height,
      });
    }

    const nextMetadata = {
      ...metadata,
      updatedAt: new Date().toISOString(),
      animations: metadata.animations.map((animation) =>
        animation.atlasPrefix === atlasPrefix
          ? {
              ...animation,
              fps: animationFps,
              frames,
            }
          : animation,
      ),
    };

    await saveSessionMetadata(tempRoot, sessionId, nextMetadata);
    return nextMetadata;
  } finally {
    await fsp.rm(workRoot, { recursive: true, force: true });
  }
}

async function exportBundleFromManifest({
  outputRoot,
  manifest,
  uploadedFiles,
}) {
  const filesByField = new Map(
    uploadedFiles.map((file) => [file.fieldname, file]),
  );
  const characterKey = sanitizeCharacterKey(manifest.characterName);
  if (!characterKey) {
    throw new Error("Character name is required for export.");
  }

  const animations = [];
  for (const animation of manifest.animations || []) {
    if (!animation.frames?.length) continue;
    const frameEntries = [];

    for (let index = 0; index < animation.frames.length; index += 1) {
      const frame = animation.frames[index];
      const uploaded = filesByField.get(frame.uploadField);
      if (!uploaded) {
        throw new Error(`Missing uploaded frame for ${animation.atlasPrefix}.`);
      }

      const meta = await sharp(uploaded.path).metadata();
      if (!meta.width || !meta.height) {
        throw new Error(`Unable to read dimensions for ${uploaded.originalname}.`);
      }

      frameEntries.push({
        uploadField: frame.uploadField,
        absolutePath: uploaded.path,
        width: meta.width,
        height: meta.height,
        order: index,
      });
    }

    animations.push({
      atlasPrefix: animation.atlasPrefix,
      label: animation.label || ANIMATION_BY_PREFIX[animation.atlasPrefix]?.label || animation.atlasPrefix,
      fps: clampFps(animation.fps),
      frames: frameEntries,
    });
  }

  if (!animations.length) {
    throw new Error("At least one animation with frames is required to export.");
  }

  const orderedAnimations = ANIMATION_DEFS
    .map((definition) =>
      animations.find((animation) => animation.atlasPrefix === definition.atlasPrefix),
    )
    .filter(Boolean);

  const bodyFile = filesByField.get(manifest.bodyFrameField);
  if (!bodyFile) {
    throw new Error("A body frame must be selected before export.");
  }

  let cellWidth = 1;
  let cellHeight = 1;
  for (const animation of orderedAnimations) {
    for (const frame of animation.frames) {
      cellWidth = Math.max(cellWidth, frame.width);
      cellHeight = Math.max(cellHeight, frame.height);
    }
  }

  const outputDir = path.join(outputRoot, characterKey);
  const zipPath = path.join(outputRoot, `${characterKey}.zip`);
  const bodyPath = path.join(outputDir, "body.webp");
  const spritesheetPath = path.join(outputDir, "spritesheet.webp");
  const atlasPath = path.join(outputDir, "animations.json");
  const notesPath = path.join(outputDir, "import-notes.md");

  await fsp.rm(outputDir, { recursive: true, force: true });
  await fsp.mkdir(outputDir, { recursive: true });

  await sharp(bodyFile.path)
    .webp({ lossless: true, effort: 6 })
    .toFile(bodyPath);

  const maxColumns = Math.max(
    1,
    ...orderedAnimations.map((animation) => animation.frames.length),
  );
  const spritesheetWidth = maxColumns * cellWidth;
  const spritesheetHeight = orderedAnimations.length * cellHeight;
  const composites = [];
  const atlasFrames = [];
  const frameCounts = {};
  const fpsByAnimation = {};

  for (let row = 0; row < orderedAnimations.length; row += 1) {
    const animation = orderedAnimations[row];
    frameCounts[animation.atlasPrefix] = animation.frames.length;
    fpsByAnimation[animation.atlasPrefix] = animation.fps;

    for (let column = 0; column < animation.frames.length; column += 1) {
      const frame = animation.frames[column];
      const fileName = `${animation.atlasPrefix}${String(column).padStart(ZERO_PAD, "0")}`;
      const x = column * cellWidth;
      const y = row * cellHeight;

      const normalizedBuffer = await createNormalizedFrameBuffer({
        inputPath: frame.absolutePath,
        inputWidth: frame.width,
        inputHeight: frame.height,
        cellWidth,
        cellHeight,
      });

      composites.push({
        input: normalizedBuffer,
        left: x,
        top: y,
      });

      atlasFrames.push({
        filename: fileName,
        frame: { x, y, w: cellWidth, h: cellHeight },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: cellWidth, h: cellHeight },
        sourceSize: { w: cellWidth, h: cellHeight },
      });
    }
  }

  await sharp({
    create: {
      width: spritesheetWidth,
      height: spritesheetHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite(composites)
    .webp({ lossless: true, effort: 6 })
    .toFile(spritesheetPath);

  await fsp.writeFile(
    atlasPath,
    JSON.stringify(
      {
        frames: atlasFrames,
        meta: {
          app: "Bro Battles Spritesheet Generator",
          version: "2.0.0",
          image: "spritesheet.webp",
          size: { w: spritesheetWidth, h: spritesheetHeight },
          scale: 1,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  await fsp.writeFile(
    notesPath,
    buildImportNotes({
      characterKey,
      keyColor: manifest.keyColor,
      tolerance: manifest.tolerance,
      fpsByAnimation,
      frameCounts,
      cellWidth,
      cellHeight,
    }),
    "utf8",
  );

  await createZip(outputDir, zipPath);

  return {
    characterKey,
    generatedAt: new Date().toISOString(),
    keyColor: manifest.keyColor,
    tolerance: manifest.tolerance,
    cellSize: { width: cellWidth, height: cellHeight },
    frameCounts,
    fpsByAnimation,
  };
}

function buildImportNotes({
  characterKey,
  keyColor,
  tolerance,
  fpsByAnimation,
  frameCounts,
  cellWidth,
  cellHeight,
}) {
  return [
    `# Import Notes for ${characterKey}`,
    "",
    "## Generated files",
    "- body.webp",
    "- spritesheet.webp",
    "- animations.json",
    "",
    "## Generation settings",
    `- Global frame size: ${cellWidth}x${cellHeight}`,
    `- Key color: ${keyColor}`,
    `- Key tolerance: ${tolerance}`,
    "",
    "## Animation FPS",
    ...Object.entries(fpsByAnimation).map(([name, fps]) => `- ${name}: ${fps}`),
    "",
    "## Exported frame counts",
    ...Object.entries(frameCounts).map(([name, count]) => `- ${name}: ${count}`),
    "",
    "## Bro Battles import",
    `Copy this folder into ../public/assets/${characterKey}/ in the parent Bro Battles repo.`,
    "",
    "Existing UI paths in Bro Battles already expect:",
    `- /assets/${characterKey}/body.webp`,
    `- /assets/${characterKey}/spritesheet.webp`,
    `- /assets/${characterKey}/animations.json`,
    "",
  ].join("\n");
}

async function readSessionMetadata(sessionId, tempRoot) {
  const raw = await fsp.readFile(
    path.join(getSessionRoot(tempRoot, sessionId), "metadata.json"),
    "utf8",
  );
  return JSON.parse(raw);
}

async function saveSessionMetadata(tempRoot, sessionId, metadata) {
  await fsp.writeFile(
    path.join(getSessionRoot(tempRoot, sessionId), "metadata.json"),
    JSON.stringify(metadata, null, 2),
    "utf8",
  );
}

function getSessionRoot(tempRoot, sessionId) {
  return path.join(tempRoot, "sessions", sessionId);
}

async function extractFrames(videoPath, outputDir, fps) {
  await fsp.mkdir(outputDir, { recursive: true });
  const outputPattern = path.join(outputDir, "frame-%04d.png");

  await runCommand("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-i",
    videoPath,
    "-vf",
    `fps=${clampFps(fps)}`,
    outputPattern,
  ]);
}

async function listPngFiles(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".png"))
    .map((entry) => path.join(dir, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function removeBackgroundAndTrim({
  inputPath,
  outputPath,
  color,
  tolerance,
}) {
  const { data, info } = await sharp(inputPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const pixels = Buffer.from(data);
  let minX = info.width;
  let minY = info.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const offset = (y * info.width + x) * info.channels;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];

      if (
        Math.abs(r - color.r) <= tolerance &&
        Math.abs(g - color.g) <= tolerance &&
        Math.abs(b - color.b) <= tolerance
      ) {
        pixels[offset + 3] = 0;
      }

      if (pixels[offset + 3] > 0) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const keyedBuffer = await sharp(pixels, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();

  if (maxX === -1 || maxY === -1) {
    await sharp({
      create: {
        width: 1,
        height: 1,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toFile(outputPath);

    return { width: 1, height: 1 };
  }

  const width = maxX - minX + 1;
  const height = maxY - minY + 1;

  await sharp(keyedBuffer)
    .extract({ left: minX, top: minY, width, height })
    .png()
    .toFile(outputPath);

  return { width, height };
}

async function createNormalizedFrameBuffer({
  inputPath,
  inputWidth,
  inputHeight,
  cellWidth,
  cellHeight,
}) {
  const left = Math.max(0, Math.floor((cellWidth - inputWidth) / 2));
  const top = Math.max(0, cellHeight - inputHeight);

  return sharp({
    create: {
      width: cellWidth,
      height: cellHeight,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: inputPath,
        left,
        top,
      },
    ])
    .png()
    .toBuffer();
}

function createZip(sourceDir, zipPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    output.on("close", resolve);
    output.on("error", reject);
    archive.on("error", reject);

    archive.pipe(output);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "ignore", "pipe"],
    });
    let stderr = "";

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with status ${code}.`));
    });
  });
}

module.exports = {
  ANIMATION_DEFS,
  DEFAULT_FPS,
  DEFAULT_KEY_COLOR,
  DEFAULT_TOLERANCE,
  addAnimationToSession,
  createSession,
  ensureBaseDirectories,
  exportBundleFromManifest,
  readSessionMetadata,
  sanitizeCharacterKey,
  updateSessionDetails,
};
