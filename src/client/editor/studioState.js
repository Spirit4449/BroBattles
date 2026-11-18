import { allRows } from "./editorModel";
import { syncToolbarSelect } from "./toolbarSelects";

const $ = (id) => document.getElementById(id);

const editor = {
  documentData: null,
  revision: null,
  savedJSON: null,
  history: null,
  game: null,
  scene: null,
  mapList: [],
  selectedId: null,
  activeTab: "selection",
  preview: false,
  cameraPreview: false,
  busy: false,
  guidelines: [],
  keyboard: new Set(),
  drag: null,
  sceneReady: null,
  playtestSession: null,
  playtestFrame: null,
  selectedIds: new Set(),
  handleMode: "artwork",
};

const friendlyName = (value) =>
  String(value)
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

// Property keys as field labels: offsetX → Offset X.
const labelFor = (key) => {
  const words = String(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[-_]/g, " ")
    .toLowerCase();
  return (
    words.charAt(0).toUpperCase() +
    words
      .slice(1)
      .replace(/\b(x|y|ms|px|id|url)\b/g, (w) => ({ ms: "(ms)", px: "(px)" })[w] || w.toUpperCase())
  );
};

const map = () => editor.documentData;

const selected = () => allRows(map()).find((r) => r.id === editor.selectedId);

const status = (text, { error = false } = {}) => {
  const el = $("status");
  el.textContent = text;
  el.classList.toggle("is-error", error);
  el.title = text;
};

const uid = (prefix) => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;

const dirty = () => editor.documentData && JSON.stringify(editor.documentData) !== editor.savedJSON;

const setBusy = (value) => {
  editor.busy = value;
  for (const id of [
    "save",
    "map-select",
    "import",
    "new-map",
    "preview",
    "debug-hitboxes",
    "infinite-supers",
    "add",
    "camera-preview",
  ])
    $(id).disabled = value;
  syncToolbarSelect("map-select");
};

export { $, editor, friendlyName, labelFor, map, selected, status, uid, dirty, setBusy };

export function hideHint() {
  $("canvas-hint").hidden = true;
}
