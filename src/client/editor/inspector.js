import { POWERUP_TYPES, geometryFromMap } from "../../shared/maps/mapDocument";
import { mapArena } from "../../shared/maps/arenas";
import { MOTION_DEFAULTS, MOTION_EASES } from "../../shared/maps/platformMotion";
import { allRows } from "./editorModel";
import { $, editor, friendlyName, labelFor, map, selected } from "./studioState";
import { node, advanced, section, field, check, button } from "./studioControls";
import { transaction, setPreview } from "./mapSession";
import { renderScenery, renderCloudInspector } from "./sceneryPanel";
import { replaceArtwork, assetDialog } from "./assetDialog";
import { addObject, duplicate, remove } from "./objectEdits";
import { mapPoint, EASE_LABELS } from "./canvasInteraction";
import { syncAddKinds } from "./playtestControls";

function editValue(object, key, value) {
  transaction(
    () => {
      object[key] = value;
    },
    `${labelFor(key)} updated`,
  );
}

const KIND_LABELS = {
  platform: "Platform",
  hitbox: "Collision box",
  spawn: "Player spawn",
  powerup: "Powerup spawn",
  cloud: "Cloud",
  vault: "Vault",
  respawn: "Respawn point",
  objective: "Objective",
  gold: "Gold spawn",
};

const GROUP_LABELS = {
  platform: "Platforms",
  hitbox: "Collision boxes",
  spawn: "Player spawns",
  powerup: "Powerups",
  cloud: "Clouds",
  vault: "Vaults",
  respawn: "Respawn references",
  objective: "Objectives",
  gold: "Gold spawns",
};

const spawnName = (row) => `${row.team === "team1" ? "Blue" : "Red"} · Spawn ${row.index + 1}`;

function renderBrowser() {
  if (!map()) return;
  const list = $("object-list"),
    scroll = list.scrollTop;
  list.replaceChildren();
  let last = "";
  const q = $("search").value.trim().toLowerCase();
  const rows = allRows(map()).filter((r) =>
    `${r.id} ${r.value.label || ""} ${r.value.textureKey || r.kind} ${r.kind === "spawn" ? spawnName(r) : ""} ${KIND_LABELS[r.kind]}`
      .toLowerCase()
      .includes(q),
  );
  $("object-count").textContent = q ? `${rows.length}/${allRows(map()).length}` : rows.length;
  if (!rows.length)
    list.append(
      node("div", q ? `No objects match “${q}”.` : "No objects yet.", { class: "browser-empty" }),
    );
  for (const r of rows) {
    const group = GROUP_LABELS[r.kind];
    if (group !== last) {
      list.append(node("div", group, { class: "group-label" }));
      last = group;
    }
    const b = node("button", undefined, {
      class: `object-row kind-${r.kind}${r.kind === "spawn" ? " spawn-" + r.team : ""}${editor.selectedIds.has(r.id) ? " active" : ""}`,
      type: "button",
      title: `${r.id} · double-click to centre`,
      "data-id": r.id,
    });
    b.append(
      node(
        "span",
        { platform: "▰", hitbox: "▧", spawn: "⚑", powerup: "✦", cloud: "☁", gold: "●" }[r.kind] ||
          "◆",
        { class: "object-icon" },
      ),
      node("span", r.value.label || (r.kind === "spawn" ? spawnName(r) : r.id)),
    );
    b.onclick = (event) => {
      select(r.id, event.shiftKey);
      editor.scene?.revealRow(r);
    };
    b.ondblclick = () => editor.scene?.focusRow(r);
    list.append(b);
  }
  list.scrollTop = scroll;
}

// Keeps the active row visible when the selection changes from the canvas.
function revealActiveRow() {
  requestAnimationFrame(() =>
    $("object-list")
      .querySelector(`.object-row[data-id="${CSS.escape(editor.selectedId || "")}"]`)
      ?.scrollIntoView({ block: "nearest" }),
  );
}

function select(id, additive = false) {
  if (!additive) editor.selectedIds.clear();
  if (id) {
    if (additive && editor.selectedIds.has(id)) editor.selectedIds.delete(id);
    else editor.selectedIds.add(id);
    editor.activeTab = "selection";
  }
  editor.selectedId = editor.selectedIds.has(id) ? id : [...editor.selectedIds].at(-1) || null;
  renderBrowser();
  renderInspector();
  revealActiveRow();
}

function recursiveFields(parent, obj, path = "", depth = 0) {
  if (depth > 8) return;
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (obj === editor.documentData.metadata && ["id", "label"].includes(key)) continue;
    if (typeof value === "object") {
      const group = section(labelFor(key));
      parent.append(group);
      recursiveFields(group, value, `${path}.${key}`, depth + 1);
    } else if (key === "musicVolume")
      field(parent, "Music volume (%)", value * 100, (v) => editValue(obj, key, v / 100));
    else if (typeof value === "boolean")
      check(parent, labelFor(key), value, (v) => editValue(obj, key, v));
    else if (key === "turnSpeed")
      field(parent, "Turn speed (%)", value * 100, (v) => editValue(obj, key, v / 100));
    else
      field(
        parent,
        labelFor(key),
        value,
        (v) => editValue(obj, key, v),
        typeof value === "number" && !Number.isInteger(value) ? { step: 0.01 } : {},
      );
  }
}

// Edits redraw the whole inspector. Keep the reader's place: scroll, which
// collapsible sections are open and the focused control (after Tab moved it).
let inspectorFrame = 0;

function renderInspector() {
  if (!map() || inspectorFrame) return;
  inspectorFrame = requestAnimationFrame(() => {
    inspectorFrame = 0;
    redrawInspector();
  });
}

function redrawInspector() {
  const panel = $("inspector-content"),
    controls = () => [...panel.querySelectorAll("input,select,textarea,button,summary")];
  const view = `${editor.activeTab}:${editor.activeTab === "selection" ? [...editor.selectedIds].join(",") : ""}`,
    same = panel.dataset.view === view;
  const open = new Set(
    [...panel.querySelectorAll("details[open]>summary")].map(
      (s) =>
        s.textContent +
        ":" +
        [...panel.querySelectorAll("summary")]
          .filter((x) => x.textContent === s.textContent)
          .indexOf(s),
    ),
  );
  const focusIndex = panel.contains(document.activeElement)
      ? controls().indexOf(document.activeElement)
      : -1,
    scroll = panel.scrollTop;
  drawInspector();
  panel.dataset.view = view;
  if (!same) {
    panel.scrollTop = 0;
    return;
  }
  const counts = {};
  for (const summary of panel.querySelectorAll("summary")) {
    const key = summary.textContent;
    counts[key] = (counts[key] ?? -1) + 1;
    if (open.has(`${key}:${counts[key]}`)) summary.parentElement.open = true;
  }
  panel.scrollTop = scroll;
  if (focusIndex >= 0) controls()[focusIndex]?.focus({ preventScroll: true });
}

function drawInspector() {
  document
    .querySelectorAll("[data-tab]")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === editor.activeTab));
  const panel = $("inspector-content");
  panel.replaceChildren();
  syncAddKinds();
  if (editor.activeTab === "world") {
    panel.append(node("h3", editor.documentData.label));
    field(panel, "Map name", editor.documentData.label, (v) =>
      transaction(() => {
        editor.documentData.label = v;
      }),
    );
    const arena = mapArena(map()),
      w = arena.world,
      c = arena.camera;
    const mode = section("Game mode");
    panel.append(mode);
    mode.append(
      node(
        "p",
        arena.modeId === "duels"
          ? "Duels · shared by 1v1 and 2v2 · 2 spawn slots per team"
          : `${arena.label} · ${arena.playersPerTeam} players per team`,
      ),
    );
    mode.append(
      node(
        "div",
        `World ${w.width} × ${w.height}. The camera shows ${c.width} × ${c.height} of it and zooms ${c.minZoom}–${c.maxZoom}×. This map uses these bounds in every match format.`,
        { class: "notice" },
      ),
    );
    const powerups = section("Powerup rules");
    panel.append(powerups);
    for (const [k, label] of [
      ["spawnIntervalMs", "Spawn interval (ms)"],
      ["maxActive", "Maximum active"],
      ["despawnMs", "Lifetime (ms)"],
    ])
      field(powerups, label, map().powerups[k], (v) => editValue(map().powerups, k, v));
    const powerupAdvanced = advanced(powerups);
    for (const [k, label] of [
      ["pickupRadius", "Orb pickup radius (px)"],
      ["omenMs", "Spawn warning (ms)"],
      ["spawnLift", "Legacy anchored spawn lift (px)"],
    ])
      field(powerupAdvanced, label, map().powerups[k], (v) => editValue(map().powerups, k, v));
    for (const type of POWERUP_TYPES)
      check(powerups, type, (map().powerups.types ?? POWERUP_TYPES).includes(type), (v) =>
        transaction(() => {
          const types = map().powerups.types ?? POWERUP_TYPES;
          map().powerups.types = v ? [...types, type] : types.filter((t) => t !== type);
        }),
      );
    const meta = advanced(panel, "Map catalog settings");
    recursiveFields(meta, editor.documentData.metadata);
    return;
  }
  if (editor.activeTab === "scenery") {
    renderScenery(panel);
    return;
  }
  if (editor.activeTab === "assets") {
    panel.append(
      node("h3", "Platform artwork"),
      node(
        "p",
        "Place artwork on the map, or drop an image onto a card to replace every matching platform.",
      ),
    );
    button(panel, "＋ New platform artwork", () => assetDialog());
    for (const [key, asset] of Object.entries(map().assets)) {
      const row = node("div", undefined, { class: "asset-row" });
      const preview = node("div", undefined, { class: "asset-preview" });
      preview.append(node("img", undefined, { src: asset.url, alt: friendlyName(key) }));
      const info = node("div", undefined, { class: "asset-info" });
      info.append(
        node("strong", friendlyName(key)),
        node(
          "small",
          `${asset.type === "image" ? "Still image" : "Animated"} · ${map().textureSizes[key]?.width} × ${map().textureSizes[key]?.height} px`,
        ),
      );
      const actions = node("div", undefined, { class: "asset-actions" });
      button(actions, "Place platform", () => addObject("platform", key), "asset-place");
      button(actions, "Edit artwork", () => assetDialog(key));
      const upload = node("input", undefined, {
        type: "file",
        accept: "image/png,image/webp,image/jpeg",
        hidden: "",
      });
      upload.onchange = () => replaceArtwork(key, upload.files[0]);
      button(actions, "Replace image…", () => upload.click());
      row.append(preview, info, actions, upload);
      row.ondragover = (event) => {
        event.preventDefault();
        row.classList.add("drop-target");
      };
      row.ondragleave = () => row.classList.remove("drop-target");
      row.ondrop = (event) => {
        event.preventDefault();
        row.classList.remove("drop-target");
        replaceArtwork(key, event.dataTransfer.files[0]);
      };
      panel.append(row);
    }
    return;
  }
  if (editor.selectedIds.size > 1) {
    panel.append(
      node("h3", `${editor.selectedIds.size} objects selected`),
      node(
        "p",
        "Drag any of them to move them together. Arrow keys nudge the group. Shift-click toggles an object.",
      ),
    );
    const actions = node("div", undefined, { class: "stack-actions" });
    panel.append(actions);
    button(actions, "Duplicate selection", duplicate);
    button(actions, "Delete selection", remove, "danger");
    button(actions, "Clear selection", () => select(null));
    return;
  }
  const row = selected();
  if (!row) {
    panel.append(
      node("h3", "Select an object"),
      node(
        "p",
        "Click a platform or marker on the map, or pick one from the object list, to edit it.",
      ),
      node(
        "div",
        "Drag a handle to resize; hold Shift to resize freely. Tab switches between artwork and collision handles.",
        { class: "notice" },
      ),
      node(
        "div",
        "Spawn markers always attach to a safe platform, even with snapping off. Hold ⌘/Ctrl while dragging to skip snapping.",
        { class: "notice" },
      ),
    );
    return;
  }
  const p = row.value;
  panel.append(
    node("h3", p.label || (row.kind === "spawn" ? spawnName(row) : friendlyName(row.id))),
    node("div", `${KIND_LABELS[row.kind] || row.kind} · ${row.id}`, {
      class: "inspector-subtitle",
    }),
  );
  if (!["spawn", "vault", "respawn"].includes(row.kind))
    field(panel, "Label", p.label || "", (v) => editValue(p, "label", v));
  if (row.kind === "spawn") {
    panel.append(
      node(
        "p",
        "Anchored to a walkable collision surface. Move the platform and this marker follows.",
      ),
    );
    const geom = geometryFromMap(map());
    const surfaces = geom.colliders.filter((c) => c.collision.up && !c.motion);
    field(
      panel,
      "Platform",
      p.anchorId,
      (v) =>
        transaction(() => {
          p.anchorId = v;
          p.dx = 0;
          delete p.x;
          delete p.y;
        }),
      { options: surfaces.map((c) => [c.id, c.id]) },
    );
    field(panel, "Horizontal offset", p.dx ?? 0, (v) =>
      transaction(() => {
        p.dx = v;
        delete p.x;
        delete p.y;
      }),
    );
    button(panel, "Playtest from here", () => setPreview(true, row));
  } else if (row.kind === "cloud") {
    renderCloudInspector(panel, p);
  } else {
    const grid = node("div", undefined, { class: "fields" });
    panel.append(grid);
    for (const k of ["x", "y"])
      field(grid, k.toUpperCase(), mapPoint(row)[k], (v) =>
        transaction(() => {
          if (row.kind === "powerup") {
            Object.assign(p, mapPoint(row));
            delete p.anchorId;
            delete p.dx;
          }
          p[k] = v;
        }),
      );
    if (row.kind === "powerup") {
      field(
        panel,
        "Powerup type",
        p.type || "",
        (v) =>
          transaction(() => {
            if (v) p.type = v;
            else delete p.type;
          }),
        { options: [["", "Random available type"], ...POWERUP_TYPES] },
      );
      check(panel, "Enabled", p.enabled !== false, (v) => editValue(p, "enabled", v));
      panel.append(node("p", "Place this powerup anywhere in the world."));
    }
    if (row.kind === "platform") {
      field(
        panel,
        "Texture",
        p.textureKey,
        (v) =>
          transaction(() => {
            p.textureKey = v;
            delete p.frame;
          }),
        { options: Object.keys(map().assets) },
      );
      const transform = section("Visual size");
      panel.append(transform);
      const dims = map().textureSizes[p.textureKey];
      for (const [axis, key] of [
        ["width", "scaleX"],
        ["height", "scaleY"],
      ])
        field(
          transform,
          labelFor(axis),
          Math.round(dims[axis] * p[key] * 100) / 100,
          (v, event) =>
            transaction(() => {
              const ratio = v / (dims[axis] * p[key]);
              const axes = event.shiftKey ? [axis] : ["width", "height"];
              for (const dimension of axes) {
                const scale = dimension === "width" ? "scaleX" : "scaleY";
                p[scale] = Math.round(dims[dimension] * p[scale] * ratio) / dims[dimension];
                if (p.body?.[dimension])
                  p.body[dimension] = Math.max(1, Math.round(p.body[dimension] * ratio));
              }
            }),
          { min: 1 },
        );
      const more = advanced(transform);
      if (map().assets[p.textureKey].type !== "image")
        field(more, "Frame", p.frame ?? "", (v) =>
          transaction(() => {
            if (v !== "")
              p.frame = map().assets[p.textureKey].type === "spritesheet" ? Number(v) : v;
            else delete p.frame;
          }),
        );
      field(more, "Depth", p.depth ?? 0, (v) => editValue(p, "depth", v));
      field(
        more,
        "Opacity (%)",
        Math.round((p.alpha ?? 1) * 100),
        (v) => editValue(p, "alpha", v / 100),
        { min: 0, max: 100 },
      );
      check(transform, "Flip horizontally", p.flipX, (v) => editValue(p, "flipX", v));
      check(transform, "Flip vertically", p.flipY, (v) => editValue(p, "flipY", v));
      const toggle = button(
        panel,
        editor.handleMode === "artwork"
          ? "Artwork handles · Tab for collision"
          : "Collision handles · Tab for artwork",
        () => {
          editor.handleMode = editor.handleMode === "artwork" ? "collision" : "artwork";
          renderInspector();
        },
      );
      toggle.classList.add(
        "handle-toggle",
        editor.handleMode === "collision" ? "collision-mode" : "artwork-mode",
      );
      const body = advanced(panel, "Collision details");
      const b = p.body || {};
      for (const k of ["width", "height", "offsetX", "offsetY"])
        field(
          body,
          labelFor(k),
          b[k] ?? (/width|height/.test(k) ? dims[k] * p[k === "width" ? "scaleX" : "scaleY"] : 0),
          (v) =>
            transaction(() => {
              if (!p.body) p.body = {};
              p.body[k] = v;
            }),
        );
      body.append(
        node("div", "Width/height are world pixels. Offsets are unscaled texture pixels.", {
          class: "muted",
        }),
      );
      const motion = section("Movement");
      panel.append(motion);
      check(motion, "Moving platform", !!p.motion, (v) =>
        transaction(
          () => {
            if (!v) {
              delete p.motion;
              return;
            }
            if (
              allRows(map()).some(
                (r) => ["spawn", "powerup"].includes(r.kind) && r.value.anchorId === p.id,
              )
            )
              throw Error(
                `${p.id} supports a spawn. Move its spawn markers to another platform before making it move.`,
              );
            p.motion = { ...MOTION_DEFAULTS };
          },
          v ? "Platform now moves" : "Platform is now static",
        ),
      );
      if (p.motion) {
        const m = p.motion;
        field(motion, "Direction", m.axis, (v) => editValue(m, "axis", v), {
          options: [
            ["y", "Up and down"],
            ["x", "Left and right"],
          ],
        });
        field(
          motion,
          m.axis === "x" ? "Travel (px, negative goes left)" : "Travel (px, negative goes up)",
          m.distance,
          (v) => editValue(m, "distance", v),
        );
        field(motion, "Speed (px/sec)", m.speed, (v) => editValue(m, "speed", v), {
          min: 5,
          max: 2000,
        });
        field(motion, "Ease", m.ease, (v) => editValue(m, "ease", v), {
          options: MOTION_EASES.map((e) => [e, EASE_LABELS[e] || e]),
        });
        const timing = advanced(motion, "Timing");
        field(timing, "Pause at each end (ms)", m.pauseMs ?? 0, (v) => editValue(m, "pauseMs", v), {
          min: 0,
        });
        field(
          timing,
          "Start offset (%)",
          Math.round((m.phase ?? 0) * 100),
          (v) => editValue(m, "phase", v / 100),
          { min: 0, max: 100 },
        );
        const roundTrip = 2 * (Math.abs(m.distance) / m.speed + (m.pauseMs || 0) / 1000);
        motion.append(
          node(
            "div",
            `Round trip ${roundTrip.toFixed(1)} s. Drag the round handle on the canvas to set how far it travels. Speed is the average; eases go faster mid-way.`,
            { class: "muted" },
          ),
        );
      }
    } else
      for (const [key, value] of Object.entries(p))
        if (
          row.kind !== "powerup" &&
          !["x", "y", "id", "type", "label", "collision", "collisionEnabled"].includes(key) &&
          typeof value !== "object"
        )
          field(
            panel,
            key === "turnSpeed" ? "Turn speed (%)" : labelFor(key),
            key === "turnSpeed" ? value * 100 : value,
            (v) => editValue(p, key, key === "turnSpeed" ? v / 100 : v),
          );
    if (["platform", "hitbox"].includes(row.kind)) {
      const collision = advanced(panel, "Collision behavior");
      check(collision, "Enabled", p.collisionEnabled !== false, (v) =>
        editValue(p, "collisionEnabled", v),
      );
      for (const side of ["up", "down", "left", "right"])
        check(
          collision,
          {
            up: "Land on top",
            down: "Block from below",
            left: "Block left side",
            right: "Block right side",
          }[side],
          p.collision?.[side] !== false,
          (v) =>
            transaction(() => {
              if (!p.collision) p.collision = { up: true, down: true, left: true, right: true };
              p.collision[side] = v;
            }),
        );
    }
  }
  const actions = node("div", undefined, { class: "row-actions" });
  panel.append(actions);
  if (!["spawn", "vault", "respawn"].includes(row.kind)) {
    button(actions, "Duplicate", duplicate);
    button(actions, "Delete", remove, "danger");
  }
}

export { editValue, renderBrowser, select, recursiveFields, renderInspector };
