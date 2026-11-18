import { node, showDialog } from "./studioControls";

const SHORTCUTS = [
  ["Undo", ["⌘/Ctrl", "Z"]],
  ["Redo", ["⌘/Ctrl", "Shift", "Z"]],
  ["Save", ["⌘/Ctrl", "S"]],
  ["Playtest / return", ["Esc"]],
  ["Duplicate", ["D"]],
  ["Delete", ["Del"]],
  ["Select all", ["⌘/Ctrl", "A"]],
  ["Nudge 1 px / 16 px", ["Arrows", "Shift"]],
  ["Multi-select", ["Shift", "Click"]],
  ["Box-select", ["Drag empty space"]],
  ["Pan", ["Space", "Drag"]],
  ["Pan (mouse)", ["Right-drag"]],
  ["Zoom at cursor", ["Scroll"]],
  ["Zoom in / out", ["+", "−"]],
  ["Fit world", ["F"]],
  ["Game camera", ["C"]],
  ["Artwork / collision handles", ["Tab"]],
  ["Skip snapping", ["⌘/Ctrl", "Drag"]],
  ["Resize freely", ["Shift", "Drag handle"]],
  ["Centre on object", ["Double-click row"]],
];

function shortcutsDialog() {
  const list = node("dl", undefined, { class: "shortcut-list" });
  for (const [label, keys] of SHORTCUTS) {
    const row = node("div"),
      keysEl = node("dd");
    for (const k of keys) keysEl.append(node("kbd", k));
    row.append(node("dt", label), keysEl);
    list.append(row);
  }
  showDialog("Keyboard shortcuts", list, null, "Got it");
}

export { shortcutsDialog };
