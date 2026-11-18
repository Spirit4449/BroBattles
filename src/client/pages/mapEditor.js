import "../styles/ui-system.css";
import "../styles/toolShell.css";
import { isSiteDialogOpen } from "../site/dialog";
import { readJson, writeJson } from "../lib/safeStorage.js";
import { initSiteShell, openSettings } from "../site/shell.js";
import skinsCatalog from "../../shared/catalogs/skinsCatalog.cjs";
import { clone } from "../../shared/maps/mapDocument";
import { allRows, snapMove } from "../editor/editorModel";
import { hideHint, $, editor, map, selected, status, dirty } from "../editor/studioState";
import { syncToolbarSelect } from "../editor/toolbarSelects";
import { error } from "../editor/studioControls";
import {
  persistDraft,
  transaction,
  setPreview,
  loadMap,
  save,
  showUnsavedChanges,
  download,
  importDialog,
  refreshMaps,
  newMapDialog,
  undo,
} from "../editor/mapSession";
import { renderBrowser, renderInspector } from "../editor/inspector";
import { addObject, duplicate, remove } from "../editor/objectEdits";
import { mapPoint } from "../editor/canvasInteraction";
import { shortcutsDialog } from "../editor/shortcutDialog";
import { PLAYTEST_KEY, playtestInputs, syncPlaytestSummary } from "../editor/playtestControls";

import "../editor/mapEditor.css";
import "../styles/ui-components.css";

initSiteShell();

const HINT_KEY = "bb-map-studio-hint-dismissed";

try {
  $("canvas-hint").hidden = localStorage.getItem(HINT_KEY) === "1";
} catch {
  $("canvas-hint").hidden = false;
}

$("hint-close").onclick = () => {
  hideHint();
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {}
};

$("shortcuts").onclick = shortcutsDialog;

// Toolbar menus close on an outside click or after an action inside them.
const menus = [...document.querySelectorAll("details.menu")];

const closeMenus = (except) => {
  for (const menu of menus) if (menu !== except) menu.open = false;
};

document.addEventListener("pointerdown", (event) =>
  closeMenus(menus.find((menu) => menu.contains(event.target))),
);

for (const action of document.querySelectorAll(".menu-actions button"))
  action.addEventListener("click", () => closeMenus());

$("studio-settings").onclick = openSettings;

for (const entry of Object.values(skinsCatalog.characters))
  for (const skin of entry.skins) {
    $("playtest-skin").add(new Option(skin.name, skin.id));
  }

$("playtest-skin").value = skinsCatalog.characters[$("playtest-character").value].defaultSkinId;

const savedPlaytestOptions = readJson(() => localStorage, PLAYTEST_KEY);

if (savedPlaytestOptions && typeof savedPlaytestOptions === "object") {
  for (const [key, input] of Object.entries(playtestInputs)) {
    if (!(key in savedPlaytestOptions)) continue;
    if (input.type === "checkbox") input.checked = !!savedPlaytestOptions[key];
    else if ([...input.options].some((option) => option.value === savedPlaytestOptions[key]))
      input.value = savedPlaytestOptions[key];
  }
}

for (const input of Object.values(playtestInputs)) {
  input.addEventListener("change", () => {
    syncPlaytestSummary();
    const options = Object.fromEntries(
      Object.entries(playtestInputs).map(([key, field]) => [
        key,
        field.type === "checkbox" ? field.checked : field.value,
      ]),
    );
    writeJson(() => localStorage, PLAYTEST_KEY, options);
  });
}

if (
  !skinsCatalog.characters[playtestInputs.character.value].skins.some(
    (s) => s.id === playtestInputs.skin.value,
  )
)
  playtestInputs.skin.value = skinsCatalog.characters[playtestInputs.character.value].defaultSkinId;

syncPlaytestSummary();

for (const id of ["playtest-formation", "playtest-kind", "playtest-character", "grid"])
  syncToolbarSelect(id);

$("map-select").onchange = () => {
  const leaving = dirty() ? editor.documentData.label : null;
  loadMap(Number($("map-select").value)).then(() => {
    if (leaving)
      status(`Your unsaved edits to ${leaving} are kept as a draft. Open it again to continue.`);
  });
};

$("search").oninput = renderBrowser;

$("camera-preview").onclick = () => editor.scene?.setCameraPreview(!editor.cameraPreview);

$("save-state").onclick = showUnsavedChanges;

$("add").onclick = () => addObject();

$("save").onclick = save;

$("export").onclick = download;

$("import").onclick = importDialog;

$("new-map").onclick = newMapDialog;

$("undo").onclick = () => undo();

$("redo").onclick = () => undo(true);

$("preview").onclick = () => setPreview(!editor.preview);

$("fit").onclick = () => editor.scene?.fit();

$("zoom-in").onclick = () => editor.scene?.zoomBy(1.2);

$("zoom-out").onclick = () => editor.scene?.zoomBy(1 / 1.2);

document.querySelectorAll("[data-tab]").forEach(
  (b) =>
    (b.onclick = () => {
      editor.activeTab = b.dataset.tab;
      renderInspector();
    }),
);

const ARROWS = { arrowleft: [-1, 0], arrowright: [1, 0], arrowup: [0, -1], arrowdown: [0, 1] };

function nudge(dx, dy) {
  const rows = allRows(map()).filter((r) => editor.selectedIds.has(r.id));
  if (!rows.length) return;
  // A spawn riding on a selected platform already moves with it.
  transaction(
    () => {
      const base = clone(map());
      for (const row of rows) {
        if (row.kind === "spawn" && editor.selectedIds.has(row.value.anchorId)) continue;
        const original = allRows(base).find((r) => r.id === row.id),
          pt = mapPoint(original, base);
        Object.assign(row.value, snapMove(map(), row, pt.x + dx, pt.y + dy, 0, true).value);
      }
    },
    "Selection nudged",
    { merge: true },
  );
}

window.addEventListener("keydown", (ev) => {
  if (isSiteDialogOpen() || $("dialog").open || ev.target.closest?.(".bb-pixel-select")) return;
  const typing = /INPUT|SELECT|TEXTAREA/.test(ev.target.tagName);
  const key = ev.key.toLowerCase(),
    ctrl = ev.metaKey || ev.ctrlKey;
  if (key === "escape") {
    ev.preventDefault();
    if (typing) {
      ev.target.blur();
      return;
    }
    if (menus.some((m) => m.open)) {
      closeMenus();
      return;
    }
    setPreview(!editor.preview);
    return;
  }
  if (ctrl && key === "s") {
    ev.preventDefault();
    if (!editor.preview) {
      ev.target.blur?.();
      save();
    }
    return;
  }
  if (typing) return;
  if ([" ", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(key)) ev.preventDefault();
  if (key === " " && !editor.keyboard.has(" ")) {
    editor.keyboard.add(" ");
    editor.scene?.setCursor("grab");
    return;
  }
  editor.keyboard.add(key);
  if (editor.preview) return;
  if (key === "tab" && selected()?.kind === "platform") {
    ev.preventDefault();
    editor.handleMode = editor.handleMode === "artwork" ? "collision" : "artwork";
    renderInspector();
    status(editor.handleMode === "artwork" ? "Artwork handles" : "Collision handles");
    return;
  }
  if (ctrl && key === "z") {
    ev.preventDefault();
    undo(ev.shiftKey);
  } else if (ctrl && key === "y") {
    ev.preventDefault();
    undo(true);
  } else if (ctrl && key === "a") {
    ev.preventDefault();
    editor.selectedIds = new Set(allRows(map()).map((r) => r.id));
    editor.selectedId = [...editor.selectedIds].at(-1) || null;
    editor.activeTab = "selection";
    renderBrowser();
    renderInspector();
  } else if (ctrl && key === "d") {
    ev.preventDefault();
    duplicate();
  } else if (ctrl || ev.altKey) return;
  else if (key === "d") {
    ev.preventDefault();
    duplicate();
  } else if (key === "delete" || key === "backspace") {
    ev.preventDefault();
    remove();
  } else if (key === "f") {
    editor.scene?.fit();
  } else if (key === "c") {
    editor.scene?.setCameraPreview(!editor.cameraPreview);
  } else if (key === "=" || key === "+") {
    editor.scene?.zoomBy(1.2);
  } else if (key === "-" || key === "_") {
    editor.scene?.zoomBy(1 / 1.2);
  } else if (key === "?") {
    shortcutsDialog();
  } else if (ARROWS[key]) {
    const step = ev.shiftKey ? 16 : 1;
    nudge(ARROWS[key][0] * step, ARROWS[key][1] * step);
  }
});

const viewportObserver = new ResizeObserver(() => {
  if (editor.game && editor.scene && !editor.preview)
    editor.game.scale.resize($("viewport").clientWidth, $("viewport").clientHeight);
});

viewportObserver.observe($("viewport"));

window.addEventListener("keyup", (ev) => {
  const key = ev.key.toLowerCase();
  editor.keyboard.delete(key);
  if (key === " " && !editor.drag) editor.scene?.setCursor("default");
});

window.addEventListener("blur", () => {
  editor.keyboard.clear();
  editor.scene?.pointerUp();
});

window.addEventListener("pointerup", () => editor.scene?.pointerUp());

window.addEventListener("beforeunload", (ev) => {
  if (dirty()) {
    persistDraft();
    ev.preventDefault();
    ev.returnValue = "";
  }
});

(async () => {
  try {
    await refreshMaps();
    const query = new URLSearchParams(location.search);
    await loadMap(Number(query.get("map")) || editor.mapList[0].id);
    if (["1v1", "2v2"].includes(query.get("variant")))
      playtestInputs.formation.value = `duels-${query.get("variant")}`;
    syncPlaytestSummary();
  } catch (e) {
    error(e);
  }
})();
