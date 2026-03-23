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
    h.setInteractive({ cursor: "pointer" });
    scene.input.setDraggable(h);
    h._editorHandle = name;
  }

  const host = document.createElement("div");
  host.id = "map-edit-host";
  host.innerHTML = `
    <style>
      #map-edit-host{position:fixed;top:14px;right:14px;z-index:99999;font-family:Poppins,system-ui,sans-serif}
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
          <button id="map-edit-apply" type="button">Apply Fields</button>
          <button id="map-edit-export" class="warn" type="button">Export Std JSON</button>
          <button id="map-edit-export-snippets" type="button">Export Map Snippets</button>
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
          <button id="map-edit-import" type="button">Apply JSON</button>
        </div>
        <textarea id="map-edit-json" placeholder="Paste/export standard map editor JSON here..."></textarea>
        <p class="tiny">Shift+Click to multi-select. Drag one selected object to move selected group. Ctrl+D toggles editor, Tab hides/shows menu, Ctrl+Z/Ctrl+Y undo-redo. Hold Shift while dragging to snap. Handle dragging uses aspect-ratio scaling only.</p>
      </div>
    </div>
  `;
  document.body.appendChild(host);

  const el = {
    min: host.querySelector("#map-edit-min"),
    panel: host.querySelector("#map-edit-panel"),
    select: host.querySelector("#map-edit-select"),
    texture: host.querySelector("#map-edit-texture"),
    focus: host.querySelector("#map-edit-focus"),
    addPlatform: host.querySelector("#map-edit-add-platform"),
    addBoundary: host.querySelector("#map-edit-add-boundary"),
    apply: host.querySelector("#map-edit-apply"),
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
    if (!additive) state.selectedIds.clear();
    if (!id) return;
    if (additive && state.selectedIds.has(id)) state.selectedIds.delete(id);
    else state.selectedIds.add(id);
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

  function serializeEntity(entity) {
    const go = entity.go;
    const body = go.body || null;
    return {
      type: entity.type,
      textureKey: go.texture?.key || null,
      x: round2(go.x),
      y: round2(go.y),
      scaleX: round2(go.scaleX || 1),
      scaleY: round2(go.scaleY || 1),
      flipX: !!go.flipX,
      width: round2(body?.width || go.width || 0),
      height: round2(body?.height || go.height || 0),
      offsetX: round2(body?.offset?.x || 0),
      offsetY: round2(body?.offset?.y || 0),
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
      entities: state.entities.map(serializeEntity),
      spawns: cloneJson(spawnConfig),
    };
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
          go.body.setSize(w, h);
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
    if (
      !s ||
      !Array.isArray(s.entities) ||
      s.entities.length !== state.entities.length
    )
      return false;
    state.isApplyingSnapshot = true;
    try {
      for (let i = 0; i < state.entities.length; i++) {
        applyEntityState(state.entities[i], s.entities[i]);
      }
      spawnConfig = cloneJson(s.spawns || spawnConfig);
      rebuildSpawnMarkers();
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
    if (state.history.index <= 0) return;
    state.history.index -= 1;
    applySnapshot(state.history.stack[state.history.index]);
  }

  function redo() {
    if (state.history.index >= state.history.stack.length - 1) return;
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
      onEditModeChange?.(false);
      return;
    }
    setPanelVisibility(!state.panelHidden);
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
      const mark = state.selectedIds.has(rec.id) ? "* " : "";
      opt.textContent = `${mark}${rec.label}`;
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

  function registerEntity(go, prefix = "obj") {
    if (!go) return;
    const id = `${prefix}-${state.entities.length + 1}`;
    const isZone = go.type === "Zone";
    if (isZone) {
      const w = Number(go.width) || 80;
      const h = Number(go.height) || 20;
      setZoneInteractive(PhaserNs, go, w, h);
    } else {
      go.setInteractive({ cursor: "move" });
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
      setSelected(id, !!pointer?.event?.shiftKey);
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
          marker.setInteractive({ cursor: "pointer" });
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
      marker.setInteractive({ cursor: "pointer" });
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

    out.x = nearestWithThreshold(out.x, candX, 36);
    out.y = nearestWithThreshold(out.y, candY, 36);
    return out;
  }

  function applyInputsToSelection() {
    const x = Number(el.x.value);
    const y = Number(el.y.value);
    const sx = Number(el.sx.value);
    const sy = Number(el.sy.value);
    const w = Number(el.w.value);
    const h = Number(el.h.value);
    const ox = Number(el.ox.value);
    const oy = Number(el.oy.value);

    const ents = selectedEntities();
    if (ents.length > 1) {
      const anchor = ents[ents.length - 1].go;
      const dx = Number.isFinite(x) ? x - anchor.x : 0;
      const dy = Number.isFinite(y) ? y - anchor.y : 0;
      for (const ent of ents) {
        const go = ent.go;
        if (Number.isFinite(x) || Number.isFinite(y))
          go.setPosition(go.x + dx, go.y + dy);
        if (ent.type === "sprite") {
          if (Number.isFinite(sx) && Number.isFinite(sy)) go.setScale(sx, sy);
          if (go.body && Number.isFinite(w) && Number.isFinite(h))
            go.body.setSize(w, h);
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
      }
      commitHistory();
      syncInputsFromSelection();
      return;
    }

    const selected = findSelected();
    if (!selected) return;
    if (selected.kind === "entity") {
      const go = selected.ref.go;
      if (Number.isFinite(x) && Number.isFinite(y)) go.setPosition(x, y);
      if (selected.ref.type === "sprite") {
        if (Number.isFinite(sx) && Number.isFinite(sy)) go.setScale(sx, sy);
        if (go.body && Number.isFinite(w) && Number.isFinite(h))
          go.body.setSize(w, h);
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
      commitHistory();
      syncInputsFromSelection();
      return;
    }

    const point = selected.ref.point;
    if (Number.isFinite(x)) point.x = x;
    if (!point.anchorId && Number.isFinite(y)) point.y = y;
    delete point.dx;
    selected.ref.marker.x = point.x;
    if (!point.anchorId) selected.ref.marker.y = point.y;
    commitHistory();
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

  function exportConfig() {
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

    const payload = {
      schema: "bb-map-editor.v1",
      mapId,
      platforms,
      hitboxes,
      spawns: cloneJson(spawnConfig),
    };
    const txt = JSON.stringify(payload, null, 2);
    el.json.value = txt;
    if (navigator?.clipboard?.writeText)
      navigator.clipboard.writeText(txt).catch(() => {});
  }

  function exportMapSnippets() {
    let parsed = null;
    try {
      parsed = JSON.parse(String(el.json.value || "").trim());
    } catch (_) {
      exportConfig();
      try {
        parsed = JSON.parse(String(el.json.value || "").trim());
      } catch (_) {
        parsed = null;
      }
    }
    if (!parsed || typeof parsed !== "object") return;

    const snippet = [
      "// Paste this into your map module",
      `const SPAWN_CONFIG = ${JSON.stringify(parsed.spawns || {}, null, 2)};`,
      "",
      "// Optional generated data from editor",
      `const EDITOR_PLATFORMS = ${JSON.stringify(parsed.platforms || [], null, 2)};`,
      `const EDITOR_HITBOXES = ${JSON.stringify(parsed.hitboxes || [], null, 2)};`,
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
      axis === "x" ? start.width / 2 : start.height / 2,
    );
    const currDist = Math.max(
      1,
      axis === "x" ? Math.abs(snapped.x - go.x) : Math.abs(snapped.y - go.y),
    );
    const uniformScale = Math.max(0.05, currDist / startDist);

    if (entity.type === "sprite") {
      const sx = Math.max(0.05, start.scaleX * uniformScale);
      const sy = Math.max(0.05, start.scaleY * uniformScale);
      go.setScale(sx, sy);
      if (go.body && typeof go.body.reset === "function")
        go.body.reset(go.x, go.y);
      updateBodyFromGameObject(go);
      syncInputsFromSelection();
      return;
    }

    const w = Math.max(6, start.width * uniformScale);
    const h = Math.max(6, start.height * uniformScale);
    go.setSize(w, h);
    if (go.body && typeof go.body.setSize === "function")
      go.body.setSize(w, h, true);
    setZoneInteractive(PhaserNs, go, w, h);
    updateBodyFromGameObject(go);
    syncInputsFromSelection();
  }

  function drawGrid() {
    if (!state.enabled || !state.showGrid || state.gridSize <= 0) return;
    const worldW =
      Number(scene.physics?.world?.bounds?.width) ||
      Number(scene.scale?.width) ||
      1300;
    const worldH =
      Number(scene.physics?.world?.bounds?.height) ||
      Number(scene.scale?.height) ||
      1000;
    graphics.lineStyle(1, 0x376481, 0.28);
    for (let x = 0; x <= worldW; x += state.gridSize) {
      graphics.beginPath();
      graphics.moveTo(x, 0);
      graphics.lineTo(x, worldH);
      graphics.strokePath();
    }
    for (let y = 0; y <= worldH; y += state.gridSize) {
      graphics.beginPath();
      graphics.moveTo(0, y);
      graphics.lineTo(worldW, y);
      graphics.strokePath();
    }
  }

  function drawOverlay() {
    graphics.clear();
    if (!state.enabled) return;

    drawGrid();

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
      if (isTextInputTarget(ev.target)) return;

      const ctrl = ev.ctrlKey || ev.metaKey;
      const key = String(ev.key || "").toLowerCase();

      if (ctrl && key === "d") {
        ev.preventDefault();
        setEditorEnabled(!state.enabled);
        return;
      }

      if (!state.enabled) return;

      if (key === "tab") {
        ev.preventDefault();
        setPanelVisibility(state.panelHidden);
        return;
      }

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
        const width = Number(body?.width || target?.width || 0);
        const height = Number(body?.height || target?.height || 0);
        state.handleDragStart = {
          width: Math.max(1, width),
          height: Math.max(1, height),
          scaleX: Math.max(0.05, Number(target?.scaleX) || 1),
          scaleY: Math.max(0.05, Number(target?.scaleY) || 1),
        };
      }
      return;
    }

    if (isEntity) {
      const ent = state.entities.find((e) => e.go === go);
      const sel = selectedEntities();
      if (ent && state.selectedIds.has(ent.id) && sel.length > 1) {
        state.groupDragStart = {
          anchorId: ent.id,
          anchorX: go.x,
          anchorY: go.y,
          items: sel.map((e) => ({ go: e.go, x: e.go.x, y: e.go.y })),
        };
      }
    }
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
      if (state.groupDragStart && state.groupDragStart.anchorId === ent.id) {
        const snapped = snapPoint(dragX, dragY, {
          shiftSnap: !!pointer?.event?.shiftKey,
          excludeGo: go,
        });
        const dx = Math.round(snapped.x) - state.groupDragStart.anchorX;
        const dy = Math.round(snapped.y) - state.groupDragStart.anchorY;
        for (const item of state.groupDragStart.items) {
          item.go.setPosition(item.x + dx, item.y + dy);
          if (item.go.body && typeof item.go.body.reset === "function")
            item.go.body.reset(item.go.x, item.go.y);
          updateBodyFromGameObject(item.go);
        }
        syncInputsFromSelection();
        return;
      }

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
    if (!marker.point.anchorId) {
      marker.point.y = Math.round(snapped.y);
      go.y = marker.point.y;
    }
    go.x = marker.point.x;
    syncInputsFromSelection();
  });

  scene.input.on("dragend", () => {
    if (!state.enabled || !state.pendingDragSnapshot) return;
    const before = state.pendingDragSnapshot;
    state.pendingDragSnapshot = null;
    state.groupDragStart = null;
    state.handleDragStart = null;
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
  el.apply.addEventListener("click", applyInputsToSelection);
  el.export.addEventListener("click", exportConfig);
  el.exportSnippets.addEventListener("click", exportMapSnippets);
  el.importBtn.addEventListener("click", importConfig);

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

  refreshGridButtons();
  setPanelVisibility(false);
  for (const m of state.markers) m.marker.setVisible(false);
  for (const h of Object.values(handles)) h.setVisible(false);
  graphics.setVisible(false);

  state.history.stack = [snapshot()];
  state.history.index = 0;

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
