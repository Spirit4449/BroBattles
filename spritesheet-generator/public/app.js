const ANIMATIONS = [
  { atlasPrefix: "idle", label: "Idle", singleFrame: false },
  { atlasPrefix: "running", label: "Running", singleFrame: false },
  { atlasPrefix: "jumping", label: "Jumping", singleFrame: false },
  { atlasPrefix: "falling", label: "Falling", singleFrame: false },
  { atlasPrefix: "attack", label: "Attack", singleFrame: false },
  { atlasPrefix: "dying", label: "Dead", singleFrame: false },
  { atlasPrefix: "wall", label: "Wall Jump", singleFrame: true },
  { atlasPrefix: "special", label: "Special", singleFrame: false },
];

const state = {
  sessionId: null,
  characterKey: "",
  keyColor: "#00ff00",
  tolerance: 26,
  bodySelection: null,
  animations: Object.fromEntries(
    ANIMATIONS.map((animation) => [
      animation.atlasPrefix,
      {
        ...animation,
        fps: 15,
        frames: [],
        currentPreviewIndex: 0,
        currentEditorIndex: 0,
        nextPreviewAt: 0,
      },
    ]),
  ),
  activeEditorPrefix: null,
  activeTool: "brush",
  isDrawing: false,
  playbackTimer: null,
};

const refs = {
  characterName: document.getElementById("character-name"),
  keyColor: document.getElementById("key-color"),
  tolerance: document.getElementById("tolerance"),
  toleranceOutput: document.getElementById("tolerance-output"),
  newSessionButton: document.getElementById("new-session-button"),
  exportButton: document.getElementById("export-button"),
  statusText: document.getElementById("status-text"),
  workspaceSummary: document.getElementById("workspace-summary"),
  animationGrid: document.getElementById("animation-grid"),
  resultCard: document.getElementById("result-card"),
  resultBody: document.getElementById("result-body"),
  editorModal: document.getElementById("editor-modal"),
  modalEyebrow: document.getElementById("modal-eyebrow"),
  modalTitle: document.getElementById("modal-title"),
  closeEditorButton: document.getElementById("close-editor-button"),
  editorFps: document.getElementById("editor-fps"),
  toolBrush: document.getElementById("tool-brush"),
  toolEraser: document.getElementById("tool-eraser"),
  brushColor: document.getElementById("brush-color"),
  brushSize: document.getElementById("brush-size"),
  brushSizeOutput: document.getElementById("brush-size-output"),
  prevFrameButton: document.getElementById("prev-frame-button"),
  nextFrameButton: document.getElementById("next-frame-button"),
  importFrameButton: document.getElementById("import-frame-button"),
  importFrameInput: document.getElementById("import-frame-input"),
  addFrameButton: document.getElementById("add-frame-button"),
  duplicateFrameButton: document.getElementById("duplicate-frame-button"),
  deleteFrameButton: document.getElementById("delete-frame-button"),
  setBodyButton: document.getElementById("set-body-button"),
  frameMeta: document.getElementById("frame-meta"),
  frameEditorCanvas: document.getElementById("frame-editor-canvas"),
  timelineStrip: document.getElementById("timeline-strip"),
};

const animationCardRefs = new Map();

function setStatus(message, isError = false) {
  refs.statusText.textContent = message;
  refs.statusText.classList.toggle("is-error", isError);
}

function clampBrushSize(value) {
  if (!Number.isFinite(value)) return 1;
  return Math.max(1, Math.min(32, Math.round(value)));
}

function getAnimationState(prefix) {
  return state.animations[prefix];
}

function cloneCanvas(sourceCanvas) {
  const canvas = document.createElement("canvas");
  canvas.width = sourceCanvas.width;
  canvas.height = sourceCanvas.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sourceCanvas, 0, 0);
  return canvas;
}

function createCanvasFromImage(image) {
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas;
}

function frameToThumbnail(frame, size = 74) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, size, size);

  const scale = Math.min(size / frame.canvas.width, size / frame.canvas.height);
  const drawWidth = Math.max(1, Math.round(frame.canvas.width * scale));
  const drawHeight = Math.max(1, Math.round(frame.canvas.height * scale));
  const x = Math.floor((size - drawWidth) / 2);
  const y = Math.floor((size - drawHeight) / 2);
  ctx.drawImage(frame.canvas, x, y, drawWidth, drawHeight);
  return canvas;
}

async function loadImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load ${url}`));
    image.src = /^blob:|^data:/i.test(url) ? url : `${url}?t=${Date.now()}`;
  });
}

async function ensureSession() {
  if (state.sessionId) return state.sessionId;

  const response = await fetch("/api/session/init", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      characterName: refs.characterName.value,
      keyColor: refs.keyColor.value,
      tolerance: Number(refs.tolerance.value),
    }),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Unable to create session.");
  }

  applySessionMetadata(payload.session);
  return state.sessionId;
}

function applySessionMetadata(session) {
  state.sessionId = session.sessionId;
  state.characterKey = session.characterKey;
  state.keyColor = session.keyColor;
  state.tolerance = session.tolerance;

  refs.characterName.value = session.characterKey;
  refs.keyColor.value = session.keyColor;
  refs.tolerance.value = String(session.tolerance);
  refs.toleranceOutput.value = String(session.tolerance);

  for (const animation of session.animations || []) {
    const existing = getAnimationState(animation.atlasPrefix);
    if (!existing) continue;
    existing.fps = animation.fps || existing.fps;
  }

  renderWorkspaceSummary();
  renderAnimationGrid();
}

function renderWorkspaceSummary() {
  const loadedCount = ANIMATIONS.filter(
    (animation) => getAnimationState(animation.atlasPrefix).frames.length > 0,
  ).length;
  const bodyLabel = state.bodySelection
    ? `${state.bodySelection.atlasPrefix} #${state.bodySelection.index + 1}`
    : "Not selected";

  refs.workspaceSummary.innerHTML = `
    <div class="summary-metric">
      <span class="metric-label">Session</span>
      <strong>${state.sessionId ? "Active" : "Not created"}</strong>
    </div>
    <div class="summary-metric">
      <span class="metric-label">Character</span>
      <strong>${state.characterKey || "Not set"}</strong>
    </div>
    <div class="summary-metric">
      <span class="metric-label">Animations Loaded</span>
      <strong>${loadedCount} / ${ANIMATIONS.length}</strong>
    </div>
    <div class="summary-metric">
      <span class="metric-label">Key Color</span>
      <strong>${refs.keyColor.value}</strong>
    </div>
    <div class="summary-metric">
      <span class="metric-label">Body Frame</span>
      <strong>${bodyLabel}</strong>
    </div>
  `;
}

function renderAnimationGrid() {
  refs.animationGrid.innerHTML = "";
  animationCardRefs.clear();

  for (const animation of ANIMATIONS) {
    const animState = getAnimationState(animation.atlasPrefix);
    const card = document.createElement("article");
    card.className = "animation-card";
    card.innerHTML = `
      <div class="animation-card-header">
        <div>
          <h3>${animation.label}</h3>
          <p>${animState.frames.length} frame${animState.frames.length === 1 ? "" : "s"} ready</p>
        </div>
        <div class="selection-badge">${animState.singleFrame ? "Single frame" : "Timeline edit"}</div>
      </div>

      <div class="animation-preview-stage">
        <canvas data-role="preview-canvas"></canvas>
      </div>

      <div class="card-controls">
        <label class="field compact-field">
          <span>FPS</span>
          <input data-role="fps-input" type="number" min="1" max="60" step="1" value="${animState.fps}" />
        </label>

        <label class="field compact-field grow">
          <span>Upload Video</span>
          <input data-role="file-input" type="file" accept="video/*" />
        </label>
      </div>

      <div class="card-actions">
        <button data-role="upload-button" type="button">Process ${animation.label}</button>
        <button data-role="edit-button" type="button" class="secondary-button" ${animState.frames.length ? "" : "disabled"}>
          Open Editor
        </button>
      </div>
    `;

    refs.animationGrid.appendChild(card);

    const previewCanvas = card.querySelector('[data-role="preview-canvas"]');
    const fpsInput = card.querySelector('[data-role="fps-input"]');
    const fileInput = card.querySelector('[data-role="file-input"]');
    const uploadButton = card.querySelector('[data-role="upload-button"]');
    const editButton = card.querySelector('[data-role="edit-button"]');
    const countText = card.querySelector(".animation-card-header p");

    fpsInput.addEventListener("input", () => {
      animState.fps = clampFps(Number(fpsInput.value));
      fpsInput.value = String(animState.fps);
      restartPlaybackLoop();
      if (state.activeEditorPrefix === animation.atlasPrefix) {
        refs.editorFps.value = String(animState.fps);
      }
    });

    uploadButton.addEventListener("click", async () => {
      try {
        const file = fileInput.files?.[0];
        if (!file) {
          throw new Error(`Choose a video for ${animation.label} first.`);
        }

        uploadButton.disabled = true;
        uploadButton.textContent = "Processing...";
        setStatus(`Processing ${animation.label}...`);

        const sessionId = await ensureSession();
        const formData = new FormData();
        formData.append("video", file);
        formData.append("atlasPrefix", animation.atlasPrefix);
        formData.append("fps", String(animState.fps));
        formData.append("characterName", refs.characterName.value);
        formData.append("keyColor", refs.keyColor.value);
        formData.append("tolerance", refs.tolerance.value);

        const response = await fetch(`/api/session/${sessionId}/animation`, {
          method: "POST",
          body: formData,
        });

        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.error || `Failed to process ${animation.label}.`);
        }

        const sessionAnimation = payload.session.animations.find(
          (candidate) => candidate.atlasPrefix === animation.atlasPrefix,
        );
        await hydrateAnimationFrames(animation.atlasPrefix, sessionAnimation);
        refreshAnimationCardMeta(animation.atlasPrefix);
        renderAnimationPreview(animation.atlasPrefix);
        renderWorkspaceSummary();
        restartPlaybackLoop();
        setStatus(`${animation.label} is ready to edit.`);
        openEditor(animation.atlasPrefix);
      } catch (error) {
        setStatus(error.message || `Failed to process ${animation.label}.`, true);
      } finally {
        uploadButton.disabled = false;
        uploadButton.textContent = `Process ${animation.label}`;
      }
    });

    editButton.addEventListener("click", () => openEditor(animation.atlasPrefix));
    previewCanvas.addEventListener("click", () => {
      if (animState.frames.length) {
        openEditor(animation.atlasPrefix);
      }
    });

    animationCardRefs.set(animation.atlasPrefix, {
      previewCanvas,
      fpsInput,
      fileInput,
      uploadButton,
      editButton,
      countText,
    });

    renderAnimationPreview(animation.atlasPrefix);
  }
}

async function hydrateAnimationFrames(prefix, sessionAnimation) {
  const animState = getAnimationState(prefix);
  animState.fps = sessionAnimation.fps || animState.fps;
  animState.frames = [];

  for (let index = 0; index < sessionAnimation.frames.length; index += 1) {
    const frame = sessionAnimation.frames[index];
    const image = await loadImage(frame.url);
    const canvas = createCanvasFromImage(image);
    animState.frames.push({
      id: frame.id || `${prefix}-${index}`,
      fileName: frame.fileName,
      canvas,
      width: canvas.width,
      height: canvas.height,
    });
  }

  animState.currentPreviewIndex = 0;
  animState.currentEditorIndex = 0;
  animState.nextPreviewAt = performance.now();
  if (!state.bodySelection) {
    state.bodySelection = { atlasPrefix: prefix, index: 0 };
  }
}

function renderAnimationPreview(prefix) {
  const refsForCard = animationCardRefs.get(prefix);
  const animState = getAnimationState(prefix);
  if (!refsForCard) return;

  const canvas = refsForCard.previewCanvas;
  const ctx = canvas.getContext("2d");
  const frame = animState.frames[animState.currentPreviewIndex] || animState.frames[0];

  const size = 180;
  canvas.width = size;
  canvas.height = size;
  ctx.clearRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = false;

  if (!frame) return;

  const scale = Math.min(size / frame.canvas.width, size / frame.canvas.height);
  const drawWidth = Math.max(1, Math.round(frame.canvas.width * scale));
  const drawHeight = Math.max(1, Math.round(frame.canvas.height * scale));
  const x = Math.floor((size - drawWidth) / 2);
  const y = Math.floor((size - drawHeight) / 2);
  ctx.drawImage(frame.canvas, x, y, drawWidth, drawHeight);
}

function refreshAnimationCardMeta(prefix) {
  const cardRefs = animationCardRefs.get(prefix);
  const animState = getAnimationState(prefix);
  if (!cardRefs) return;

  cardRefs.countText.textContent = `${animState.frames.length} frame${
    animState.frames.length === 1 ? "" : "s"
  } ready`;
  cardRefs.editButton.disabled = animState.frames.length === 0;
}

function restartPlaybackLoop() {
  if (state.playbackTimer) {
    window.clearInterval(state.playbackTimer);
  }

  state.playbackTimer = window.setInterval(() => {
    const now = performance.now();
    for (const animation of ANIMATIONS) {
      const animState = getAnimationState(animation.atlasPrefix);
      if (!animState.frames.length) continue;
      if (now < animState.nextPreviewAt) continue;

      animState.currentPreviewIndex =
        (animState.currentPreviewIndex + 1) % animState.frames.length;
      animState.nextPreviewAt = now + 1000 / Math.max(1, animState.fps || 15);
      renderAnimationPreview(animation.atlasPrefix);
    }
  }, 50);
}

function openEditor(prefix) {
  const animState = getAnimationState(prefix);
  if (!animState.frames.length) {
    setStatus("Upload and process an animation before opening the editor.", true);
    return;
  }

  state.activeEditorPrefix = prefix;
  refs.modalEyebrow.textContent = `Animation Editor`;
  refs.modalTitle.textContent = animState.label;
  refs.editorFps.value = String(animState.fps);
  refs.importFrameInput.value = "";
  refs.editorModal.classList.remove("hidden");
  refs.editorModal.setAttribute("aria-hidden", "false");
  renderEditor();
}

function closeEditor() {
  state.activeEditorPrefix = null;
  state.isDrawing = false;
  refs.editorModal.classList.add("hidden");
  refs.editorModal.setAttribute("aria-hidden", "true");
}

function renderEditor() {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;

  const animState = getAnimationState(prefix);
  const frame = animState.frames[animState.currentEditorIndex];
  if (!frame) return;

  refs.frameMeta.textContent = `Frame ${animState.currentEditorIndex + 1} of ${animState.frames.length}`;
  refs.editorFps.value = String(animState.fps);
  refs.prevFrameButton.disabled = animState.frames.length <= 1;
  refs.nextFrameButton.disabled = animState.frames.length <= 1;
  drawFrameOnEditorCanvas(frame.canvas);
  renderTimeline();
}

function drawFrameOnEditorCanvas(sourceCanvas) {
  const scale = Math.max(
    1,
    Math.floor(
      Math.min(
        520 / Math.max(1, sourceCanvas.width),
        520 / Math.max(1, sourceCanvas.height),
      ),
    ),
  );
  refs.frameEditorCanvas.width = sourceCanvas.width;
  refs.frameEditorCanvas.height = sourceCanvas.height;
  refs.frameEditorCanvas.style.width = `${sourceCanvas.width * scale}px`;
  refs.frameEditorCanvas.style.height = `${sourceCanvas.height * scale}px`;

  const ctx = refs.frameEditorCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, refs.frameEditorCanvas.width, refs.frameEditorCanvas.height);
  ctx.drawImage(sourceCanvas, 0, 0);
}

function renderTimeline() {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;

  const animState = getAnimationState(prefix);
  refs.timelineStrip.innerHTML = "";

  animState.frames.forEach((frame, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "timeline-frame";
    if (index === animState.currentEditorIndex) {
      button.classList.add("is-current");
    }
    if (
      state.bodySelection &&
      state.bodySelection.atlasPrefix === prefix &&
      state.bodySelection.index === index
    ) {
      button.classList.add("is-body");
    }

    const thumb = frameToThumbnail(frame);
    thumb.className = "timeline-thumb";

    const label = document.createElement("span");
    label.textContent = String(index + 1);

    button.appendChild(thumb);
    button.appendChild(label);
    button.addEventListener("click", () => selectEditorFrame(prefix, index));
    refs.timelineStrip.appendChild(button);
  });
}

function selectEditorFrame(prefix, index) {
  const animState = getAnimationState(prefix);
  if (!animState.frames.length) return;
  animState.currentEditorIndex = Math.max(0, Math.min(index, animState.frames.length - 1));
  renderEditor();
}

function getEditorFrame() {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return null;
  const animState = getAnimationState(prefix);
  return animState.frames[animState.currentEditorIndex] || null;
}

function syncFrameFromEditorCanvas() {
  const prefix = state.activeEditorPrefix;
  const frame = getEditorFrame();
  if (!prefix || !frame) return;

  frame.canvas = cloneCanvas(refs.frameEditorCanvas);
  frame.width = frame.canvas.width;
  frame.height = frame.canvas.height;
  renderAnimationPreview(prefix);
  renderTimeline();
}

function getCanvasPoint(event) {
  const rect = refs.frameEditorCanvas.getBoundingClientRect();
  const scaleX = refs.frameEditorCanvas.width / rect.width;
  const scaleY = refs.frameEditorCanvas.height / rect.height;
  return {
    x: Math.floor((event.clientX - rect.left) * scaleX),
    y: Math.floor((event.clientY - rect.top) * scaleY),
  };
}

function applyBrushStroke(point) {
  const ctx = refs.frameEditorCanvas.getContext("2d");
  const size = clampBrushSize(Number(refs.brushSize.value));
  const half = Math.floor(size / 2);

  if (state.activeTool === "eraser") {
    ctx.clearRect(point.x - half, point.y - half, size, size);
    return;
  }

  ctx.fillStyle = refs.brushColor.value;
  ctx.fillRect(point.x - half, point.y - half, size, size);
}

async function importFrameImage() {
  const prefix = state.activeEditorPrefix;
  const file = refs.importFrameInput.files?.[0];
  if (!prefix || !file) return;

  const objectUrl = URL.createObjectURL(file);

  try {
    const image = await loadImage(objectUrl);
    const animState = getAnimationState(prefix);
    const insertionIndex = animState.currentEditorIndex + 1;
    const canvas = createCanvasFromImage(image);

    animState.frames.splice(insertionIndex, 0, {
      id: `${prefix}-${cryptoRandom()}`,
      fileName: `${prefix}-import-${cryptoRandom()}`,
      canvas,
      width: canvas.width,
      height: canvas.height,
    });

    animState.currentEditorIndex = insertionIndex;
    renderEditor();
    refreshAnimationCardMeta(prefix);
    renderAnimationPreview(prefix);
    renderWorkspaceSummary();
    setStatus(`Imported a frame into ${animState.label}.`);
  } catch (error) {
    setStatus(error.message || "Unable to import frame image.", true);
  } finally {
    URL.revokeObjectURL(objectUrl);
    refs.importFrameInput.value = "";
  }
}

function addBlankFrame() {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;
  const animState = getAnimationState(prefix);
  const current = getEditorFrame();
  const width = current?.canvas.width || 64;
  const height = current?.canvas.height || 64;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, width, height);

  const insertionIndex = animState.currentEditorIndex + 1;
  animState.frames.splice(insertionIndex, 0, {
    id: `${prefix}-${cryptoRandom()}`,
    fileName: `${prefix}-custom-${cryptoRandom()}`,
    canvas,
    width,
    height,
  });
  animState.currentEditorIndex = insertionIndex;
  renderEditor();
  refreshAnimationCardMeta(prefix);
  renderAnimationPreview(prefix);
}

function duplicateFrame() {
  const prefix = state.activeEditorPrefix;
  const frame = getEditorFrame();
  if (!prefix || !frame) return;

  const animState = getAnimationState(prefix);
  const insertionIndex = animState.currentEditorIndex + 1;
  animState.frames.splice(insertionIndex, 0, {
    id: `${prefix}-${cryptoRandom()}`,
    fileName: `${prefix}-copy-${cryptoRandom()}`,
    canvas: cloneCanvas(frame.canvas),
    width: frame.canvas.width,
    height: frame.canvas.height,
  });
  animState.currentEditorIndex = insertionIndex;
  renderEditor();
  refreshAnimationCardMeta(prefix);
  renderAnimationPreview(prefix);
}

function stepEditorFrame(direction) {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;
  const animState = getAnimationState(prefix);
  if (!animState.frames.length) return;

  selectEditorFrame(
    prefix,
    (animState.currentEditorIndex + direction + animState.frames.length) % animState.frames.length,
  );
}

function deleteCurrentFrame() {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;
  const animState = getAnimationState(prefix);
  if (animState.frames.length <= 1) {
    setStatus("Each loaded animation needs at least one frame.", true);
    return;
  }

  animState.frames.splice(animState.currentEditorIndex, 1);
  if (state.bodySelection?.atlasPrefix === prefix) {
    if (state.bodySelection.index === animState.currentEditorIndex) {
      state.bodySelection.index = Math.max(0, animState.currentEditorIndex - 1);
    } else if (state.bodySelection.index > animState.currentEditorIndex) {
      state.bodySelection.index -= 1;
    }
  }
  animState.currentEditorIndex = Math.max(
    0,
    Math.min(animState.currentEditorIndex, animState.frames.length - 1),
  );
  renderEditor();
  refreshAnimationCardMeta(prefix);
  renderAnimationPreview(prefix);
  renderWorkspaceSummary();
}

function clampFps(value) {
  if (!Number.isFinite(value)) return 15;
  return Math.max(1, Math.min(60, Math.round(value)));
}

function cryptoRandom() {
  return Math.random().toString(36).slice(2, 8);
}

async function canvasToBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Failed to convert frame to blob."));
    }, "image/png");
  });
}

async function exportBundle() {
  if (!state.sessionId) {
    throw new Error("Create a session and upload at least one animation first.");
  }

  const loadedAnimations = ANIMATIONS
    .map((animation) => getAnimationState(animation.atlasPrefix))
    .filter((animation) => animation.frames.length > 0);

  if (!loadedAnimations.length) {
    throw new Error("Upload at least one animation before exporting.");
  }

  const formData = new FormData();
  const manifest = {
    characterName: refs.characterName.value,
    keyColor: refs.keyColor.value,
    tolerance: Number(refs.tolerance.value),
    animations: [],
    bodyFrameField: null,
  };

  let bodyAssigned = false;

  for (const animation of loadedAnimations) {
    const entry = {
      atlasPrefix: animation.atlasPrefix,
      label: animation.label,
      fps: animation.fps,
      frames: [],
    };

    for (let index = 0; index < animation.frames.length; index += 1) {
      const frame = animation.frames[index];
      const uploadField = `${animation.atlasPrefix}_${index}_${cryptoRandom()}`;
      const blob = await canvasToBlob(frame.canvas);
      formData.append(uploadField, blob, `${uploadField}.png`);
      entry.frames.push({ uploadField });

      if (
        !bodyAssigned &&
        state.bodySelection &&
        state.bodySelection.atlasPrefix === animation.atlasPrefix &&
        state.bodySelection.index === index
      ) {
        manifest.bodyFrameField = uploadField;
        bodyAssigned = true;
      }
    }

    manifest.animations.push(entry);
  }

  if (!manifest.bodyFrameField) {
    const firstAnimation = manifest.animations[0];
    manifest.bodyFrameField = firstAnimation.frames[0].uploadField;
  }

  formData.append("manifest", JSON.stringify(manifest));

  const response = await fetch("/api/export", {
    method: "POST",
    body: formData,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Export failed.");
  }
  return payload;
}

function renderExportResult(payload) {
  refs.resultCard.classList.remove("is-empty");
  const fpsLines = Object.entries(payload.fpsByAnimation || {})
    .map(([name, fps]) => `<li><span>${name}</span><strong>${fps} fps</strong></li>`)
    .join("");

  refs.resultBody.innerHTML = `
    <div class="result-summary">
      <div class="summary-metric">
        <span class="metric-label">Character</span>
        <strong>${payload.character}</strong>
      </div>
      <div class="summary-metric">
        <span class="metric-label">Frame Size</span>
        <strong>${payload.cellSize.width} x ${payload.cellSize.height}</strong>
      </div>
      <div class="summary-metric">
        <span class="metric-label">Animations</span>
        <strong>${Object.keys(payload.frameCounts || {}).length}</strong>
      </div>
      <div class="summary-metric">
        <span class="metric-label">Exported</span>
        <strong>${new Date(payload.generatedAt).toLocaleTimeString()}</strong>
      </div>
    </div>

    <div class="preview-grid">
      <article class="preview-card">
        <h3>Body</h3>
        <img src="${payload.urls.body}?t=${Date.now()}" alt="body preview" />
        <a href="${payload.urls.body}" target="_blank" rel="noreferrer">Open body.webp</a>
      </article>

      <article class="preview-card">
        <h3>Spritesheet</h3>
        <img src="${payload.urls.spritesheet}?t=${Date.now()}" alt="spritesheet preview" />
        <a href="${payload.urls.spritesheet}" target="_blank" rel="noreferrer">Open spritesheet.webp</a>
      </article>
    </div>

    <div class="link-grid">
      <a href="${payload.urls.zip}">Download zip bundle</a>
      <a href="${payload.urls.atlas}" target="_blank" rel="noreferrer">Open animations.json</a>
      <a href="${payload.urls.notes}" target="_blank" rel="noreferrer">Open import notes</a>
    </div>

    <div class="count-card">
      <h3>Animation FPS</h3>
      <ul>${fpsLines}</ul>
    </div>
  `;
}

refs.toleranceOutput.value = refs.tolerance.value;
refs.brushSizeOutput.value = refs.brushSize.value;
renderWorkspaceSummary();
renderAnimationGrid();
restartPlaybackLoop();

refs.tolerance.addEventListener("input", () => {
  refs.toleranceOutput.value = refs.tolerance.value;
});

refs.newSessionButton.addEventListener("click", async () => {
  try {
    refs.newSessionButton.disabled = true;
    refs.newSessionButton.textContent = "Creating...";
    const sessionId = await ensureSession();
    setStatus(`Session ${sessionId} ready. Upload any animation to start editing.`);
  } catch (error) {
    setStatus(error.message || "Unable to create session.", true);
  } finally {
    refs.newSessionButton.disabled = false;
    refs.newSessionButton.textContent = "Create Session";
  }
});

refs.exportButton.addEventListener("click", async () => {
  try {
    refs.exportButton.disabled = true;
    refs.exportButton.textContent = "Exporting...";
    setStatus("Exporting edited frames into a bundle...");
    const payload = await exportBundle();
    renderExportResult(payload);
    setStatus(`Bundle exported for ${payload.character}.`);
  } catch (error) {
    setStatus(error.message || "Export failed.", true);
  } finally {
    refs.exportButton.disabled = false;
    refs.exportButton.textContent = "Export Bundle";
  }
});

refs.closeEditorButton.addEventListener("click", closeEditor);
refs.editorModal.addEventListener("click", (event) => {
  if (event.target instanceof HTMLElement && event.target.dataset.closeEditor === "true") {
    closeEditor();
  }
});

refs.toolBrush.addEventListener("click", () => {
  state.activeTool = "brush";
  refs.toolBrush.classList.add("is-active");
  refs.toolEraser.classList.remove("is-active");
});

refs.toolEraser.addEventListener("click", () => {
  state.activeTool = "eraser";
  refs.toolEraser.classList.add("is-active");
  refs.toolBrush.classList.remove("is-active");
});

refs.brushSize.addEventListener("input", () => {
  refs.brushSize.value = String(clampBrushSize(Number(refs.brushSize.value)));
  refs.brushSizeOutput.value = refs.brushSize.value;
});

refs.editorFps.addEventListener("input", () => {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;
  const animState = getAnimationState(prefix);
  animState.fps = clampFps(Number(refs.editorFps.value));
  refs.editorFps.value = String(animState.fps);
  const cardRefs = animationCardRefs.get(prefix);
  if (cardRefs) cardRefs.fpsInput.value = String(animState.fps);
});

refs.addFrameButton.addEventListener("click", addBlankFrame);
refs.duplicateFrameButton.addEventListener("click", duplicateFrame);
refs.deleteFrameButton.addEventListener("click", deleteCurrentFrame);
refs.prevFrameButton.addEventListener("click", () => stepEditorFrame(-1));
refs.nextFrameButton.addEventListener("click", () => stepEditorFrame(1));
refs.importFrameButton.addEventListener("click", () => refs.importFrameInput.click());
refs.importFrameInput.addEventListener("change", importFrameImage);
refs.setBodyButton.addEventListener("click", () => {
  const prefix = state.activeEditorPrefix;
  if (!prefix) return;
  const animState = getAnimationState(prefix);
  state.bodySelection = {
    atlasPrefix: prefix,
    index: animState.currentEditorIndex,
  };
  renderTimeline();
  renderWorkspaceSummary();
  setStatus(
    `Body export frame set to ${prefix} frame ${animState.currentEditorIndex + 1}.`,
  );
});

refs.frameEditorCanvas.addEventListener("mousedown", (event) => {
  if (!state.activeEditorPrefix) return;
  state.isDrawing = true;
  applyBrushStroke(getCanvasPoint(event));
  syncFrameFromEditorCanvas();
});

refs.frameEditorCanvas.addEventListener("mousemove", (event) => {
  if (!state.isDrawing || !state.activeEditorPrefix) return;
  applyBrushStroke(getCanvasPoint(event));
  syncFrameFromEditorCanvas();
});

window.addEventListener("mouseup", () => {
  state.isDrawing = false;
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !refs.editorModal.classList.contains("hidden")) {
    closeEditor();
    return;
  }

  if (refs.editorModal.classList.contains("hidden")) {
    return;
  }

  if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepEditorFrame(-1);
  }

  if (event.key === "ArrowRight") {
    event.preventDefault();
    stepEditorFrame(1);
  }
});
