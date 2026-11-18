import { preloadMapDocument, syncMapDocument } from "../game/maps/documentRuntime";
import { buildScenery, preloadScenery, sceneryTextureKey } from "../game/maps/sceneryRuntime";
import { clone, validateMap, geometryFromMap } from "../../shared/maps/mapDocument";
import { mapArena } from "../../shared/maps/arenas";
import { cloudUrl } from "../../shared/maps/scenery";
import { resolveLanding } from "../../shared/physics/spawnPlacement";
import { motionOffset } from "../../shared/maps/platformMotion";
import { allRows, snapMove, resizeRow, resizeCollision } from "./editorModel";
import { $, editor, friendlyName, map, selected, status } from "./studioState";
import { node } from "./studioControls";
import { commit } from "./mapSession";
import { renderBrowser, select, renderInspector } from "./inspector";
import { hideHint } from "./studioState";

function mapPoint(row, data = map()) {
  if (row.kind !== "spawn" && !(row.kind === "powerup" && row.value.anchorId))
    return { x: row.value.x, y: row.value.y };
  const geometry = geometryFromMap(data);
  const p = resolveLanding(
    row.value,
    geometry.anchors[row.value.anchorId],
    geometry.colliders,
    row.kind === "powerup" ? { width: 32, height: 40 } : { width: 64, height: 96 },
  );
  return { x: p.x, y: p.y };
}

function visibleRows() {
  return allRows(map());
}

// A cloud's on-map size, from its loaded art.
function cloudSize(cloud) {
  const key = sceneryTextureKey(cloudUrl(cloud));
  const image = editor.scene?.textures.exists(key)
    ? editor.scene.textures.get(key).getSourceImage()
    : { width: 240, height: 120 };
  const s = cloud.scale ?? 1;
  return { width: image.width * s, height: image.height * s };
}

function rowBounds(row, collision = false) {
  if (collision && row.kind === "platform") {
    const c = geometryFromMap(map()).anchors[row.id];
    return { x: c.left, y: c.top, width: c.right - c.left, height: c.bottom - c.top };
  }
  const p = row.value;
  if (row.kind === "cloud") {
    const c = cloudSize(p);
    return { x: p.x - c.width / 2, y: p.y - c.height / 2, ...c };
  }
  const tex = map().textureSizes[p.textureKey];
  const width =
    row.kind === "platform" ? tex.width * p.scaleX : row.kind === "hitbox" ? p.width : 24;
  const height =
    row.kind === "platform" ? tex.height * p.scaleY : row.kind === "hitbox" ? p.height : 24;
  const pt = mapPoint(row);
  return { x: pt.x - width / 2, y: pt.y - height / 2, width, height };
}

const EASE_LABELS = {
  linear: "Linear (constant speed)",
  sine: "Smooth (sine)",
  quad: "Gentle (quad)",
  cubic: "Strong (cubic)",
  quart: "Sharp (quart)",
  expo: "Snappy (expo)",
};

// A moving platform's far end: its rest bounds shifted by the travel distance.
function travelEnd(row) {
  const b = rowBounds(row),
    m = row.value.motion;
  const dx = m.axis === "x" ? m.distance : 0,
    dy = m.axis === "y" ? m.distance : 0;
  return {
    ...b,
    x: b.x + dx,
    y: b.y + dy,
    cx: b.x + dx + b.width / 2,
    cy: b.y + dy + b.height / 2,
  };
}

const RESIZE_CURSORS = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

const handlesFor = (b) => ({
  nw: [b.x, b.y],
  n: [b.x + b.width / 2, b.y],
  ne: [b.x + b.width, b.y],
  e: [b.x + b.width, b.y + b.height / 2],
  se: [b.x + b.width, b.y + b.height],
  s: [b.x + b.width / 2, b.y + b.height],
  sw: [b.x, b.y + b.height],
  w: [b.x, b.y + b.height / 2],
});

class StudioScene extends Phaser.Scene {
  constructor() {
    super("studio");
    this.markerElements = new Map();
    this.visuals = [];
    this.objectiveVisuals = [];
    this.mapObjects = [];
    this.pickups = new Map();
    this.accumulator = 0;
  }
  preload() {
    preloadMapDocument(this, map());
    preloadScenery(this, map());
    const bankAssets = {
      vault: "bank-bust/vault-intact.webp",
      goldMine: "bank-bust/mine.webp",
      claimableTurret: "bank-bust/mount.webp",
      wallSlot: "bank-bust/not-built.webp",
      gold: "icons/coin.webp",
    };
    for (const [key, file] of Object.entries(bankAssets))
      this.load.image(`editor-object-${key}`, `/assets/${file}`);
    this.assetErrors = [];
    this.load.on("loaderror", (file) => this.assetErrors.push(`Unable to load ${file.url}`));
  }
  create() {
    editor.scene = this;
    this._loadedAssets = clone(map().assets);
    this.sceneryKey = null;
    this.overlay = this.add.graphics().setDepth(10000);
    this.rebuild();
    this.fit();
    this.input.mouse.disableContextMenu();
    this.input.on("pointerdown", (p) => this.pointerDown(p));
    this.input.on("pointermove", (p) => this.pointerMove(p));
    this.input.on("pointerup", () => this.pointerUp());
    this.input.on("gameout", () => {
      this.hoverId = null;
    });
    // Wheel zooms toward the cursor. Trackpads send many small deltas (pinch arrives with ctrlKey).
    this.input.on("wheel", (pointer, _objects, _dx, dy) => {
      if (editor.preview || !dy) return;
      const event = pointer.event,
        pixels = event?.deltaMode === 1 ? dy * 16 : dy;
      this.zoomBy(
        Phaser.Math.Clamp(Math.exp(-pixels * (event?.ctrlKey ? 0.01 : 0.0016)), 0.7, 1.4),
        pointer.x,
        pointer.y,
      );
    });
    // A fitted view refits; otherwise keep the same world point centred.
    this.scale.on("resize", (size, _base, _display, previousWidth, previousHeight) => {
      if (editor.preview) return;
      if (this.fitted || editor.cameraPreview) return this.fit();
      const cam = this.cameras.main;
      cam.scrollX += (previousWidth - size.width) / 2;
      cam.scrollY += (previousHeight - size.height) / 2;
    });
    if (this.assetErrors.length) status(this.assetErrors.join(" · "));
    else status("Ready · Drag objects to edit. Esc enters playtest.");
    editor.sceneReady?.();
    editor.sceneReady = null;
  }
  rebuild() {
    const cam = this.cameras.main,
      savedCamera = { zoom: cam.zoom, scrollX: cam.scrollX, scrollY: cam.scrollY };
    for (const object of [...this.visuals, ...this.objectiveVisuals]) object.destroy();
    this.visuals = [];
    this.objectiveVisuals = [];
    const runtime = syncMapDocument(this, editor.documentData.id, map());
    this.mapObjects = runtime.objects;
    this.geometry = geometryFromMap(map(), editor.documentData.id);
    // The edit view composes the scenery still, as the match camera frames it at
    // rest; the game camera view runs it live. Platform lighting follows layout.
    const sceneryKey = JSON.stringify([
      map().modeVariantId,
      map().scenery,
      editor.cameraPreview && map().layout,
    ]);
    if (sceneryKey !== this.sceneryKey) {
      this.sceneryKey = sceneryKey;
      buildScenery(this, map(), { still: !editor.cameraPreview });
    }
    // Edit camera can pan beyond world bounds; the game camera keeps the match bounds.
    if (!editor.preview && !editor.cameraPreview) {
      cam.removeBounds();
      cam.setZoom(savedCamera.zoom);
      cam.scrollX = savedCamera.scrollX;
      cam.scrollY = savedCamera.scrollY;
    }
    const markers = visibleRows().filter((r) => !["platform", "hitbox", "cloud"].includes(r.kind));
    const ids = new Set(markers.map((row) => row.id));
    for (const [id, entry] of this.markerElements)
      if (!ids.has(id)) {
        entry.el.remove();
        this.markerElements.delete(id);
      }
    for (const row of markers) {
      const p = mapPoint(row);
      if (["vault", "objective", "gold"].includes(row.kind)) {
        const type = row.kind === "objective" ? row.value.type : row.kind;
        const art = this.add.image(p.x, p.y, `editor-object-${type}`).setDepth(3000);
        const width = row.value.width || (type === "gold" ? 24 : type === "goldMine" ? 80 : 90);
        art.setDisplaySize(width, row.value.height || width);
        this.objectiveVisuals.push(art);
      }
      let entry = this.markerElements.get(row.id);
      if (!entry) {
        const el = node("div", undefined, { class: "map-marker" }),
          dot = node("span", undefined, { class: "marker-dot" }),
          label = node("span", undefined, { class: "marker-label" });
        el.append(dot, label);
        $("marker-layer").append(el);
        entry = { el, label };
        this.markerElements.set(row.id, entry);
      }
      entry.point = p;
      entry.row = row;
      entry.el.className = `map-marker ${row.kind}${row.kind === "spawn" ? " " + row.team : ""}`;
      entry.label.textContent =
        row.kind === "spawn"
          ? `${row.team === "team1" ? "Blue" : "Red"} ${row.index + 1}`
          : row.value.label || friendlyName(row.id);
    }
  }
  positionMarkers() {
    const cam = this.cameras.main;
    for (const [id, entry] of this.markerElements) {
      const x = (entry.point.x - cam.scrollX - cam.width / 2) * cam.zoom + cam.width / 2;
      const y = (entry.point.y - cam.scrollY - cam.height / 2) * cam.zoom + cam.height / 2;
      entry.el.style.transform = `translate3d(${x}px,${y}px,0)`;
      entry.el.hidden =
        editor.preview || x < -100 || y < -60 || x > cam.width + 100 || y > cam.height + 60;
      entry.el.classList.toggle("selected", editor.selectedIds.has(id));
      entry.label.hidden =
        entry.row.kind !== "spawn" && !editor.selectedIds.has(id) && cam.zoom <= 0.8;
    }
  }

  // Game camera: the match camera's bounds and zoom range, with live scenery.
  setCameraPreview(on) {
    editor.cameraPreview = on;
    document.body.classList.toggle("camera-preview", on);
    $("camera-preview").setAttribute("aria-pressed", String(on));
    this.sceneryKey = null;
    this.rebuild();
    if (!on) {
      this.fit();
      status("Editing · Drag objects to edit. C shows the game camera.");
      return;
    }
    const c = mapArena(map()).camera,
      cam = this.cameras.main;
    cam.setBounds(c.x, c.y, c.width, c.height);
    cam.setZoom(c.zoom);
    cam.centerOn(c.x + c.width / 2, c.y + c.height / 2);
    $("zoom-label").textContent = Math.round(cam.zoom * 100) + "%";
    status(
      `Game camera · ${mapArena(map()).label} zooms ${c.minZoom}–${c.maxZoom}×. Pan with Space + drag. C returns to editing.`,
    );
  }
  fit() {
    if (editor.cameraPreview) return this.setCameraPreview(true);
    const w = mapArena(map()).world;
    const cam = this.cameras.main;
    cam.removeBounds();
    cam.setZoom(Math.min(this.scale.width / (w.width + 160), this.scale.height / (w.height + 200)));
    cam.centerOn(w.x + w.width / 2, w.y + w.height / 2);
    this.fitted = true;
    $("zoom-label").textContent = Math.round(cam.zoom * 100) + "%";
  }
  // Zooms about a screen point (the view centre by default), keeping the world point under it fixed.
  zoomBy(factor, screenX, screenY) {
    const cam = this.cameras.main,
      c = mapArena(map()).camera;
    screenX ??= cam.width / 2;
    screenY ??= cam.height / 2;
    const world = this.screenToWorld(screenX, screenY),
      zoom = editor.cameraPreview
        ? Phaser.Math.Clamp(cam.zoom * factor, c.minZoom, c.maxZoom)
        : Phaser.Math.Clamp(cam.zoom * factor, 0.08, 4);
    cam.setZoom(zoom);
    cam.scrollX = world.x - cam.width / 2 - (screenX - cam.width / 2) / zoom;
    cam.scrollY = world.y - cam.height / 2 - (screenY - cam.height / 2) / zoom;
    this.fitted = false;
    $("zoom-label").textContent = Math.round(zoom * 100) + "%";
  }
  // The camera's own matrix only refreshes on render; this stays exact between frames.
  screenToWorld(x, y) {
    const cam = this.cameras.main;
    return {
      x: (x - cam.width / 2) / cam.zoom + cam.scrollX + cam.width / 2,
      y: (y - cam.height / 2) / cam.zoom + cam.scrollY + cam.height / 2,
    };
  }
  focusRow(row) {
    const p = mapPoint(row);
    this.cameras.main.centerOn(p.x, p.y);
    this.fitted = false;
  }
  // Pans to a row picked from the list only when it is off screen.
  revealRow(row) {
    const b = rowBounds(row),
      view = this.cameras.main.worldView;
    if (b.x + b.width < view.x || b.x > view.right || b.y + b.height < view.y || b.y > view.bottom)
      this.focusRow(row);
  }
  handleAt(pt) {
    const current = selected(),
      cam = this.cameras.main;
    if (editor.selectedIds.size !== 1 || !current) return null;
    if (current.kind === "platform" && current.value.motion) {
      const end = travelEnd(current);
      if (Math.hypot(pt.x - end.cx, pt.y - end.cy) < 9 / cam.zoom)
        return { kind: "travel", row: current };
    }
    if (["platform", "hitbox"].includes(current.kind))
      for (const [handle, [x, y]] of Object.entries(
        handlesFor(rowBounds(current, editor.handleMode === "collision")),
      ))
        if (Math.hypot(pt.x - x, pt.y - y) < 8 / cam.zoom)
          return { kind: "resize", handle, row: current };
    return null;
  }
  rowAt(pt) {
    const rows = visibleRows(),
      cam = this.cameras.main;
    // Markers first, then platforms; clouds (large, see-through art) last.
    const ordered = [
      ...rows.filter((r) => !["platform", "hitbox", "cloud"].includes(r.kind)).reverse(),
      ...rows.filter((r) => ["platform", "hitbox"].includes(r.kind)).reverse(),
      ...rows.filter((r) => r.kind === "cloud").reverse(),
    ];
    return ordered.find((r) => {
      const b = rowBounds(r);
      const pad = ["platform", "hitbox"].includes(r.kind) ? 0 : 8 / cam.zoom;
      return (
        pt.x >= b.x - pad &&
        pt.x <= b.x + b.width + pad &&
        pt.y >= b.y - pad &&
        pt.y <= b.y + b.height + pad
      );
    });
  }
  setCursor(cursor) {
    if (this.game.canvas.style.cursor !== cursor) this.game.canvas.style.cursor = cursor;
  }
  updateHover(pointer) {
    if (editor.preview || editor.cameraPreview || $("dialog").open) {
      this.hoverId = null;
      return;
    }
    if (editor.keyboard.has(" ")) {
      this.hoverId = null;
      return this.setCursor("grab");
    }
    const pt = this.screenToWorld(pointer.x, pointer.y),
      handle = this.handleAt(pt);
    if (handle) {
      this.hoverId = null;
      return this.setCursor(handle.kind === "travel" ? "grab" : RESIZE_CURSORS[handle.handle]);
    }
    const hit = this.rowAt(pt);
    this.hoverId = hit?.id || null;
    this.setCursor(hit ? "move" : "default");
  }
  pointerDown(pointer) {
    if (editor.preview || editor.busy || $("dialog").open) return;
    const cam = this.cameras.main,
      pt = this.screenToWorld(pointer.x, pointer.y);
    hideHint();
    if (document.activeElement && document.activeElement !== document.body)
      document.activeElement.blur();
    if (editor.keyboard.has(" ") || pointer.middleButtonDown() || pointer.rightButtonDown()) {
      editor.drag = {
        kind: "pan",
        x: pointer.x,
        y: pointer.y,
        scrollX: cam.scrollX,
        scrollY: cam.scrollY,
      };
      this.setCursor("grabbing");
      return;
    }
    const handle = this.handleAt(pt);
    if (handle?.kind === "travel") {
      editor.drag = {
        kind: "travel",
        rowId: handle.row.id,
        before: clone(editor.documentData),
        screenX: pointer.x,
        screenY: pointer.y,
        moved: false,
      };
      return;
    }
    if (handle) {
      editor.drag = {
        kind: "resize",
        handle: handle.handle,
        rowId: handle.row.id,
        start: clone(handle.row.value),
        before: clone(editor.documentData),
        screenX: pointer.x,
        screenY: pointer.y,
        moved: false,
      };
      return;
    }
    const hit = this.rowAt(pt);
    if (!hit) {
      editor.drag = {
        kind: "marquee",
        start: pt,
        end: pt,
        screenX: pointer.x,
        screenY: pointer.y,
        additive: !!pointer.event?.shiftKey,
        ids: new Set(editor.selectedIds),
        moved: false,
      };
      if (!editor.drag.additive) select(null);
      return;
    }
    if (pointer.event?.shiftKey) select(hit.id, true);
    else if (!editor.selectedIds.has(hit.id)) select(hit.id);
    else {
      editor.selectedId = hit.id;
      editor.activeTab = "selection";
      renderBrowser();
      renderInspector();
    }
    if (!editor.selectedIds.has(hit.id)) return;
    const position = mapPoint(hit);
    editor.drag = {
      kind: "move",
      rowId: hit.id,
      dx: position.x - pt.x,
      dy: position.y - pt.y,
      start: position,
      ids: [...editor.selectedIds],
      before: clone(editor.documentData),
      screenX: pointer.x,
      screenY: pointer.y,
      moved: false,
    };
  }
  pointerMove(pointer) {
    if (editor.preview) return;
    if (!editor.drag) return this.updateHover(pointer);
    const cam = this.cameras.main;
    if (editor.drag.kind === "pan") {
      cam.scrollX = editor.drag.scrollX - (pointer.x - editor.drag.x) / cam.zoom;
      cam.scrollY = editor.drag.scrollY - (pointer.y - editor.drag.y) / cam.zoom;
      this.fitted = false;
      return;
    }
    if (
      !editor.drag.moved &&
      Math.hypot(pointer.x - editor.drag.screenX, pointer.y - editor.drag.screenY) < 4
    )
      return;
    editor.drag.moved = true;
    const pt = this.screenToWorld(pointer.x, pointer.y);
    if (editor.drag.kind === "marquee") {
      editor.drag.end = pt;
      const left = Math.min(pt.x, editor.drag.start.x),
        right = Math.max(pt.x, editor.drag.start.x),
        top = Math.min(pt.y, editor.drag.start.y),
        bottom = Math.max(pt.y, editor.drag.start.y);
      editor.selectedIds = new Set(editor.drag.additive ? editor.drag.ids : []);
      for (const row of visibleRows()) {
        const b = rowBounds(row);
        if (b.x + b.width >= left && b.x <= right && b.y + b.height >= top && b.y <= bottom)
          editor.selectedIds.add(row.id);
      }
      editor.selectedId = [...editor.selectedIds].at(-1) || null;
      renderBrowser();
      renderInspector();
      return;
    }
    editor.documentData = clone(editor.drag.before);
    const base = editor.drag.before,
      row = allRows(map()).find((r) => r.id === editor.drag.rowId);
    if (!row) return;
    try {
      const bypass = pointer.event?.metaKey || pointer.event?.ctrlKey,
        grid = Number($("grid").value);
      if (editor.drag.kind === "travel") {
        const m = row.value.motion,
          start = m.axis === "x" ? row.value.x : row.value.y;
        let travel = (m.axis === "x" ? pt.x : pt.y) - start;
        if (!bypass && grid) travel = Math.round(travel / grid) * grid;
        m.distance = Math.round(Math.abs(travel) < 8 ? (travel < 0 ? -8 : 8) : travel);
      } else if (editor.drag.kind === "resize") {
        const x = Math.round(!bypass && grid ? Math.round(pt.x / grid) * grid : pt.x),
          y = Math.round(!bypass && grid ? Math.round(pt.y / grid) * grid : pt.y);
        const value =
          editor.handleMode === "collision" && row.kind === "platform"
            ? resizeCollision(base, row, editor.drag.handle, x, y, !pointer.event?.shiftKey)
            : resizeRow(
                editor.drag.start,
                editor.drag.handle,
                x,
                y,
                row.kind === "platform" ? map().textureSizes[row.value.textureKey] : null,
                !pointer.event?.shiftKey,
              );
        Object.assign(row.value, value);
      } else {
        const snap = snapMove(
          map(),
          row,
          pt.x + editor.drag.dx,
          pt.y + editor.drag.dy,
          grid,
          bypass,
          8 / cam.zoom,
        );
        const destination = mapPoint({ ...row, value: snap.value }),
          dx = destination.x - editor.drag.start.x,
          dy = destination.y - editor.drag.start.y;
        editor.guidelines = snap.guides;
        for (const target of allRows(map()).filter((r) => editor.drag.ids.includes(r.id))) {
          if (target.kind === "spawn" && editor.drag.ids.includes(target.value.anchorId)) continue;
          const original = allRows(base).find((r) => r.id === target.id),
            point = mapPoint(original, base);
          Object.assign(
            target.value,
            snapMove(map(), target, point.x + dx, point.y + dy, 0, true).value,
          );
        }
      }
      this.rebuild();
    } catch (e) {
      editor.documentData = clone(editor.drag.before);
      this.rebuild();
      status(e.message);
    }
  }
  pointerUp() {
    if (!editor.drag) return;
    const current = editor.drag;
    editor.drag = null;
    editor.guidelines = [];
    if (current.kind === "pan") this.setCursor(editor.keyboard.has(" ") ? "grab" : "default");
    if (current.kind === "pan" || current.kind === "marquee" || !current.moved) return;
    const errors = validateMap(map());
    if (errors.length) {
      editor.documentData = current.before;
      this.rebuild();
      renderInspector();
      status(`Edit reverted: ${errors[0]}`);
      return;
    }
    commit(
      { resize: "Object resized", travel: "Travel distance updated" }[current.kind] ||
        "Selection moved",
    );
  }
  drawOverlay() {
    this.overlay.clear();
    if (editor.preview) return;
    this.positionMarkers();
    if (editor.cameraPreview) return;
    const g = this.overlay,
      cam = this.cameras.main,
      arena = mapArena(map()),
      w = arena.world,
      c = arena.camera,
      grid = Number($("grid").value);
    if (grid && grid * cam.zoom >= 7) {
      g.lineStyle(1 / cam.zoom, 0x7594a7, 0.12);
      const view = cam.worldView;
      const left = Math.max(w.x, Math.floor(view.x / grid) * grid),
        top = Math.max(w.y, Math.floor(view.y / grid) * grid),
        right = Math.min(w.x + w.width, view.right),
        bottom = Math.min(w.y + w.height, view.bottom);
      for (let x = left; x <= right; x += grid) g.lineBetween(x, top, x, bottom);
      for (let y = top; y <= bottom; y += grid) g.lineBetween(left, y, right, y);
    }
    g.lineStyle(2 / cam.zoom, 0x91adc0, 0.65).strokeRect(w.x, w.y, w.width, w.height);
    g.lineStyle(1 / cam.zoom, 0xbaf36b, 0.25).lineBetween(
      w.x + w.width / 2,
      w.y,
      w.x + w.width / 2,
      w.y + w.height,
    );
    // What the match camera can show (the mode's camera bounds).
    g.lineStyle(2 / cam.zoom, 0xffd166, 0.45).strokeRect(c.x, c.y, c.width, c.height);
    for (const c of this.geometry.colliders) {
      g.lineStyle(
        1 / cam.zoom,
        c.id === editor.selectedId ? 0xbaf36b : 0x66bbff,
        c.id === editor.selectedId || $("debug-hitboxes").checked ? 0.9 : 0.3,
      ).strokeRect(c.left, c.top, c.right - c.left, c.bottom - c.top);
    }
    // Moving platforms: travel path, far-end ghost and a live preview of the motion.
    const now = performance.now();
    for (const row of visibleRows().filter((r) => r.kind === "platform" && r.value.motion)) {
      const rest = rowBounds(row),
        end = travelEnd(row),
        offset = motionOffset(row.value.motion, now),
        active = editor.selectedIds.has(row.id);
      g.lineStyle(2 / cam.zoom, 0xffd166, active ? 0.9 : 0.45).lineBetween(
        rest.x + rest.width / 2,
        rest.y + rest.height / 2,
        end.cx,
        end.cy,
      );
      g.lineStyle(1 / cam.zoom, 0xffd166, active ? 0.7 : 0.3).strokeRect(
        end.x,
        end.y,
        end.width,
        end.height,
      );
      g.fillStyle(0xffd166, active ? 0.18 : 0.08).fillRect(
        rest.x + offset.x,
        rest.y + offset.y,
        rest.width,
        rest.height,
      );
      if (active && editor.selectedIds.size === 1) {
        g.fillStyle(0x17212c).fillCircle(end.cx, end.cy, 6 / cam.zoom);
        g.lineStyle(2 / cam.zoom, 0xffd166).strokeCircle(end.cx, end.cy, 6 / cam.zoom);
      }
    }
    const hover =
      this.hoverId &&
      !editor.selectedIds.has(this.hoverId) &&
      !editor.drag &&
      visibleRows().find((r) => r.id === this.hoverId);
    if (hover) {
      const b = rowBounds(hover);
      g.lineStyle(1.5 / cam.zoom, 0xffffff, 0.7).strokeRect(b.x, b.y, b.width, b.height);
    }
    for (const guide of editor.guidelines) {
      g.lineStyle(1 / cam.zoom, 0xff87c8, 0.9);
      if (guide.axis === "x") g.lineBetween(guide.value, w.y, guide.value, w.y + w.height);
      else g.lineBetween(w.x, guide.value, w.x + w.width, guide.value);
    }
    const color = editor.handleMode === "collision" ? 0xffb866 : 0xbaf36b;
    for (const row of visibleRows().filter((row) => editor.selectedIds.has(row.id))) {
      const b = rowBounds(row, editor.handleMode === "collision");
      g.lineStyle(2 / cam.zoom, color, 1).strokeRect(b.x, b.y, b.width, b.height);
      if (editor.selectedIds.size === 1 && ["platform", "hitbox"].includes(row.kind))
        for (const [x, y] of Object.values(handlesFor(b))) {
          g.fillStyle(0x17212c).fillRect(
            x - 4 / cam.zoom,
            y - 4 / cam.zoom,
            8 / cam.zoom,
            8 / cam.zoom,
          );
          g.lineStyle(1 / cam.zoom, color).strokeRect(
            x - 4 / cam.zoom,
            y - 4 / cam.zoom,
            8 / cam.zoom,
            8 / cam.zoom,
          );
        }
    }
    if (editor.drag?.kind === "marquee" && editor.drag.moved) {
      const x = Math.min(editor.drag.start.x, editor.drag.end.x),
        y = Math.min(editor.drag.start.y, editor.drag.end.y),
        width = Math.abs(editor.drag.end.x - editor.drag.start.x),
        height = Math.abs(editor.drag.end.y - editor.drag.start.y);
      g.fillStyle(0x66bbff, 0.12).fillRect(x, y, width, height);
      g.lineStyle(1 / cam.zoom, 0x66bbff, 1).strokeRect(x, y, width, height);
    }
  }
  update() {
    if (editor.documentData) this.drawOverlay();
  }
}

export { mapPoint, EASE_LABELS, StudioScene };
