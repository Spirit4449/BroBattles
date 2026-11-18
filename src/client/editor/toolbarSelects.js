import { createMapModeSelect } from "./mapModeSelect.js";
import { createCharacterSkinSelect } from "./characterSkinSelect.js";
import { createPixelSelect } from "../ui/pixelSelect.js";
import { $ } from "./studioState";

// Keep the native fields as the editor's data interface; Settings supplies the UI.
const toolbarSelects = new Map();

function syncToolbarSelect(id, { rebuild = false } = {}) {
  const input = $(id);
  let control = toolbarSelects.get(id);
  if (rebuild && control) {
    control.setDisabled(true);
    control.element.remove();
    toolbarSelects.delete(id);
    control = null;
  }
  if (!control && input.options.length) {
    control = (
      id === "map-select"
        ? createMapModeSelect
        : id === "playtest-character"
          ? createCharacterSkinSelect
          : createPixelSelect
    )({
      skinId: $("playtest-skin").value,
      options: [...input.options]
        .filter((option) => !option.hidden && !option.disabled)
        .map((option) => ({
          value: option.value,
          label: option.textContent,
          modeVariantId: option.dataset.modeVariantId,
        })),
      value: input.value,
      label: input.getAttribute("aria-label"),
      className: `studio-toolbar-select ${id === "map-select" ? "studio-map-select" : "is-compact"}`,
      onChange(value, skinId) {
        input.value = value;
        if (skinId) {
          $("playtest-skin").value = skinId;
          $("playtest-skin").dispatchEvent(new Event("change", { bubbles: true }));
        }
        input.dispatchEvent(new Event("change", { bubbles: true }));
      },
    });
    input.classList.add("studio-native-select");
    input.after(control.element);
    toolbarSelects.set(id, control);
  }
  if (control) {
    control.setValue(input.value);
    control.setDisabled(input.disabled);
    control.element.hidden = input.hidden;
  }
}

export { syncToolbarSelect };
