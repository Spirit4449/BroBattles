import { BROWSER_EVENTS } from "../lib/browserEvents.js";
import { remapKeys } from "./remapKeys";
import {
  getSettings,
  saveSettings,
  resetSettings,
  subscribeSettings,
  GRAPHICS_OPTIONS,
} from "./preferences";
import { playSound } from "../ui/uiSounds";
import { privacySection } from "./privacySection";
import { element } from "../ui/dom";
import { openDialog } from "./dialog";

function openSettings() {
  const existing = document.querySelector(".site-settings-window");
  if (existing) {
    existing.close();
    return;
  }
  const inGame =
    location.pathname.startsWith("/game/") || location.pathname === "/map-editor/playtest";
  if (inGame && document.querySelector("#battle-keybind-hud")?.dataset.state === "expanded")
    document.getElementById("battle-keybind-close")?.click();
  const { dialog, body } = openDialog("Settings", { side: inGame });
  dialog.classList.add("site-settings-window");

  const form = element("div");
  const controls = {};
  const volumes = element("div", null, "site-volume-row");
  const graphicsRow = element("label", null, "site-setting");
  const graphicsInput = element("input");
  graphicsInput.type = "range";
  graphicsInput.id = "setting-graphics";
  graphicsInput.min = 0;
  graphicsInput.max = GRAPHICS_OPTIONS.length - 1;
  graphicsInput.step = 1;
  graphicsInput.setAttribute("aria-label", "Graphics");
  const graphicsValue = element("output");
  graphicsRow.htmlFor = graphicsInput.id;
  graphicsRow.append(element("span", "Graphics"), graphicsValue, graphicsInput);
  form.append(graphicsRow);
  controls.graphics = { input: graphicsInput, value: graphicsValue };
  graphicsInput.addEventListener("input", () =>
    saveSettings({ graphics: GRAPHICS_OPTIONS[Number(graphicsInput.value)].value }),
  );
  for (const [key, label, min, max, step] of [
    ["sensitivity", "Mouse sensitivity", 0.25, 3, 0.05],
    ["sfx", "SFX volume", 0, 1, 0.01],
    ["music", "Background volume", 0, 1, 0.01],
  ]) {
    const row = element("label", null, "site-setting");
    row.append(element("span", label));
    const value = element("output");
    const input = element("input");
    input.type = "range";
    input.id = `setting-${key}`;
    row.htmlFor = input.id;
    input.setAttribute("aria-label", label);
    input.min = min;
    input.max = max;
    input.step = step;
    input.addEventListener("input", () => saveSettings({ [key]: Number(input.value) }));
    input.addEventListener("change", () => {
      if (key === "sfx") playSound("cursor4");
    });
    row.append(value, input);
    if (key === "sensitivity") form.append(row);
    else {
      row.firstChild.textContent = key === "sfx" ? "SFX" : "BG volume";
      volumes.append(row);
    }
    controls[key] = { input, value };
  }
  form.append(volumes);
  for (const [key, label, hint] of [
    ["autoHideCursor", "Auto-hide cursor", "Hide your cursor when a battle starts."],
    ["streamer", "Streamer mode", "Hide usernames on screen. Names in messages may still appear."],
  ]) {
    const row = element("label", null, "site-setting");
    const input = element("input");
    input.type = "checkbox";
    input.setAttribute("aria-label", label);
    input.onchange = () => saveSettings({ [key]: input.checked });
    const title = element("span", label, "site-setting-title");
    const infoWrap = element("span", null, "site-setting-info-wrap");
    const info = element("button", "i", "site-setting-info");
    info.type = "button";
    info.setAttribute("aria-label", hint);
    const tip = element("span", hint, "site-setting-tooltip");
    infoWrap.append(info, tip);
    title.append(infoWrap);
    row.append(title, input);
    form.append(row);
    controls[key] = { input };
  }
  let resetting = false;
  const setGraphicsControl = (level) => {
    const index = Math.max(
      0,
      GRAPHICS_OPTIONS.findIndex((option) => option.value === level),
    );
    const option = GRAPHICS_OPTIONS[index];
    graphicsInput.value = index;
    graphicsValue.textContent = option.label;
  };
  const update = (settings) => {
    if (resetting) return;
    for (const [key, { input, value }] of Object.entries(controls)) {
      if (key === "graphics") {
        setGraphicsControl(settings.graphics);
      } else if (input.type === "checkbox") input.checked = settings[key];
      else {
        input.value = settings[key];
        value.textContent =
          key === "sensitivity"
            ? `${settings[key].toFixed(2)}×`
            : `${Math.round(settings[key] * 100)}%`;
      }
    }
  };
  const formatValue = (key, value) =>
    key === "sensitivity" ? `${value.toFixed(2)}×` : `${Math.round(value * 100)}%`;
  update(getSettings());
  const off = subscribeSettings(update);
  dialog.addEventListener("close", off, { once: true });
  const reset = element("button", "RESET", "pixel-menu-button");
  reset.id = "settings-reset";
  let resetTimer;
  reset.onclick = () => {
    if (resetting) return;
    const before = getSettings();
    const started = performance.now();
    const duration = 720;
    resetting = true;
    reset.disabled = true;
    dialog.classList.add("is-resetting");
    resetSettings();
    dialog.dispatchEvent(new CustomEvent(BROWSER_EVENTS.SETTINGS_RESET));
    const tick = (now) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      for (const [key, { input, value }] of Object.entries(controls)) {
        if (key === "graphics") {
          setGraphicsControl(progress > 0.52 ? getSettings().graphics : before.graphics);
          continue;
        }
        if (input.type === "checkbox") {
          if (progress > 0.52) input.checked = getSettings()[key];
          continue;
        }
        const current = before[key] + (getSettings()[key] - before[key]) * eased;
        input.value = current;
        value.textContent = formatValue(key, current);
      }
      if (progress < 1) {
        requestAnimationFrame(tick);
        return;
      }
      resetting = false;
      reset.disabled = false;
      update(getSettings());
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => dialog.classList.remove("is-resetting"), 260);
    };
    requestAnimationFrame(tick);
  };
  dialog.addEventListener("close", () => clearTimeout(resetTimer), { once: true });
  const footer = element("div", null, "site-settings-footer");
  const renderer = element("small", null, "site-settings-renderer");
  renderer.setAttribute("aria-label", "Current renderer");
  const updateRenderer = () => {
    const name = document.querySelector("canvas[data-game-renderer]")?.dataset.gameRenderer;
    renderer.textContent = name || "";
    renderer.hidden = !name;
  };
  updateRenderer();
  document.addEventListener(BROWSER_EVENTS.RENDERER_CHANGED, updateRenderer);
  dialog.addEventListener(
    "close",
    () => document.removeEventListener(BROWSER_EVENTS.RENDERER_CHANGED, updateRenderer),
    { once: true },
  );
  footer.append(reset, renderer);
  // Headings only matter once a Privacy section joins the list (signed-in, out of battle).
  const general = element("h3", "General", "site-settings-heading");
  general.hidden = true;
  body.append(general, form, remapKeys(dialog), footer);
  // Account-saved, so RESET leaves it alone. Battles (including map playtests) skip it.
  const inBattle = inGame || document.body.dataset.bbScreen === "game";
  if (!inBattle)
    body.append(
      privacySection(dialog, () => {
        general.hidden = false;
      }),
    );
}

export { openSettings };
