import { loadGameFonts } from "../../game/scene/loadGameFonts";
import { getPageScope } from "../../lib/globals.cjs";
// Switchable views in the expanded character panel.
//   body        the static portrait (always available, shown first)
//   animations  every animation in turn, with the real super, on a platform
//   fight       the character trading basic attacks with a sparring partner
// The live views run in one small Phaser game (showcaseStage.js), loaded on
// demand once window.Phaser exists. The first live view fades in over the
// portrait once its first frame is drawn, never before AUTO_PLAY_DELAY_MS.
// Switching between live views swaps the stage without showing the portrait.
const PHASER_URL = "/bundles/phaser-arcade-physics.min.js";
const AUTO_PLAY_DELAY_MS = 2500;
const FADE_MS = 220;
const VIEWS = [
  { id: "body", label: "Body" },
  { id: "animations", label: "Animations" },
  { id: "fight", label: "Fight" },
];
let phaserPromise = null;
let retiringStage = Promise.resolve();
let session = null;

export function hasCharacterShowcase(character) {
  return !!character && !window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
}

// Adds the view switcher to a freshly rendered preview frame. `level` sets the
// fighters' health and damage; `name` labels the player's fighter.
export function mountCharacterShowcase(frame, { character, skinId, level = 1, name = "You" }) {
  // The panel re-renders in place (skin data arriving, upgrades): keep the
  // running view instead of dropping back to the portrait.
  if (session && session.character === character && frame && hasCharacterShowcase(character)) {
    adoptFrame(session, frame, { skinId, level, name });
    return;
  }
  endSession();
  if (!frame || !hasCharacterShowcase(character)) return;
  const current = {
    frame, character, skinId, level, name,
    host: null, stage: null, stagePromise: null,
    view: "body",
    userChose: false,
    request: 0,
    timer: null,
    buttons: new Map(),
  };
  session = current;
  current.unsubscribe = getPageScope()?.onDispose(() => endSession(current));
  decorateFrame(current, "body");

  const opened = performance.now();
  // Load the animations view behind the portrait, then fade in no sooner than
  // the delay; a slow load simply fades in when it is done.
  getStage(current)
    .then(stage => {
      if (stage && session === current && !current.userChose) return stage.prepare({ character, skinId: current.skinId, mode: "animations" });
    })
    .then(() => {
      if (session !== current || current.userChose) return;
      const remaining = AUTO_PLAY_DELAY_MS - (performance.now() - opened);
      current.timer = setTimeout(() => {
        if (session === current && !current.userChose) void setView(current, "animations");
      }, Math.max(0, remaining));
    })
    .catch(error => {
      if (session === current) console.warn("[showcase] unavailable", error);
      // Keep manual selection available after a transient load failure.
    });
}

function decorateFrame(current, shownView) {
  const { frame } = current;
  current.buttons.clear();
  frame.dataset.showcaseView = shownView;
  frame.appendChild(buildSwitcher(current));
  if (current.host) frame.prepend(current.host);
}

function adoptFrame(current, frame, { skinId, level, name }) {
  const changed = current.skinId !== skinId || current.level !== level || current.name !== name;
  const shownView = current.frame.dataset.showcaseView;
  current.frame = frame;
  current.level = level;
  current.name = name;
  decorateFrame(current, shownView);
  if (changed) {
    current.skinId = skinId;
    if (current.view !== "body") void setView(current, current.view, { force: true });
  }
}

// The selected skin changed while the panel is open.
export function updateCharacterShowcaseSkin(frame, character, skinId) {
  if (!session || session.frame !== frame || session.character !== character) return;
  if (session.skinId === skinId) return;
  // Browsing skins is an explicit choice to stay on the current view.
  session.userChose = true;
  clearTimeout(session.timer);
  session.skinId = skinId;
  if (session.view !== "body") void setView(session, session.view, { force: true });
}

// A purchase reveal must stay on the portrait, including during pending autoplay.
export function showCharacterShowcaseBody(frame) {
  if (!session || session.frame !== frame) return;
  session.userChose = true;
  clearTimeout(session.timer);
  void setView(session, "body");
}

export function hideCharacterShowcase() {
  endSession();
}

function endSession(current = session) {
  if (!current || current !== session) return retiringStage;
  clearTimeout(current.timer);
  current.request++;
  current.unsubscribe?.();
  session = null;
  if (current.stage) retiringStage = Promise.resolve(current.stage.destroy());
  current.host?.remove();
  return retiringStage;
}

function buildSwitcher(current) {
  const switcher = document.createElement("div");
  switcher.className = "character-showcase-switcher";
  switcher.setAttribute("role", "group");
  switcher.setAttribute("aria-label", "Preview");
  for (const { id, label } of VIEWS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "character-showcase-view";
    button.textContent = label;
    button.setAttribute("aria-pressed", String(id === current.view));
    button.addEventListener("click", event => {
      event.stopPropagation();
      if (current.frame.dataset.confirming === "true" && id !== "body") return;
      current.userChose = true;
      clearTimeout(current.timer);
      void setView(current, id);
    });
    current.buttons.set(id, button);
    switcher.appendChild(button);
  }
  return switcher;
}

async function setView(current, view, { force = false } = {}) {
  if (session !== current || (current.view === view && !force)) return;
  if (current.frame.dataset.confirming === "true" && view !== "body") return;
  const request = ++current.request;
  const wasLive = current.frame.dataset.showcaseView !== "body";
  current.view = view;
  for (const [id, button] of current.buttons) button.setAttribute("aria-pressed", String(id === view));

  if (view === "body") {
    current.frame.dataset.showcaseView = "body";
    current.frame.classList.remove("is-showcase-loading");
    await delay(FADE_MS);
    if (current.request !== request) return;
    if (current.request === request) {
      current.stage?.hide();
      current.host?.classList.remove("is-swapping");
    }
    return;
  }

  // View changes dip only the canvas. Skin refreshes restart in place.
  if (wasLive && current.host && !force) {
    current.host.classList.add("is-swapping");
    await delay(FADE_MS);
    if (current.request !== request) return;
  }
  current.frame.classList.add("is-showcase-loading");
  let stage;
  try {
    stage = await getStage(current);
    if (current.request !== request) return;
    if (current.host.parentNode !== current.frame) current.frame.prepend(current.host);
    const shown = await stage.show({
      character: current.character, skinId: current.skinId, level: current.level, name: current.name, mode: view,
      onCycleComplete: () => { if (current.request === request) void setView(current, "fight"); },
    });
    if (!shown || current.request !== request) return;
    current.frame.dataset.showcaseView = view;
  } catch (error) {
    console.warn("[showcase] view failed", error);
    if (current.request === request) {
      stage?.hide();
      current.view = "body";
      current.frame.dataset.showcaseView = "body";
      for (const [id, button] of current.buttons) button.setAttribute("aria-pressed", String(id === "body"));
    }
  } finally {
    if (current.request === request) {
      current.frame.classList.remove("is-showcase-loading");
      current.host?.classList.remove("is-swapping");
    }
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function loadPhaser() {
  if (window.Phaser) return Promise.resolve(window.Phaser);
  phaserPromise ||= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = PHASER_URL;
    script.onload = () => (window.Phaser ? resolve(window.Phaser) : reject(new Error("Phaser missing")));
    script.onerror = () => { phaserPromise = null; reject(new Error("Phaser failed to load")); };
    document.head.append(script);
  });
  return phaserPromise;
}

function getStage(current) {
  current.stagePromise ||= (async () => {
    await Promise.all([loadPhaser(), retiringStage, document.fonts && loadGameFonts(document.fonts)]);
    if (session !== current) return null;
    // Character code reads the Phaser global, so import it only afterwards.
    const { createShowcaseStage } = await import(/* webpackChunkName: "character-showcase" */ "./showcaseStage.js");
    if (session !== current) return null;
    const host = document.createElement("div");
    host.className = "character-showcase";
    host.setAttribute("aria-hidden", "true");
    current.frame.prepend(host);
    current.host = host;
    current.stage = createShowcaseStage(host);
    return current.stage;
  })().catch(error => {
    current.host?.remove();
    current.host = null;
    current.stagePromise = null;
    throw error;
  });
  return current.stagePromise;
}
