import {
  getMapEditorTextureKeys,
  getMapSpawnAnchors,
  getMapSpawnConfig,
} from "../maps/manifest";
import { getSpawnPreviewPoint } from "../maps/mapUtils";

function cloneJson(v) {
  try {
    return JSON.parse(JSON.stringify(v));
  } catch (_) {
    return {};
  }
}

function round2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function isTextInputTarget(t) {
  const tag = String(t?.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select";
}

function setZoneInteractive(PhaserNs, zone, w, h) {
  zone.setInteractive(
    new PhaserNs.Geom.Rectangle(-w / 2, -h / 2, w, h),
    PhaserNs.Geom.Rectangle.Contains,
  );
}

function createZone(scene, PhaserNs, x, y, width = 120, height = 22) {
  const zone = scene.add.zone(x, y, width, height);
  scene.physics.add.existing(zone, true);
  zone.body.checkCollision.up = true;
  zone.body.checkCollision.down = true;
  zone.body.checkCollision.left = true;
  zone.body.checkCollision.right = true;
  setZoneInteractive(PhaserNs, zone, width, height);
  return zone;
}

function updateBodyFromGameObject(go) {
  try {
    if (go?.body && typeof go.body.updateFromGameObject === "function") {
      go.body.updateFromGameObject();
    }
  } catch (_) {}
}

function setSpriteBodySizeFromDisplaySize(go, width, height) {
  if (!go?.body) return;
  const scaleX = Math.max(0.0001, Math.abs(Number(go.scaleX) || 1));
  const scaleY = Math.max(0.0001, Math.abs(Number(go.scaleY) || 1));
  const rawW = Math.max(1, Number(width) / scaleX);
  const rawH = Math.max(1, Number(height) / scaleY);
  go.body.setSize(rawW, rawH);
}

function nearestWithThreshold(value, candidates, threshold = 40) {
  let best = value;
  let bestDist = threshold + 1;
  for (const c of candidates) {
    if (!Number.isFinite(c)) continue;
    const d = Math.abs(c - value);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function findNearestCandidate(value, candidates, threshold = 40) {
  let best = null;
  let bestDist = threshold + 1;
  for (const c of candidates) {
    if (!Number.isFinite(c)) continue;
    const d = Math.abs(c - value);
    if (d < bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

function clampNum(v, min, max) {
  const n = Number(v);
  if (!Number.isFinite(n)) return min;
  if (Number.isFinite(min) && n < min) return min;
  if (Number.isFinite(max) && n > max) return max;
  return n;
}

export function createMapEditorRuntime({
  scene,
  mapId,
  mapObjects,
  onCreateMapObject,
  onEditModeChange,
  canEdit = false,
}) {
  if (!canEdit) {
    return { destroy() {} };
  }

  const PhaserNs = window.Phaser;
  const textureKeys = getMapEditorTextureKeys(mapId).filter((k) =>
    scene.textures.exists(k),
  );
  const spawnAnchors = getMapSpawnAnchors(mapId) || {};
  let spawnConfig = cloneJson(getMapSpawnConfig(mapId));

  const state = {
    enabled: false,
    minimized: false,
    panelHidden: false,
    focusMode: "all",
    showGrid: false,
    gridSize: 0,
    selectedId: "",
    selectedIds: new Set(),
    entities: [],
    markers: [],
    selectables: [],
    isApplyingSnapshot: false,
    pendingDragSnapshot: null,
    groupDragStart: null,
    handleDragStart: null,
    snapGuideX: null,
    snapGuideY: null,
    history: { stack: [], index: -1 },
  };

  const graphics = scene.add.graphics();
  graphics.setDepth(4000);

  const handles = {
    n: scene.add.rectangle(0, 0, 10, 10, 0xffc15a, 0.95),
    e: scene.add.rectangle(0, 0, 10, 10, 0xffc15a, 0.95),
    s: scene.add.rectangle(0, 0, 10, 10, 0xffc15a, 0.95),
    w: scene.add.rectangle(0, 0, 10, 10, 0xffc15a, 0.95),
  };
  for (const [name, h] of Object.entries(handles)) {
    h.setDepth(4200);
    h.setVisible(false);
    h.setStrokeStyle(1, 0x0e1f2f, 0.95);
    h.setInteractive();
    scene.input.setDraggable(h);
    h._editorHandle = name;
  }

  const host = document.createElement("div");
  host.id = "map-edit-host";
  host.innerHTML = `
    <style>
      #map-edit-host{position:fixed;top:14px;right:14px;z-index:99999;font-family:system-ui,sans-serif}
      #map-edit-panel{margin-top:8px;width:min(430px,95vw);background:rgba(7,14,24,.93);color:#d6ebff;border:1px solid #4ec6ff;border-radius:12px;padding:10px;backdrop-filter:blur(6px);display:none}
      #map-edit-panel.open{display:block}
      #map-edit-panel.min{width:min(250px,90vw)}
      #map-edit-panel.min .content{display:none}
      #map-edit-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}
      #map-edit-panel h4{margin:0 0 8px 0;font-size:14px;letter-spacing:.02em}
      #map-edit-panel #map-edit-min{background:#10263a;color:#ecf7ff;border:1px solid #5fd3ff;border-radius:10px;padding:6px 10px;font-weight:700;cursor:pointer}
      #map-edit-panel .row{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px}
      #map-edit-panel .row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:8px}
      #map-edit-panel label{font-size:11px;display:block;opacity:.92;margin-bottom:2px}
      #map-edit-panel input,#map-edit-panel select,#map-edit-panel textarea{width:100%;box-sizing:border-box;background:#0d2134;color:#eef8ff;border:1px solid #2e9fca;border-radius:8px;padding:6px;font-size:12px}
      #map-edit-panel textarea{min-height:100px;font-family:Consolas,monospace}
      #map-edit-panel .btns{display:flex;gap:8px;flex-wrap:wrap;margin:8px 0}
      #map-edit-panel button{background:#16384f;color:#e8f7ff;border:1px solid #4ec6ff;border-radius:8px;padding:6px 10px;cursor:pointer;font-size:12px}
      #map-edit-panel button.warn{border-color:#ff9f5f;color:#ffd8bd}
      #map-edit-panel button.on{background:#215773;border-color:#8adfff;color:#f4fbff}
      #map-edit-panel button.off{background:#3a4552;border-color:#596776;color:#a9b7c7;opacity:.72}
      #map-edit-panel .tiny{font-size:11px;opacity:.85;line-height:1.35;margin:6px 0 0 0}
    </style>
    <div id="map-edit-panel">
      <div id="map-edit-head">
        <h4>Map Editor (admin)</h4>
        <button id="map-edit-min" type="button">Minimize</button>
      </div>
      <div class="content">
        <div class="row3">
          <div>
            <label>Selectable</label>
            <select id="map-edit-select"></select>
          </div>
          <div>
            <label>Add Platform</label>
            <select id="map-edit-texture"></select>
          </div>
          <div>
            <label>Spawn Focus</label>
            <select id="map-edit-focus">
              <option value="all">All</option>
              <option value="1">1v1</option>
              <option value="2">2v2</option>
              <option value="3">3v3</option>
            </select>
          </div>
        </div>

        <div class="btns">
          <button id="map-edit-add-platform" type="button">Add Platform</button>
          <button id="map-edit-add-boundary" type="button">Add Boundary Zone</button>
          <button id="map-edit-center-scene" type="button">Center Scene</button>
          <button id="map-edit-export" class="warn" type="button">Export Std JSON</button>
          <button id="map-edit-export-snippets" type="button">Export Map Snippets</button>
        </div>

        <div class="btns" id="map-edit-boundary-sides">
          <button id="map-edit-side-up" type="button">Top</button>
          <button id="map-edit-side-down" type="button">Bottom</button>
          <button id="map-edit-side-left" type="button">Left</button>
          <button id="map-edit-side-right" type="button">Right</button>
        </div>

        <div class="btns">
          <button id="map-edit-grid-cycle" class="on" type="button">Grid: Off</button>
        </div>

        <div class="row">
          <div><label>X</label><input id="map-edit-x" type="number" step="1"></div>
          <div><label>Y</label><input id="map-edit-y" type="number" step="1"></div>
        </div>
        <div class="row">
          <div><label>Scale X</label><input id="map-edit-scale-x" type="number" step="0.01"></div>
          <div><label>Scale Y</label><input id="map-edit-scale-y" type="number" step="0.01"></div>
        </div>
        <div class="row">
          <div><label>Body/Zone Width</label><input id="map-edit-w" type="number" step="1"></div>
          <div><label>Body/Zone Height</label><input id="map-edit-h" type="number" step="1"></div>
        </div>
        <div class="row">
          <div><label>Body Offset X</label><input id="map-edit-ox" type="number" step="1"></div>
          <div><label>Body Offset Y</label><input id="map-edit-oy" type="number" step="1"></div>
        </div>

        <div class="btns">
          <button id="map-edit-import" type="button">Import JSON</button>
        </div>
        <textarea id="map-edit-json" placeholder="Paste/export standard map editor JSON here..."></textarea>
        <p class="tiny">Single selection editor. Ctrl+D toggles editor, Ctrl+Z/Ctrl+Y undo-redo. Hold Shift while dragging to snap. Field edits apply when you leave a field (blur/change/enter). Boundary side toggles are editable only for boundary zones and disabled sides are greyed out.</p>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  // Keep panel interaction from reaching the Phaser canvas beneath it.
  const swallowUiPointer = (ev) => {
    ev.stopPropagation();
  };
  [
    "pointerdown",
    "pointerup",
    "pointermove",
    "mousedown",
    "mouseup",
    "click",
    "dblclick",
    "touchstart",
    "touchend",
    "wheel",
  ].forEach((name) => host.addEventListener(name, swallowUiPointer));

  const el = {
    min: host.querySelector("#map-edit-min"),
    panel: host.querySelector("#map-edit-panel"),
    select: host.querySelector("#map-edit-select"),
    texture: host.querySelector("#map-edit-texture"),
    focus: host.querySelector("#map-edit-focus"),
    addPlatform: host.querySelector("#map-edit-add-platform"),
    addBoundary: host.querySelector("#map-edit-add-boundary"),
    centerScene: host.querySelector("#map-edit-center-scene"),
    export: host.querySelector("#map-edit-export"),
    exportSnippets: host.querySelector("#map-edit-export-snippets"),
    importBtn: host.querySelector("#map-edit-import"),
    gridCycle: host.querySelector("#map-edit-grid-cycle"),
    x: host.querySelector("#map-edit-x"),
    y: host.querySelector("#map-edit-y"),
    sx: host.querySelector("#map-edit-scale-x"),
    sy: host.querySelector("#map-edit-scale-y"),
    w: host.querySelector("#map-edit-w"),
    h: host.querySelector("#map-edit-h"),
    ox: host.querySelector("#map-edit-ox"),
    oy: host.querySelector("#map-edit-oy"),
    json: host.querySelector("#map-edit-json"),
    sideUp: host.querySelector("#map-edit-side-up"),
    sideDown: host.querySelector("#map-edit-side-down"),
    sideLeft: host.querySelector("#map-edit-side-left"),
    sideRight: host.querySelector("#map-edit-side-right"),
  };

  function pushSelectable(rec) {
    state.selectables.push(rec);
  }

  function findSelectableById(id) {
    return state.selectables.find((s) => s.id === id) || null;
  }

  function selectedEntities() {
    const out = [];
    for (const id of state.selectedIds.values()) {
      const s = findSelectableById(id);
      if (s?.kind === "entity") out.push(s.ref);
    }
    return out;
  }

  function setSelected(id, additive = false) {
    state.selectedIds.clear();
    if (!id) return;
    state.selectedIds.add(id);
    state.selectedId = id;
    refreshSelect();
    syncInputsFromSelection();
  }

  function getEntityBounds(entity) {
    const go = entity?.go;
    const body = go?.body;
    if (entity?.type === "zone" && body) {
      return {
        left: body.x,
        top: body.y,
        right: body.x + body.width,
        bottom: body.y + body.height,
        centerX: body.x + body.width / 2,
        centerY: body.y + body.height / 2,
      };
    }
    const b = go?.getBounds?.();
    if (!b)
      return {
        left: go.x,
        top: go.y,
        right: go.x,
        bottom: go.y,
        centerX: go.x,
        centerY: go.y,
      };
    return {
      left: b.left,
      top: b.top,
      right: b.right,
      bottom: b.bottom,
      centerX: b.centerX,
      centerY: b.centerY,
    };
  }

  function serializeEntity(entity, rounded = true) {
    const num = (v) => (rounded ? round2(v) : Number(v || 0));
    const go = entity.go;
    const body = go.body || null;
    return {
      type: entity.type,
      textureKey: go.texture?.key || null,
      x: num(go.x),
      y: num(go.y),
      scaleX: num(go.scaleX || 1),
      scaleY: num(go.scaleY || 1),
      flipX: !!go.flipX,
      width: num(body?.width || go.width || 0),
      height: num(body?.height || go.height || 0),
      offsetX: num(body?.offset?.x || 0),
      offsetY: num(body?.offset?.y || 0),
      collision: body
        ? {
            up: body.checkCollision.up !== false,
            down: body.checkCollision.down !== false,
            left: body.checkCollision.left !== false,
            right: body.checkCollision.right !== false,
          }
        : null,
    };
  }

  function snapshot() {
    return {
      entities: state.entities.map((e) => serializeEntity(e, false)),
      spawns: cloneJson(spawnConfig),
    };
  }

  function resetHistoryBaseline() {
    state.history.stack = [snapshot()];
    state.history.index = 0;
  }

  function clearEntities() {
    for (const entity of state.entities) {
      try {
        entity.go?.destroy?.();
      } catch (_) {}
    }
    state.entities = [];
    state.selectables = state.selectables.filter((s) => s.kind !== "entity");
    mapObjects.length = 0;
  }

  function rebuildEntitiesFromSnapshotRows(rows) {
    clearEntities();
    if (!Array.isArray(rows)) return;

    for (const row of rows) {
      if (row?.type === "zone") {
        const zone = createZone(
          scene,
          PhaserNs,
          Number(row?.x) || 0,
          Number(row?.y) || 0,
          Math.max(4, Number(row?.width) || 80),
          Math.max(4, Number(row?.height) || 20),
        );
        mapObjects.push(zone);
        registerEntity(zone, "map");
        const entity = state.entities[state.entities.length - 1];
        applyEntityState(entity, row);
        onCreateMapObject?.(zone);
        continue;
      }

      const texture = String(row?.textureKey || "");
      if (!texture || !scene.textures.exists(texture)) continue;
      const sprite = scene.physics.add.sprite(
        Number(row?.x) || 0,
        Number(row?.y) || 0,
        texture,
      );
      sprite.body.allowGravity = false;
      sprite.setImmovable(true);
      mapObjects.push(sprite);
      registerEntity(sprite, "map");
      const entity = state.entities[state.entities.length - 1];
      applyEntityState(entity, row);
      onCreateMapObject?.(sprite);
    }
  }

  function applyEntityState(entity, row) {
    const go = entity.go;
    go.setPosition(row.x, row.y);
    if (entity.type === "sprite") {
      go.setScale(Number(row.scaleX) || 1, Number(row.scaleY) || 1);
      go.setFlipX(!!row.flipX);
      if (go.body) {
        const w = Number(row.width);
        const h = Number(row.height);
        if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0)
          setSpriteBodySizeFromDisplaySize(go, w, h);
        const ox = Number(row.offsetX);
        const oy = Number(row.offsetY);
        if (Number.isFinite(ox) && Number.isFinite(oy))
          go.body.setOffset(ox, oy);
      }
      if (go.body && typeof go.body.reset === "function")
        go.body.reset(go.x, go.y);
      updateBodyFromGameObject(go);
      return;
    }

    const w = Math.max(4, Number(row.width) || 4);
    const h = Math.max(4, Number(row.height) || 4);
    go.setSize(w, h);
    if (go.body && typeof go.body.setSize === "function") {
      go.body.setSize(w, h, true);
      go.body.checkCollision.up = row?.collision?.up !== false;
      go.body.checkCollision.down = row?.collision?.down !== false;
      go.body.checkCollision.left = row?.collision?.left !== false;
      go.body.checkCollision.right = row?.collision?.right !== false;
    }
    setZoneInteractive(PhaserNs, go, w, h);
    updateBodyFromGameObject(go);
  }

  function applySnapshot(s) {
    if (!s || !Array.isArray(s.entities)) return false;
    state.isApplyingSnapshot = true;
    try {
      rebuildEntitiesFromSnapshotRows(s.entities);
      spawnConfig = cloneJson(s.spawns || spawnConfig);
      rebuildSpawnMarkers();
      if (state.selectables.length) {
        setSelected(state.selectables[0].id, false);
      }
      return true;
    } finally {
      state.isApplyingSnapshot = false;
      syncInputsFromSelection();
    }
  }

  function commitHistory() {
    if (state.isApplyingSnapshot) return;
    const snap = snapshot();
    const curr = state.history.stack[state.history.index];
    if (JSON.stringify(curr) === JSON.stringify(snap)) return;
    state.history.stack = state.history.stack.slice(0, state.history.index + 1);
    state.history.stack.push(snap);
    state.history.index = state.history.stack.length - 1;
  }

  function undo() {
    if (state.pendingDragSnapshot) return;
    if (state.history.index <= 0) return;
    state.groupDragStart = null;
    state.handleDragStart = null;
    state.history.index -= 1;
    applySnapshot(state.history.stack[state.history.index]);
  }

  function redo() {
    if (state.pendingDragSnapshot) return;
    if (state.history.index >= state.history.stack.length - 1) return;
    state.groupDragStart = null;
    state.handleDragStart = null;
    state.history.index += 1;
    applySnapshot(state.history.stack[state.history.index]);
  }

  function shouldShowMarker(m) {
    if (!state.enabled) return false;
    if (state.focusMode === "all") return true;
    if (m.type === "powerup") return true;
    return String(m.mode || "") === state.focusMode;
  }

  function refreshGridButtons() {
    if (!el.gridCycle) return;
    const label = state.gridSize > 0 ? state.gridSize : "Off";
    el.gridCycle.textContent = `Grid: ${label}`;
    el.gridCycle.classList.toggle("on", state.gridSize > 0);
  }

  function setPanelVisibility(visible) {
    state.panelHidden = !visible;
    if (!state.enabled) {
      el.panel.classList.remove("open");
      return;
    }
    el.panel.classList.toggle("open", visible);
  }

  function setEditorEnabled(enabled) {
    state.enabled = !!enabled;
    if (!state.enabled) {
      state.panelHidden = false;
      state.groupDragStart = null;
      state.handleDragStart = null;
      el.panel.classList.remove("open");
      graphics.setVisible(false);
      for (const h of Object.values(handles)) h.setVisible(false);
      for (const m of state.markers) m.marker.setVisible(false);
      state.snapGuideX = null;
      state.snapGuideY = null;
      onEditModeChange?.(false);
      return;
    }
    setPanelVisibility(true);
    graphics.setVisible(true);
    for (const m of state.markers) m.marker.setVisible(shouldShowMarker(m));
    onEditModeChange?.(true);
  }

  function refreshSelect() {
    const current = state.selectedId;
    el.select.innerHTML = "";
    for (const rec of state.selectables) {
      if (rec.kind === "marker" && !shouldShowMarker(rec.ref)) continue;
      const opt = document.createElement("option");
      opt.value = rec.id;
      opt.textContent = rec.label;
      if (rec.id === current) opt.selected = true;
      el.select.appendChild(opt);
    }
  }

  function findSelected() {
    return findSelectableById(state.selectedId);
  }

  function syncInputsFromSelection() {
    const selEntities = selectedEntities();
    if (selEntities.length > 1) {
      const go = selEntities[selEntities.length - 1].go;
      const body = go.body || null;
      el.x.value = round2(go.x);
      el.y.value = round2(go.y);
      el.sx.value = round2(go.scaleX || 1);
      el.sy.value = round2(go.scaleY || 1);
      el.w.value = round2(body?.width || go.width || 0);
      el.h.value = round2(body?.height || go.height || 0);
      el.ox.value = round2(body?.offset?.x || 0);
      el.oy.value = round2(body?.offset?.y || 0);
      return;
    }

    const selected = findSelected();
    if (!selected) return;
    if (selected.kind === "entity") {
      const go = selected.ref.go;
      const body = go.body || null;
      el.x.value = round2(go.x);
      el.y.value = round2(go.y);
      el.sx.value = round2(go.scaleX || 1);
      el.sy.value = round2(go.scaleY || 1);
      el.w.value = round2(body?.width || go.width || 0);
      el.h.value = round2(body?.height || go.height || 0);
      el.ox.value = round2(body?.offset?.x || 0);
      el.oy.value = round2(body?.offset?.y || 0);
      return;
    }

    const p = selected.ref.point;
    el.x.value = round2(p.x);
    el.y.value = round2(p.y || 0);
    el.sx.value = "1";
    el.sy.value = "1";
    el.w.value = "0";
    el.h.value = "0";
    el.ox.value = "0";
    el.oy.value = "0";
  }

  function refreshBoundarySideButtons() {
    const btns = [el.sideUp, el.sideDown, el.sideLeft, el.sideRight];
    const selected = findSelected();
    const isBoundary =
      selected?.kind === "entity" && selected.ref?.type === "zone";
    const body = isBoundary ? selected.ref.go?.body : null;

    for (const b of btns) {
      if (!b) continue;
      b.disabled = !isBoundary;
      b.classList.toggle("off", !isBoundary);
      b.classList.toggle("on", false);
    }
    if (!isBoundary || !body) return;

    el.sideUp?.classList.toggle("on", body.checkCollision.up !== false);
    el.sideUp?.classList.toggle("off", body.checkCollision.up === false);
    el.sideDown?.classList.toggle("on", body.checkCollision.down !== false);
    el.sideDown?.classList.toggle("off", body.checkCollision.down === false);
    el.sideLeft?.classList.toggle("on", body.checkCollision.left !== false);
    el.sideLeft?.classList.toggle("off", body.checkCollision.left === false);
    el.sideRight?.classList.toggle("on", body.checkCollision.right !== false);
    el.sideRight?.classList.toggle("off", body.checkCollision.right === false);
  }

  function toggleBoundarySide(sideKey) {
    const selected = findSelected();
    if (!(selected?.kind === "entity" && selected.ref?.type === "zone")) return;
    const body = selected.ref.go?.body;
    if (!body || !body.checkCollision) return;
    const prev = body.checkCollision[sideKey] !== false;
    body.checkCollision[sideKey] = !prev;
    commitHistory();
    refreshBoundarySideButtons();
  }

  function registerEntity(go, prefix = "obj") {
    if (!go) return;
    const id = `${prefix}-${state.entities.length + 1}`;
    const isZone = go.type === "Zone";
    if (isZone) {
      const w = Number(go.width) || 80;
      const h = Number(go.height) || 20;
      setZoneInteractive(PhaserNs, go, w, h);
    } else {
      go.setInteractive();
    }
    scene.input.setDraggable(go);

    const entity = {
      id,
      type: isZone ? "zone" : "sprite",
      go,
      label: `${id} (${go.texture?.key || go.type || "zone"})`,
    };
    state.entities.push(entity);
    pushSelectable({ id, kind: "entity", ref: entity, label: entity.label });

    go.on("pointerdown", (pointer) => {
      if (!state.enabled) return;
      setSelected(id, false);
    });
  }

  function clearSpawnMarkers() {
    for (const m of state.markers) {
      try {
        m.marker.destroy();
      } catch (_) {}
    }
    state.markers = [];
    state.selectables = state.selectables.filter((s) => s.kind !== "marker");
  }

  function resolveAnchorSnapAt(x, y) {
    let best = null;
    let bestScore = Infinity;
    const entries = Object.entries(spawnAnchors || {});
    for (const [anchorId, anchor] of entries) {
      if (!anchor || !anchor.active) continue;
      const b = anchor.getBounds?.();
      if (!b) continue;
      const topY = anchor.body ? anchor.body.top : b.top;
      const clampedX = Math.max(b.left, Math.min(b.right, x));
      const dx = Math.abs(x - clampedX);
      const dy = Math.abs(y - topY);
      if (dx > 72 || dy > 90) continue;
      const score = dx * 1.2 + dy;
      if (score < bestScore) {
        bestScore = score;
        best = { anchorId };
      }
    }
    return best;
  }

  function rebuildSpawnMarkers() {
    clearSpawnMarkers();
    const players = spawnConfig?.players || {};
    const colors = { team1: 0x2ee6ff, team2: 0xff7b59, powerup: 0x99ff77 };

    for (const team of ["team1", "team2"]) {
      const byMode = players[team] || {};
      for (const mode of ["1", "2", "3"]) {
        const list = Array.isArray(byMode[mode]) ? byMode[mode] : [];
        for (let i = 0; i < list.length; i++) {
          const point = list[i];
          const prev = getSpawnPreviewPoint(scene, point, spawnAnchors, 2);
          if (!prev) continue;
          const marker = scene.add.circle(
            prev.x,
            prev.y,
            8,
            colors[team],
            0.95,
          );
          marker.setDepth(4100);
          marker.setInteractive();
          scene.input.setDraggable(marker);
          const id = `spawn-${team}-${mode}-${i}`;
          const meta = {
            id,
            type: "spawn",
            team,
            mode,
            index: i,
            marker,
            point,
          };
          state.markers.push(meta);
          pushSelectable({ id, kind: "marker", ref: meta, label: id });
          marker.on("pointerdown", () => {
            if (!state.enabled) return;
            setSelected(id, false);
          });
        }
      }
    }

    const powerups = Array.isArray(spawnConfig?.powerups)
      ? spawnConfig.powerups
      : [];
    for (let i = 0; i < powerups.length; i++) {
      const point = powerups[i];
      const prev = getSpawnPreviewPoint(scene, point, {}, 0);
      if (!prev) continue;
      const marker = scene.add.circle(prev.x, prev.y, 7, colors.powerup, 0.9);
      marker.setDepth(4100);
      marker.setInteractive();
      scene.input.setDraggable(marker);
      const id = `powerup-${i}`;
      const meta = { id, type: "powerup", index: i, marker, point };
      state.markers.push(meta);
      pushSelectable({ id, kind: "marker", ref: meta, label: id });
      marker.on("pointerdown", () => {
        if (!state.enabled) return;
        setSelected(id, false);
      });
    }

    for (const m of state.markers) m.marker.setVisible(shouldShowMarker(m));
    refreshSelect();
  }

  function snapPoint(rawX, rawY, opts = {}) {
    const out = { x: rawX, y: rawY };
    state.snapGuideX = null;
    state.snapGuideY = null;

    if (state.gridSize > 0) {
      out.x = Math.round(out.x / state.gridSize) * state.gridSize;
      out.y = Math.round(out.y / state.gridSize) * state.gridSize;
    }

    if (!opts.shiftSnap) return out;

    const worldW =
      Number(scene.physics?.world?.bounds?.width) ||
      Number(scene.scale?.width) ||
      1300;
    const worldH =
      Number(scene.physics?.world?.bounds?.height) ||
      Number(scene.scale?.height) ||
      1000;

    const candX = [0, worldW * 0.25, worldW * 0.5, worldW * 0.75, worldW];
    const candY = [0, worldH * 0.25, worldH * 0.5, worldH * 0.75, worldH];

    for (const e of state.entities) {
      if (e.go === opts.excludeGo) continue;
      const b = getEntityBounds(e);
      candX.push(b.left, b.centerX, b.right);
      candY.push(b.top, b.centerY, b.bottom);
      if (e.go?.body) {
        const bb = e.go.body;
        candX.push(bb.x, bb.x + bb.width / 2, bb.x + bb.width);
        candY.push(bb.y, bb.y + bb.height / 2, bb.y + bb.height);
      }
    }

    const snappedX = findNearestCandidate(out.x, candX, 36);
    const snappedY = findNearestCandidate(out.y, candY, 36);
    if (Number.isFinite(snappedX)) {
      out.x = snappedX;
      state.snapGuideX = snappedX;
    }
    if (Number.isFinite(snappedY)) {
      out.y = snappedY;
      state.snapGuideY = snappedY;
    }
    return out;
  }

  function applyInputsToSelection({ commit = true } = {}) {
    const x = Number(el.x.value);
    const y = Number(el.y.value);
    const sx = Number(el.sx.value);
    const sy = Number(el.sy.value);
    const w = Number(el.w.value);
    const h = Number(el.h.value);
    const ox = Number(el.ox.value);
    const oy = Number(el.oy.value);

    const selected = findSelected();
    if (!selected) return;
    if (selected.kind === "entity") {
      const go = selected.ref.go;
      if (Number.isFinite(x) && Number.isFinite(y)) go.setPosition(x, y);
      if (selected.ref.type === "sprite") {
        const nextScaleX = Number.isFinite(sx) ? sx : go.scaleX || 1;
        const nextScaleY = Number.isFinite(sy) ? sy : go.scaleY || 1;
        if (Number.isFinite(sx) && Number.isFinite(sy)) {
          go.setScale(nextScaleX, nextScaleY);
        }
        if (go.body && Number.isFinite(w) && Number.isFinite(h)) {
          const rawW = Math.max(1, w / Math.max(0.0001, Math.abs(nextScaleX)));
          const rawH = Math.max(1, h / Math.max(0.0001, Math.abs(nextScaleY)));
          go.body.setSize(rawW, rawH);
        }
        if (go.body && Number.isFinite(ox) && Number.isFinite(oy))
          go.body.setOffset(ox, oy);
        if (go.body && typeof go.body.reset === "function")
          go.body.reset(go.x, go.y);
      } else if (Number.isFinite(w) && Number.isFinite(h) && w > 1 && h > 1) {
        go.setSize(w, h);
        if (go.body && typeof go.body.setSize === "function")
          go.body.setSize(w, h, true);
        setZoneInteractive(PhaserNs, go, w, h);
      }
      updateBodyFromGameObject(go);
      if (commit) commitHistory();
      syncInputsFromSelection();
      refreshBoundarySideButtons();
      return;
    }

    const point = selected.ref.point;
    if (Number.isFinite(x)) point.x = x;
    if (!point.anchorId && Number.isFinite(y)) point.y = y;
    delete point.dx;
    selected.ref.marker.x = point.x;
    if (!point.anchorId) selected.ref.marker.y = point.y;
    if (commit) commitHistory();
    refreshBoundarySideButtons();
  }

  function createPlatform() {
    const key = el.texture.value;
    if (!key || !scene.textures.exists(key)) return;
    const cam = scene.cameras.main;
    const x = Math.round(cam.worldView.centerX);
    const y = Math.round(cam.worldView.centerY);
    const sprite = scene.physics.add.sprite(x, y, key);
    sprite.body.allowGravity = false;
    sprite.setImmovable(true);
    sprite.setScale(1);
    mapObjects.push(sprite);
    registerEntity(sprite, "new");
    onCreateMapObject?.(sprite);
    setSelected(state.entities[state.entities.length - 1].id, false);
    commitHistory();
  }

  function createBoundaryZone() {
    const cam = scene.cameras.main;
    const zone = createZone(
      scene,
      PhaserNs,
      Math.round(cam.worldView.centerX),
      Math.round(cam.worldView.centerY),
      140,
      26,
    );
    mapObjects.push(zone);
    registerEntity(zone, "boundary");
    onCreateMapObject?.(zone);
    setSelected(state.entities[state.entities.length - 1].id, false);
    commitHistory();
  }

  function centerSceneToWorld() {
    if (!state.entities.length) return;
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const entity of state.entities) {
      const b = getEntityBounds(entity);
      left = Math.min(left, b.left);
      right = Math.max(right, b.right);
      top = Math.min(top, b.top);
      bottom = Math.max(bottom, b.bottom);
    }
    if (!Number.isFinite(left) || !Number.isFinite(right)) return;

    const world = scene.physics?.world?.bounds;
    const worldCenterX = Number.isFinite(world?.centerX)
      ? world.centerX
      : (Number(scene.scale?.width) || 1300) / 2;
    const worldCenterY = Number.isFinite(world?.centerY)
      ? world.centerY
      : (Number(scene.scale?.height) || 1000) / 2;

    const currentCenterX = (left + right) / 2;
    const currentCenterY = (top + bottom) / 2;
    const dx = worldCenterX - currentCenterX;
    const dy = worldCenterY - currentCenterY;

    for (const entity of state.entities) {
      const go = entity.go;
      go.setPosition(go.x + dx, go.y + dy);
      if (go.body && typeof go.body.reset === "function")
        go.body.reset(go.x, go.y);
      updateBodyFromGameObject(go);
    }

    const players = spawnConfig?.players || {};
    for (const team of Object.keys(players)) {
      const byMode = players[team] || {};
      for (const mode of Object.keys(byMode)) {
        const list = Array.isArray(byMode[mode]) ? byMode[mode] : [];
        for (const p of list) {
          if (Number.isFinite(p?.x)) p.x += dx;
          else if (Number.isFinite(p?.dx)) p.dx += dx;
          if (!p?.anchorId && Number.isFinite(p?.y)) p.y += dy;
        }
      }
    }
    if (Array.isArray(spawnConfig?.powerups)) {
      for (const p of spawnConfig.powerups) {
        if (Number.isFinite(p?.x)) p.x += dx;
        if (Number.isFinite(p?.y)) p.y += dy;
      }
    }

    rebuildSpawnMarkers();
    commitHistory();
    syncInputsFromSelection();
  }

  function removeSelectedEntities() {
    const selectedEntityIds = new Set(
      [...state.selectedIds].filter(
        (id) => findSelectableById(id)?.kind === "entity",
      ),
    );
    if (!selectedEntityIds.size) return;

    for (const ent of state.entities) {
      if (!selectedEntityIds.has(ent.id)) continue;
      const idx = mapObjects.indexOf(ent.go);
      if (idx >= 0) mapObjects.splice(idx, 1);
      try {
        ent.go.destroy();
      } catch (_) {}
    }

    state.entities = state.entities.filter((e) => !selectedEntityIds.has(e.id));
    state.selectables = state.selectables.filter(
      (s) => !(s.kind === "entity" && selectedEntityIds.has(s.id)),
    );
    for (const id of selectedEntityIds) state.selectedIds.delete(id);
    if (selectedEntityIds.has(state.selectedId)) state.selectedId = "";

    refreshSelect();
    if (!state.selectedId && state.selectables.length) {
      setSelected(state.selectables[0].id, false);
    } else {
      syncInputsFromSelection();
    }
    commitHistory();
  }

  function buildExportPayload() {
    const platforms = [];
    const hitboxes = [];

    for (const entity of state.entities) {
      const go = entity.go;
      const body = go.body || null;
      if (entity.type === "sprite") {
        platforms.push({
          textureKey: go.texture?.key,
          x: round2(go.x),
          y: round2(go.y),
          scaleX: round2(go.scaleX || 1),
          scaleY: round2(go.scaleY || 1),
          flipX: !!go.flipX,
          body: body
            ? {
                width: round2(body.width),
                height: round2(body.height),
                offsetX: round2(body.offset?.x || 0),
                offsetY: round2(body.offset?.y || 0),
              }
            : null,
        });
      } else {
        hitboxes.push({
          x: round2(go.x),
          y: round2(go.y),
          width: round2(body?.width || go.width),
          height: round2(body?.height || go.height),
          collision: {
            up: body?.checkCollision?.up !== false,
            down: body?.checkCollision?.down !== false,
            left: body?.checkCollision?.left !== false,
            right: body?.checkCollision?.right !== false,
          },
        });
      }
    }

    return {
      schema: "bb-map-editor.v1",
      mapId,
      platforms,
      hitboxes,
      spawns: cloneJson(spawnConfig),
    };
  }

  function exportConfig() {
    const payload = buildExportPayload();
    const txt = JSON.stringify(payload, null, 2);
    el.json.value = txt;
    if (navigator?.clipboard?.writeText)
      navigator.clipboard.writeText(txt).catch(() => {});
  }

  function exportMapSnippets() {
    const parsed = buildExportPayload();

    const snippet = [
      "// Paste this into your map module",
      `const SPAWN_CONFIG = ${JSON.stringify(parsed.spawns || {}, null, 2)};`,
      "",
      "// Reusable editor layout for mapUtils.appendLayoutObjectsFromConfig",
      "const MAP_LAYOUT_CONFIG = {",
      `  platforms: ${JSON.stringify(parsed.platforms || [], null, 2)},`,
      `  hitboxes: ${JSON.stringify(parsed.hitboxes || [], null, 2)},`,
      "};",
      "",
      "// In map file:",
      "// 1) set USE_LAYOUT_CONFIG_ONLY = true",
      "// 2) import appendLayoutObjectsFromConfig from mapUtils",
      "// 3) call appendLayoutObjectsFromConfig(scene, _objects, MAP_LAYOUT_CONFIG) inside build()",
    ].join("\n");

    el.json.value = snippet;
    if (navigator?.clipboard?.writeText)
      navigator.clipboard.writeText(snippet).catch(() => {});
  }

  function importConfig() {
    let parsed = null;
    try {
      parsed = JSON.parse(String(el.json.value || "").trim());
    } catch (_) {
      alert("Invalid JSON");
      return;
    }
    if (!parsed || typeof parsed !== "object") return;

    const platformRows = Array.isArray(parsed.platforms)
      ? parsed.platforms
      : [];
    const hitboxRows = Array.isArray(parsed.hitboxes) ? parsed.hitboxes : [];

    const sprites = state.entities.filter((e) => e.type === "sprite");
    const zones = state.entities.filter((e) => e.type === "zone");

    for (let i = 0; i < Math.min(platformRows.length, sprites.length); i++) {
      applyEntityState(sprites[i], {
        ...serializeEntity(sprites[i]),
        ...platformRows[i],
        width: platformRows[i]?.body?.width,
        height: platformRows[i]?.body?.height,
        offsetX: platformRows[i]?.body?.offsetX,
        offsetY: platformRows[i]?.body?.offsetY,
      });
    }
    for (let i = 0; i < Math.min(hitboxRows.length, zones.length); i++) {
      applyEntityState(zones[i], {
        ...serializeEntity(zones[i]),
        ...hitboxRows[i],
      });
    }

    if (parsed.spawns && typeof parsed.spawns === "object") {
      spawnConfig = cloneJson(parsed.spawns);
      rebuildSpawnMarkers();
    }

    commitHistory();
    syncInputsFromSelection();
  }

  function updateHandlePositions() {
    const selected = findSelected();
    if (!state.enabled || !selected || selected.kind !== "entity") {
      for (const h of Object.values(handles)) h.setVisible(false);
      return;
    }
    const b = getEntityBounds(selected.ref);
    const off = 8;
    handles.n.setPosition(b.centerX, b.top - off);
    handles.e.setPosition(b.right + off, b.centerY);
    handles.s.setPosition(b.centerX, b.bottom + off);
    handles.w.setPosition(b.left - off, b.centerY);
    for (const h of Object.values(handles)) h.setVisible(true);
  }

  function resizeFromHandle(name, dragX, dragY, shiftSnap) {
    const selected = findSelected();
    if (!selected || selected.kind !== "entity") return;
    const entity = selected.ref;
    const go = entity.go;
    const snapped = snapPoint(dragX, dragY, { shiftSnap, excludeGo: go });
    const start = state.handleDragStart;
    if (!start) return;
    const axis = name === "e" || name === "w" ? "x" : "y";
    const startDist = Math.max(
      1,
      axis === "x" ? start.displayWidth / 2 : start.displayHeight / 2,
    );
    const currDist = Math.max(
      1,
      axis === "x" ? Math.abs(snapped.x - go.x) : Math.abs(snapped.y - go.y),
    );
    const uniformScale = clampNum(currDist / startDist, 0.05, 50);

    if (entity.type === "sprite") {
      const sx = Math.max(0.05, start.scaleX * uniformScale);
      const sy = Math.max(0.05, start.scaleY * uniformScale);
      go.setScale(sx, sy);
      const nextWidth = Math.max(1, start.displayWidth * uniformScale);
      const nextHeight = Math.max(1, start.displayHeight * uniformScale);
      let nextX = go.x;
      let nextY = go.y;
      if (name === "e") nextX = start.left + nextWidth / 2;
      else if (name === "w") nextX = start.right - nextWidth / 2;
      if (name === "s") nextY = start.top + nextHeight / 2;
      else if (name === "n") nextY = start.bottom - nextHeight / 2;
      go.setPosition(nextX, nextY);
      if (go.body && typeof go.body.reset === "function")
        go.body.reset(go.x, go.y);
      updateBodyFromGameObject(go);
      syncInputsFromSelection();
      return;
    }

    const baseW = Math.max(6, start.width);
    const baseH = Math.max(6, start.height);
    const w = axis === "x" ? Math.max(6, baseW * uniformScale) : baseW;
    const h = axis === "y" ? Math.max(6, baseH * uniformScale) : baseH;
    let nextX = go.x;
    let nextY = go.y;
    if (name === "e") nextX = start.left + w / 2;
    else if (name === "w") nextX = start.right - w / 2;
    else if (name === "s") nextY = start.top + h / 2;
    else if (name === "n") nextY = start.bottom - h / 2;
    go.setPosition(nextX, nextY);
    go.setSize(w, h);
    if (go.body && typeof go.body.setSize === "function")
      go.body.setSize(w, h, true);
    setZoneInteractive(PhaserNs, go, w, h);
    updateBodyFromGameObject(go);
    syncInputsFromSelection();
  }

  function drawGrid() {
    if (!state.enabled || !state.showGrid || state.gridSize <= 0) return;
    const wb = scene.physics?.world?.bounds;
    const worldX = Number.isFinite(wb?.x) ? wb.x : 0;
    const worldY = Number.isFinite(wb?.y) ? wb.y : 0;
    const worldW = Number.isFinite(wb?.width)
      ? wb.width
      : Number(scene.scale?.width) || 1300;
    const worldH = Number.isFinite(wb?.height)
      ? wb.height
      : Number(scene.scale?.height) || 1000;
    graphics.lineStyle(1, 0x376481, 0.28);
    for (let x = worldX; x <= worldX + worldW; x += state.gridSize) {
      graphics.beginPath();
      graphics.moveTo(x, worldY);
      graphics.lineTo(x, worldY + worldH);
      graphics.strokePath();
    }
    for (let y = worldY; y <= worldY + worldH; y += state.gridSize) {
      graphics.beginPath();
      graphics.moveTo(worldX, y);
      graphics.lineTo(worldX + worldW, y);
      graphics.strokePath();
    }
  }

  function drawOverlay() {
    graphics.clear();
    if (!state.enabled) return;

    drawGrid();

    const wb = scene.physics?.world?.bounds;
    const worldX = Number.isFinite(wb?.x) ? wb.x : 0;
    const worldY = Number.isFinite(wb?.y) ? wb.y : 0;
    const worldW = Number.isFinite(wb?.width)
      ? wb.width
      : Number(scene.scale?.width) || 1300;
    const worldH = Number.isFinite(wb?.height)
      ? wb.height
      : Number(scene.scale?.height) || 1000;

    const cx = worldX + worldW / 2;
    const cy = worldY + worldH / 2;
    const q1x = worldX + worldW * 0.25;
    const q3x = worldX + worldW * 0.75;
    const q1y = worldY + worldH * 0.25;
    const q3y = worldY + worldH * 0.75;

    graphics.lineStyle(1.5, 0xffd166, 0.82);
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(worldX, worldY, worldX + worldW, worldY),
    );
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(worldX, worldY, worldX, worldY + worldH),
    );

    graphics.lineStyle(1.8, 0x72f1b8, 0.82);
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(cx, worldY, cx, worldY + worldH),
    );
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(worldX, cy, worldX + worldW, cy),
    );

    graphics.lineStyle(1.2, 0x93c5fd, 0.58);
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(q1x, worldY, q1x, worldY + worldH),
    );
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(q3x, worldY, q3x, worldY + worldH),
    );
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(worldX, q1y, worldX + worldW, q1y),
    );
    graphics.strokeLineShape(
      new PhaserNs.Geom.Line(worldX, q3y, worldX + worldW, q3y),
    );

    if (Number.isFinite(state.snapGuideX)) {
      graphics.lineStyle(2, 0xff3b8d, 0.95);
      graphics.strokeLineShape(
        new PhaserNs.Geom.Line(
          state.snapGuideX,
          worldY,
          state.snapGuideX,
          worldY + worldH,
        ),
      );
    }
    if (Number.isFinite(state.snapGuideY)) {
      graphics.lineStyle(2, 0xff3b8d, 0.95);
      graphics.strokeLineShape(
        new PhaserNs.Geom.Line(
          worldX,
          state.snapGuideY,
          worldX + worldW,
          state.snapGuideY,
        ),
      );
    }

    for (const entity of state.entities) {
      const go = entity.go;
      if (!go?.active) continue;
      const b = go.body;
      const isCurrent = entity.id === state.selectedId;
      const isSelected = state.selectedIds.has(entity.id);
      const color = isCurrent ? 0xffeb74 : isSelected ? 0xffb347 : 0x67d9ff;
      const lw = isCurrent ? 2 : 1;

      if (b) {
        graphics.lineStyle(lw, color, 0.95);
        graphics.strokeRect(
          round2(b.x),
          round2(b.y),
          round2(b.width),
          round2(b.height),
        );
      } else {
        const bounds = go.getBounds?.();
        if (!bounds) continue;
        graphics.lineStyle(lw, color, 0.9);
        graphics.strokeRect(bounds.x, bounds.y, bounds.width, bounds.height);
      }
    }

    for (const marker of state.markers) {
      if (!marker?.marker?.active) continue;
      const show = shouldShowMarker(marker);
      marker.marker.setVisible(show);
      if (!show) continue;
      const isSelected = marker.id === state.selectedId;
      if (marker.point.anchorId) {
        const p = getSpawnPreviewPoint(scene, marker.point, spawnAnchors, 2);
        if (p) marker.marker.setPosition(p.x, p.y);
      }
      marker.marker.setRadius(isSelected ? 10 : 8);
      graphics.lineStyle(isSelected ? 2 : 1, 0xffffff, 0.8);
      graphics.strokeCircle(
        marker.marker.x,
        marker.marker.y,
        marker.marker.radius + 2,
      );
    }

    updateHandlePositions();
  }

  function registerKeyboardShortcuts() {
    const onKeyDown = (ev) => {
      const ctrl = ev.ctrlKey || ev.metaKey;
      const key = String(ev.key || "").toLowerCase();

      if (ctrl && key === "d") {
        ev.preventDefault();
        setEditorEnabled(!state.enabled);
        return;
      }

      if (isTextInputTarget(ev.target)) return;

      if (!state.enabled) return;

      if (!ctrl) return;

      if (key === "z" && ev.shiftKey) {
        ev.preventDefault();
        redo();
        return;
      }
      if (key === "y") {
        ev.preventDefault();
        redo();
        return;
      }
      if (key === "z") {
        ev.preventDefault();
        undo();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }

  for (const go of mapObjects || []) registerEntity(go, "map");
  rebuildSpawnMarkers();

  scene.input.on("dragstart", (_pointer, go) => {
    if (!state.enabled) return;
    const isHandle = !!go?._editorHandle;
    const isEntity = state.entities.some((e) => e.go === go);
    const isMarker = state.markers.some((m) => m.marker === go);
    if (!isHandle && !isEntity && !isMarker) return;
    state.pendingDragSnapshot = snapshot();

    if (isHandle) {
      const selected = findSelected();
      if (selected?.kind === "entity") {
        const target = selected.ref.go;
        const body = target?.body;
        const bounds = getEntityBounds(selected.ref);
        const width = Number(body?.width || target?.width || 0);
        const height = Number(body?.height || target?.height || 0);
        state.handleDragStart = {
          width: Math.max(1, width),
          height: Math.max(1, height),
          displayWidth: Math.max(
            1,
            Number(bounds.right - bounds.left) || width,
          ),
          displayHeight: Math.max(
            1,
            Number(bounds.bottom - bounds.top) || height,
          ),
          left: bounds.left,
          right: bounds.right,
          top: bounds.top,
          bottom: bounds.bottom,
          scaleX: Math.max(0.05, Number(target?.scaleX) || 1),
          scaleY: Math.max(0.05, Number(target?.scaleY) || 1),
        };
      }
      return;
    }

    if (isEntity) return;
  });

  scene.input.on("drag", (pointer, go, dragX, dragY) => {
    if (!state.enabled) return;

    if (go?._editorHandle) {
      resizeFromHandle(
        go._editorHandle,
        dragX,
        dragY,
        !!pointer?.event?.shiftKey,
      );
      return;
    }

    const ent = state.entities.find((e) => e.go === go);
    if (ent) {
      const snapped = snapPoint(dragX, dragY, {
        shiftSnap: !!pointer?.event?.shiftKey,
        excludeGo: go,
      });
      go.setPosition(Math.round(snapped.x), Math.round(snapped.y));
      if (ent.type === "zone") {
        updateBodyFromGameObject(go);
      } else if (go.body && typeof go.body.reset === "function") {
        go.body.reset(go.x, go.y);
      } else {
        updateBodyFromGameObject(go);
      }
      syncInputsFromSelection();
      return;
    }

    const marker = state.markers.find((m) => m.marker === go);
    if (!marker) return;
    const snapped = snapPoint(dragX, dragY, {
      shiftSnap: !!pointer?.event?.shiftKey,
      excludeGo: null,
    });
    marker.point.x = Math.round(snapped.x);
    delete marker.point.dx;
    const anchorHit =
      marker.type === "spawn"
        ? resolveAnchorSnapAt(snapped.x, snapped.y)
        : null;
    if (anchorHit) {
      marker.point.anchorId = anchorHit.anchorId;
      delete marker.point.y;
      const preview = getSpawnPreviewPoint(
        scene,
        marker.point,
        spawnAnchors,
        2,
      );
      if (preview) go.setPosition(preview.x, preview.y);
      else go.setPosition(marker.point.x, go.y);
    } else {
      delete marker.point.anchorId;
      marker.point.y = Math.round(snapped.y);
      go.setPosition(marker.point.x, marker.point.y);
    }
    syncInputsFromSelection();
  });

  scene.input.on("dragend", () => {
    if (!state.enabled || !state.pendingDragSnapshot) return;
    const before = state.pendingDragSnapshot;
    state.pendingDragSnapshot = null;
    state.groupDragStart = null;
    state.handleDragStart = null;
    state.snapGuideX = null;
    state.snapGuideY = null;
    const after = snapshot();
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      state.history.stack = state.history.stack.slice(
        0,
        state.history.index + 1,
      );
      state.history.stack.push(after);
      state.history.index = state.history.stack.length - 1;
    }
  });

  el.min.addEventListener("click", () => {
    state.minimized = !state.minimized;
    el.panel.classList.toggle("min", state.minimized);
    el.min.textContent = state.minimized ? "Expand" : "Minimize";
  });

  el.select.addEventListener("change", () =>
    setSelected(el.select.value, false),
  );
  el.focus.addEventListener("change", () => {
    state.focusMode = String(el.focus.value || "all");
    refreshSelect();
  });
  el.addPlatform.addEventListener("click", createPlatform);
  el.addBoundary.addEventListener("click", createBoundaryZone);
  el.centerScene.addEventListener("click", centerSceneToWorld);
  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.id = "map-edit-delete";
  deleteBtn.className = "warn";
  deleteBtn.textContent = "Delete Selected";
  el.addBoundary.parentElement?.appendChild(deleteBtn);
  deleteBtn.addEventListener("click", removeSelectedEntities);
  el.export.addEventListener("click", exportConfig);
  el.exportSnippets.addEventListener("click", exportMapSnippets);
  el.importBtn.addEventListener("click", importConfig);

  el.sideUp?.addEventListener("click", () => toggleBoundarySide("up"));
  el.sideDown?.addEventListener("click", () => toggleBoundarySide("down"));
  el.sideLeft?.addEventListener("click", () => toggleBoundarySide("left"));
  el.sideRight?.addEventListener("click", () => toggleBoundarySide("right"));

  const editCommitFields = [el.x, el.y, el.sx, el.sy, el.w, el.h, el.ox, el.oy];
  for (const input of editCommitFields) {
    if (!input) continue;
    input.addEventListener("focus", () => {
      input.dataset.bbStartValue = String(input.value ?? "");
    });
    input.addEventListener("change", () => {
      const before = String(input.dataset.bbStartValue ?? "");
      const after = String(input.value ?? "");
      if (before === after) return;
      applyInputsToSelection({ commit: true });
      input.dataset.bbStartValue = after;
    });
    input.addEventListener("blur", () => {
      const before = String(input.dataset.bbStartValue ?? "");
      const after = String(input.value ?? "");
      if (before === after) return;
      applyInputsToSelection({ commit: true });
      input.dataset.bbStartValue = after;
    });
    input.addEventListener("keydown", (ev) => {
      if (ev.key !== "Enter") return;
      ev.preventDefault();
      const before = String(input.dataset.bbStartValue ?? "");
      const after = String(input.value ?? "");
      if (before === after) {
        try {
          input.blur();
        } catch (_) {}
        return;
      }
      applyInputsToSelection({ commit: true });
      input.dataset.bbStartValue = after;
      try {
        input.blur();
      } catch (_) {}
    });
  }

  el.gridCycle.addEventListener("click", () => {
    if (state.gridSize === 0) state.gridSize = 16;
    else if (state.gridSize === 16) state.gridSize = 32;
    else if (state.gridSize === 32) state.gridSize = 64;
    else state.gridSize = 0;
    state.showGrid = state.gridSize > 0;
    refreshGridButtons();
  });

  for (const key of textureKeys) {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = key;
    el.texture.appendChild(opt);
  }

  refreshSelect();
  if (state.selectables.length) setSelected(state.selectables[0].id, false);
  refreshBoundarySideButtons();

  refreshGridButtons();
  setPanelVisibility(false);
  for (const m of state.markers) m.marker.setVisible(false);
  for (const h of Object.values(handles)) h.setVisible(false);
  graphics.setVisible(false);

  resetHistoryBaseline();

  const disposeShortcuts = registerKeyboardShortcuts();
  scene.events.on("postupdate", drawOverlay);

  return {
    destroy() {
      try {
        onEditModeChange?.(false);
      } catch (_) {}
      try {
        scene.events.off("postupdate", drawOverlay);
      } catch (_) {}
      try {
        disposeShortcuts?.();
      } catch (_) {}
      try {
        graphics.destroy();
      } catch (_) {}
      for (const h of Object.values(handles)) {
        try {
          h.destroy();
        } catch (_) {}
      }
      for (const m of state.markers) {
        try {
          m.marker.destroy();
        } catch (_) {}
      }
      try {
        host.remove();
      } catch (_) {}
    },
  };
}
