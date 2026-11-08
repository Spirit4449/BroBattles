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
let stagePromise = null;
let host = null;
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
    view: "body",
    userChose: false,
    request: 0,
    timer: null,
    buttons: new Map(),
    caption: null,
  };
  session = current;
  decorateFrame(current, "body");

  const opened = performance.now();
  // Load the animations view behind the portrait, then fade in no sooner than
  // the delay; a slow load simply fades in when it is done.
  getStage()
    .then(stage => stage.prepare({ character, skinId, mode: "animations" }))
    .then(() => {
      if (session !== current || current.userChose) return;
      const remaining = AUTO_PLAY_DELAY_MS - (performance.now() - opened);
      current.timer = setTimeout(() => {
        if (session === current && !current.userChose) void setView(current, "animations");
      }, Math.max(0, remaining));
    })
    .catch(error => {
      console.warn("[showcase] unavailable", error);
      if (session === current) current.frame.querySelector(".character-showcase-switcher")?.remove();
    });
}

function decorateFrame(current, shownView) {
  const { frame } = current;
  current.buttons.clear();
  frame.dataset.showcaseView = shownView;
  frame.appendChild(buildSwitcher(current));
  current.caption = document.createElement("div");
  current.caption.className = "character-showcase-caption";
  current.caption.setAttribute("aria-live", "polite");
  frame.appendChild(current.caption);
  if (host) frame.prepend(host);
}

function adoptFrame(current, frame, { skinId, level, name }) {
  const changed = current.skinId !== skinId || current.level !== level || current.name !== name;
  current.frame = frame;
  current.level = level;
  current.name = name;
  const caption = current.caption?.textContent || "";
  decorateFrame(current, current.view === "body" || !host ? "body" : current.view);
  current.caption.textContent = caption;
  if (changed) {
    current.skinId = skinId;
    if (current.view !== "body") void setView(current, current.view, { force: true });
  }
}

// The selected skin changed while the panel is open.
export function updateCharacterShowcaseSkin(frame, character, skinId) {
  if (!session || session.frame !== frame || session.character !== character) return;
  if (session.skinId === skinId) return;
  session.skinId = skinId;
  if (session.view !== "body") void setView(session, session.view, { force: true });
}

export function hideCharacterShowcase() {
  endSession();
}

function endSession() {
  if (!session) return;
  clearTimeout(session.timer);
  session.request++;
  session = null;
  stagePromise?.then(stage => stage.hide()).catch(() => {});
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
      current.userChose = true;
      clearTimeout(current.timer);
      void setView(current, id);
    });
    current.buttons.set(id, button);
    switcher.appendChild(button);
  }
  return switcher;
}

function setCaption(current, text) {
  if (current.caption) current.caption.textContent = text || "";
}

async function setView(current, view, { force = false } = {}) {
  if (session !== current || (current.view === view && !force)) return;
  const request = ++current.request;
  const wasLive = current.frame.dataset.showcaseView !== "body";
  current.view = view;
  for (const [id, button] of current.buttons) button.setAttribute("aria-pressed", String(id === view));

  if (view === "body") {
    setCaption(current, "");
    current.frame.dataset.showcaseView = "body";
    current.frame.classList.remove("is-showcase-loading");
    await delay(FADE_MS);
    if (current.request === request) (await getStage()).hide();
    return;
  }

  // Live to live: dip only the canvas (the backdrop stays), never the portrait.
  if (wasLive && host) {
    host.classList.add("is-swapping");
    setCaption(current, "");
    await delay(FADE_MS);
    if (current.request !== request) return;
  }
  current.frame.classList.add("is-showcase-loading");
  try {
    const stage = await getStage();
    if (current.request !== request) return;
    if (host.parentNode !== current.frame) current.frame.prepend(host);
    const shown = await stage.show({
      character: current.character, skinId: current.skinId, level: current.level, name: current.name, mode: view,
      onCaption: text => { if (current.request === request) setCaption(current, text); },
    });
    if (!shown || current.request !== request) return;
    current.frame.dataset.showcaseView = view;
  } catch (error) {
    console.warn("[showcase] view failed", error);
    if (current.request === request) {
      current.view = "body";
      current.frame.dataset.showcaseView = "body";
      for (const [id, button] of current.buttons) button.setAttribute("aria-pressed", String(id === "body"));
    }
  } finally {
    if (current.request === request) {
      current.frame.classList.remove("is-showcase-loading");
      host?.classList.remove("is-swapping");
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

function getStage() {
  stagePromise ||= (async () => {
    await loadPhaser();
    // Character code reads the Phaser global, so import it only afterwards.
    const { createShowcaseStage } = await import(/* webpackChunkName: "character-showcase" */ "./showcaseStage.js");
    host = document.createElement("div");
    host.className = "character-showcase";
    host.setAttribute("aria-hidden", "true");
    if (session) session.frame.prepend(host);
    const stage = createShowcaseStage(host);
    // Leaving the lobby frees the WebGL context for the match.
    window.__BB_PAGE_SCOPE__?.onDispose(() => {
      stage.destroy();
      host?.remove();
      host = null;
      stagePromise = null;
    });
    return stage;
  })().catch(error => {
    stagePromise = null;
    throw error;
  });
  return stagePromise;
}
