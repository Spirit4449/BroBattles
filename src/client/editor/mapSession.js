import { API_PATHS, mapDocumentPath, mapPlaytestPath } from "../../shared/net/apiPaths.js";
import { createDraftStore } from "./draftStore";
import { HttpError, requestJson } from "../lib/http.js";
import { diffUnsaved, discardChanges } from "./unsavedChanges";
import { preloadMapDocument } from "../game/maps/documentRuntime";
import { releaseRendererContext, rendererContextOf } from "../game/scene/releaseRenderer.js";
import { preloadScenery, sceneryTextureKey } from "../game/maps/sceneryRuntime";
import {
  clone,
  upgradeDuelMap,
  MapHistory,
  validateDocument,
  validateMap,
} from "../../shared/maps/mapDocument";
import { arenaFor, arenaIds, mapArena } from "../../shared/maps/arenas";
import { sceneryParts, sceneryUrls } from "../../shared/maps/scenery";
import { allRows, exportDocument, retargetMap } from "./editorModel";
import { $, editor, friendlyName, map, status, dirty, setBusy } from "./studioState";
import { syncToolbarSelect } from "./toolbarSelects";
import { error, node, showDialog, field } from "./studioControls";
import { renderBrowser, renderInspector } from "./inspector";
import { StudioScene } from "./canvasInteraction";

async function request(url, options = {}) {
  try {
    return await requestJson(url, {
      ...options,
      fallbackMessage: (status) => `Request failed (${status})`,
    });
  } catch (error) {
    if (error instanceof HttpError && Array.isArray(error.errors) && error.errors.length) {
      error.message = [error.message, ...error.errors.slice(0, 8)].join("\n");
    }
    throw error;
  }
}

const draftStore = createDraftStore();

function persistDraft() {
  if (!editor.documentData || !editor.history) return Promise.resolve();
  return draftStore.save(editor.documentData, editor.revision, editor.history).catch((error) => {
    console.warn("[Map Studio] Draft storage failed", error);
    status("Draft storage is unavailable. Save or export to keep your edits.", { error: true });
  });
}

function refreshSave() {
  const state = $("save-state");
  const unsaved = dirty();
  state.classList.toggle("is-dirty", unsaved);
  if (unsaved) state.textContent = editor.revision === null ? "Not saved yet" : "Unsaved changes";
  else
    state.replaceChildren(
      node("img", undefined, { src: "/assets/ui/pixel-check.webp", alt: "" }),
      "Saved",
    );
  $("undo").disabled = !editor.history || editor.history.index === 0;
  $("redo").disabled = !editor.history || editor.history.index === editor.history.stack.length - 1;
}

// Repeated small edits (arrow nudges) fold into one undo step.
let lastCommit = { message: null, at: 0 };

function commit(message = "Edit applied", { merge = false } = {}) {
  const now = performance.now(),
    fold =
      merge &&
      lastCommit.message === message &&
      now - lastCommit.at < 900 &&
      editor.history.index > 0 &&
      editor.history.index === editor.history.stack.length - 1;
  if (fold) editor.history.stack[editor.history.index] = clone(editor.documentData);
  else editor.history.commit(editor.documentData);
  lastCommit = { message, at: now };
  persistDraft();
  refreshSave();
  renderBrowser();
  renderInspector();
  status(message);
}

// Loads scenery art introduced by an edit or a history change.
function sceneryMissing() {
  if (!editor.scene) return false;
  const { scenery } = map();
  const urls = [...sceneryUrls(scenery), ...sceneryParts(scenery).map(part => part.url)];
  return urls.some(url => !editor.scene.textures.exists(sceneryTextureKey(url)));
}

function transaction(fn, message, options) {
  if (editor.busy) return;
  const before = clone(editor.documentData);
  try {
    fn();
    const errors = validateMap(map());
    if (errors.length) throw Error(errors.slice(0, 6).join("\n"));
    editor.scene?.rebuild();
    commit(message, options);
    if (sceneryMissing()) syncHistoryScene().catch(error);
  } catch (e) {
    editor.documentData = before;
    editor.scene?.rebuild();
    renderBrowser();
    renderInspector();
    error(e);
  }
}

async function startScene() {
  setBusy(true);
  $("marker-layer").replaceChildren();
  editor.cameraPreview = false;
  document.body.classList.remove("camera-preview");
  $("camera-preview").setAttribute("aria-pressed", "false");
  if (editor.game) {
    const retiringContext = rendererContextOf(editor.game);
    const retired = new Promise((r) => editor.game.events.once(Phaser.Core.Events.DESTROY, r));
    editor.game.destroy(true);
    editor.game = null;
    editor.scene = null;
    await Promise.race([retired, new Promise((r) => setTimeout(r, 30))]);
    releaseRendererContext(retiringContext);
  }
  return new Promise((resolve) => {
    editor.sceneReady = () => {
      setBusy(false);
      resolve();
    };
    const host = $("canvas");
    editor.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: host.clientWidth,
      height: host.clientHeight,
      backgroundColor: "#111d29",
      transparent: false,
      pixelArt: true,
      physics: { default: "arcade", arcade: { gravity: { y: 0 } } },
      scale: { mode: Phaser.Scale.NONE },
      scene: StudioScene,
    });
  });
}

async function setPreview(value, row = null) {
  if (!editor.scene || editor.busy) return;
  if (!value) {
    const token = editor.playtestSession;
    editor.playtestSession = null;
    editor.playtestFrame?.remove();
    editor.playtestFrame = null;
    editor.preview = false;
    document.body.classList.remove("preview");
    editor.keyboard.clear();
    editor.game.scene.resume("studio");
    editor.game.scale.resize($("viewport").clientWidth, $("viewport").clientHeight);
    if (token)
      request(mapPlaytestPath(token), { method: "DELETE" }).catch((e) => status(e.message));
    return;
  }
  editor.scene.pointerUp();
  setBusy(true);
  try {
    const result = await request(API_PATHS.API_ADMIN_MAP_PLAYTESTS, {
      method: "POST",
      body: JSON.stringify({
        document: editor.documentData,
        modeVariantId: mapArena(map()).modeId === "duels" ? $("playtest-formation").value : null,
        bots: $("playtest-kind").value === "bots",
        fullBattle: $("playtest-full-battle").checked,
        infiniteSupers: $("infinite-supers").checked,
        debugHitboxes: $("debug-hitboxes").checked,
        character: $("playtest-character").value,
        skinId: $("playtest-skin").value,
        spawn: row?.kind === "spawn" ? { point: row.value } : null,
      }),
    });
    editor.playtestSession = result.session;
    editor.preview = true;
    editor.keyboard.clear();
    editor.game.scene.pause("studio");
    document.body.classList.add("preview");
    editor.playtestFrame = node("iframe", undefined, {
      id: "playtest-frame",
      title: "Live game playtest",
      src: `/map-editor/playtest?session=${result.session}&match=${result.matchId}`,
      allow: "autoplay; fullscreen",
    });
    document.body.append(editor.playtestFrame);
    editor.playtestFrame.onload = () => editor.playtestFrame?.contentWindow?.focus();
  } catch (e) {
    error(e);
  } finally {
    setBusy(false);
  }
}

window.addEventListener("message", (event) => {
  if (
    event.origin === location.origin &&
    event.source === editor.playtestFrame?.contentWindow &&
    event.data?.type === "bb-map-playtest-exit"
  )
    setPreview(false);
});

async function syncHistoryScene() {
  const wanted = map().assets,
    previous = editor.scene._loadedAssets || {};
  const changed = Object.keys(wanted).filter(
    (key) =>
      !editor.scene.textures.exists(key) ||
      JSON.stringify(wanted[key]) !== JSON.stringify(previous[key]),
  );
  if (changed.length || sceneryMissing()) {
    setBusy(true);
    for (const key of changed) {
      for (const object of editor.scene.mapObjects.filter((o) => o.texture?.key === key)) {
        object.setTexture("__DEFAULT");
        object._mapRowJSON = null;
      }
      if (editor.scene.textures.exists(key)) editor.scene.textures.remove(key);
      if (editor.scene.anims.exists(`map-animation-${key}`))
        editor.scene.anims.remove(`map-animation-${key}`);
    }
    preloadMapDocument(editor.scene, map());
    preloadScenery(editor.scene, map());
    await new Promise((resolve) => {
      editor.scene.load.once("complete", resolve);
      editor.scene.load.start();
    });
    setBusy(false);
  }
  editor.scene._loadedAssets = clone(wanted);
  editor.scene.sceneryKey = null;
  editor.scene.rebuild();
}

async function loadMap(id) {
  setBusy(true);
  try {
    const draft = await draftStore.load(id).catch((error) => {
      console.warn("[Map Studio] Could not read map draft", error);
      return null;
    });
    const published =
      editor.mapList.some((map) => map.id === id && map.localDraft) && draft?.revision === null
        ? null
        : await request(mapDocumentPath(id));
    editor.savedJSON = published ? JSON.stringify(published.document) : "";
    editor.documentData = draft?.document ?? published.document;
    editor.revision = draft ? draft.revision : published.revision;
    editor.history = draft?.history ?? new MapHistory(editor.documentData);
    if (draft && JSON.stringify(draft.document) === editor.savedJSON)
      editor.revision = published.revision;
    if (draft && dirty()) status("Recovered local draft.");
    lastCommit = { message: null, at: 0 };
    editor.selectedId = null;
    editor.selectedIds.clear();
    $("map-select").value = id;
    syncToolbarSelect("map-select");
    renderBrowser();
    renderInspector();
    refreshSave();
    await startScene();
  } catch (e) {
    error(e);
  } finally {
    setBusy(false);
  }
}

async function save() {
  if (editor.busy || !editor.documentData) return;
  editor.scene?.pointerUp();
  const errors = validateDocument(editor.documentData);
  if (errors.length) {
    error(Error(errors.join("\n")));
    return;
  }
  setBusy(true);
  try {
    const result = await request(mapDocumentPath(editor.documentData.id), {
      method: "PUT",
      body: JSON.stringify({ document: editor.documentData, revision: editor.revision }),
    });
    editor.revision = result.revision;
    editor.documentData = result.document;
    editor.history.stack[editor.history.index] = clone(editor.documentData);
    editor.savedJSON = JSON.stringify(editor.documentData);
    await persistDraft();
    await syncHistoryScene();
    renderInspector();
    refreshSave();
    status("Saved. New matches will use this revision; existing matches keep their current map.");
    await refreshMaps();
  } catch (e) {
    error(e);
  } finally {
    setBusy(false);
  }
}

async function showUnsavedChanges() {
  if (editor.busy || !editor.documentData) return;
  editor.scene?.pointerUp();
  const content = node("div", undefined, { class: "pending-changes" });
  showDialog("Unsaved changes", content, null, "Close");
  content.append(node("p", "Comparing with the live map…"));
  let live;
  setBusy(true);
  try {
    if (editor.revision === null) {
      content.replaceChildren(
        node("p", "This new map has not been saved yet. Discarding it removes the local draft."),
      );
      const discard = node("button", "Discard new map", { type: "button", class: "danger" });
      discard.onclick = async () => {
        await draftStore.remove(editor.documentData.id);
        $("dialog").close();
        await refreshMaps();
        await loadMap(editor.mapList[0].id);
      };
      content.append(discard);
      return;
    }
    live = await request(mapDocumentPath(editor.documentData.id));
  } catch (e) {
    content.replaceChildren(node("p", e.message, { class: "errors" }));
    return;
  } finally {
    setBusy(false);
  }
  const render = () => {
    const changes = diffUnsaved(live.document, editor.documentData),
      chosen = new Set();
    content.replaceChildren(
      node(
        "p",
        changes.length
          ? `${changes.length} pending changes compared with the live map. Only current differences are shown.`
          : "Your draft matches the live map.",
      ),
    );
    if (!changes.length) return;
    const actions = node("div", undefined, { class: "pending-actions" }),
      list = node("ol", undefined, { class: "pending-list" }),
      message = node("p", "", { class: "errors", role: "status" });
    const discardSelected = node("button", "Discard selected", { type: "button" }),
      discardAll = node("button", "Discard all", { type: "button", class: "danger" });
    discardSelected.disabled = true;
    const apply = async (all) => {
      if (editor.busy) return;
      const candidate = all
        ? clone(live.document)
        : discardChanges(
            editor.documentData,
            changes.filter((_, i) => chosen.has(i)),
          );
      const errors = validateDocument(candidate);
      if (errors.length) {
        message.textContent =
          "These changes depend on other edits. Select the related changes too, or discard all. " +
          errors.slice(0, 3).join(" ");
        return;
      }
      setBusy(true);
      discardSelected.disabled = true;
      discardAll.disabled = true;
      try {
        editor.documentData = candidate;
        if (all || diffUnsaved(live.document, candidate).length === 0) {
          editor.revision = live.revision;
          editor.savedJSON = JSON.stringify(live.document);
        }
        editor.selectedId = null;
        editor.selectedIds.clear();
        commit(all ? "All unsaved changes discarded." : "Selected changes discarded.");
        await syncHistoryScene();
        render();
      } catch (e) {
        message.textContent = e.message;
      } finally {
        setBusy(false);
      }
    };
    discardSelected.onclick = () => apply(false);
    discardAll.onclick = () => apply(true);
    actions.append(discardSelected, discardAll);
    content.append(actions, message, list);
    const format = (value) =>
      value === undefined
        ? "Not present"
        : typeof value === "object"
          ? JSON.stringify(value, null, 2)
          : String(value);
    changes.forEach((change, i) => {
      const item = node("li", undefined, { class: "pending-change" }),
        label = node("label"),
        check = node("input", undefined, { type: "checkbox" });
      const kind =
        change.before === undefined ? "Added" : change.after === undefined ? "Removed" : "Changed";
      const title = change.path
        .map((part) => (typeof part === "object" ? part.id : friendlyName(part)))
        .join(" › ");
      check.onchange = () => {
        if (check.checked) chosen.add(i);
        else chosen.delete(i);
        discardSelected.disabled = !chosen.size;
        discardSelected.textContent = chosen.size
          ? `Discard selected (${chosen.size})`
          : "Discard selected";
      };
      label.append(check, node("strong", title), node("span", kind, { class: "change-kind" }));
      item.append(label);
      const details = node("details");
      details.append(node("summary", "Live → draft"));
      const values = node("div", undefined, { class: "change-values" });
      for (const [name, value] of [
        ["Live", change.before],
        ["Draft", change.after],
      ]) {
        const col = node("div");
        col.append(node("b", name), node("pre", format(value)));
        values.append(col);
      }
      details.append(values);
      item.append(details);
      list.append(item);
    });
  };
  render();
}

function download() {
  const { document: exported, files: pending } = exportDocument(editor.documentData);
  const blob = new Blob([JSON.stringify(exported, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = node("a", undefined, { href: url, download: `map-${editor.documentData.id}.json` });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  status("Exported the full map document.");
  if (pending.size) {
    const info = node("div");
    info.append(
      node(
        "p",
        "JSON does not include uploaded image files. Manually replace these game files when using this export:",
      ),
    );
    for (const file of pending) info.append(node("p", "public" + file));
    showDialog("Images needed for this export", info, null, "Got it");
  }
}

function importDialog() {
  if (editor.busy) return;
  const content = node("div");
  content.append(
    node(
      "p",
      "Paste a complete versioned map document, or select an exported JSON file. Import replaces the whole map and can be undone.",
    ),
  );
  const input = node("input", undefined, { type: "file", accept: ".json,application/json" });
  const text = node("textarea", undefined, {
    "aria-label": "Map document JSON",
    spellcheck: "false",
  });
  input.onchange = async () => {
    if (input.files[0]) text.value = await input.files[0].text();
  };
  content.append(input, text);
  showDialog("Import map document", content, async () => {
    let doc;
    try {
      doc = upgradeDuelMap(JSON.parse(text.value));
    } catch {
      throw Error("Invalid JSON.");
    }
    const errors = validateDocument(doc);
    if (errors.length) throw Error(errors.slice(0, 12).join("\n"));
    if (doc.id !== editor.documentData.id)
      throw Error(
        "The imported map ID must match the open map. Use New map to create a separate map.",
      );
    editor.documentData = doc;
    editor.selectedId = null;
    editor.selectedIds.clear();
    commit("Document imported");
    await syncHistoryScene();
  });
}

async function refreshMaps() {
  const { maps } = await request(API_PATHS.API_ADMIN_MAPS);
  const drafts = await draftStore.unsavedMaps();
  editor.mapList = [
    ...maps,
    ...drafts
      .filter((draft) => !maps.some((map) => map.id === draft.id))
      .map(({ id, label, modeVariantId }) => ({ id, label, modeVariantId, localDraft: true })),
  ];
  $("map-select").replaceChildren(
    ...editor.mapList.map((m) =>
      node("option", m.label, { value: m.id, "data-mode-variant-id": m.modeVariantId }),
    ),
  );
  if (editor.documentData) $("map-select").value = editor.documentData.id;
  syncToolbarSelect("map-select", { rebuild: true });
}

function newMapDialog() {
  if (editor.busy) return;
  const content = node("div");
  const values = {
    id: Math.max(...editor.mapList.map((m) => m.id)) + 1,
    label: "New map",
    modeVariantId: map().modeVariantId,
  };
  content.append(
    node(
      "p",
      "Create a separate map, starting as a copy of this one: platforms, art and scenery. Duel maps support both 1v1 and 2v2 and keep this map’s arena profile.",
    ),
  );
  field(content, "Map ID", values.id, (v) => (values.id = v), { min: 1 });
  field(content, "Map name", values.label, (v) => (values.label = v));
  field(content, "Game mode", values.modeVariantId, (v) => (values.modeVariantId = v), {
    options: arenaIds().map((id) => [id, arenaFor(id).label]),
  });
  showDialog(
    "Create map",
    content,
    async () => {
      if (editor.mapList.some((m) => m.id === values.id)) throw Error("Map ID already exists.");
      const doc = retargetMap(editor.documentData, values.modeVariantId);
      doc.id = values.id;
      doc.label = values.label;
      doc.metadata.key = `map-${doc.id}`;
      const errors = validateDocument(doc);
      if (errors.length) throw Error(errors.join("\n"));
      persistDraft();
      editor.documentData = doc;
      editor.revision = null;
      editor.savedJSON = "";
      editor.history = new MapHistory(doc);
      editor.selectedId = null;
      editor.selectedIds.clear();
      commit(
        "New map created locally. Move its platforms and spawns to suit the mode, then save to add it to the map catalog.",
      );
      editor.mapList.push({
        id: doc.id,
        label: doc.label,
        modeVariantId: doc.modeVariantId,
        localDraft: true,
      });
      $("map-select").append(
        node("option", doc.label, { value: doc.id, "data-mode-variant-id": doc.modeVariantId }),
      );
      $("map-select").value = doc.id;
      syncToolbarSelect("map-select", { rebuild: true });
      await startScene();
    },
    "Create",
  );
}

async function undo(redo = false) {
  if (!editor.history || editor.busy) return;
  editor.documentData = redo ? editor.history.redo() : editor.history.undo();
  editor.selectedIds = new Set(
    [...editor.selectedIds].filter((id) => allRows(map()).some((r) => r.id === id)),
  );
  editor.selectedId = [...editor.selectedIds].at(-1) || null;
  persistDraft();
  refreshSave();
  renderBrowser();
  renderInspector();
  await syncHistoryScene();
  status(redo ? "Edit restored" : "Edit undone");
}

export {
  request,
  persistDraft,
  commit,
  transaction,
  setPreview,
  syncHistoryScene,
  loadMap,
  save,
  showUnsavedChanges,
  download,
  importDialog,
  refreshMaps,
  newMapDialog,
  undo,
};
