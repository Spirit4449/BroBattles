import { BROWSER_EVENTS } from "../../lib/browserEvents.js";
import { getNavigation, getPageScope } from "../../lib/globals.cjs";

const BATTLE_LOADER = Symbol.for("bro-battles.battle-loader");

function createBattleLoading(scope) {
  const navigation = getNavigation();
  const loadingPresentationReady = navigation?.beginBattleLoading();
  let progress = 0;
  let revealing = false;

  async function revealGameWhenReady() {
    const background = document.getElementById("game-bg");
    if (revealing || progress < 100 || background?.dataset.ready !== "true") return;
    revealing = true;
    await loadingPresentationReady;
    if (scope && !scope.active) return;
    document.getElementById("loading-wrap")?.classList.add("hidden");
    document.getElementById("matchmaking-screen")?.classList.add("hidden");
    background.classList.add("visible");
    document.dispatchEvent(new Event(BROWSER_EVENTS.BATTLE_REVEALED));
  }

  function setProgress(value, text) {
    const next = Math.round(Math.max(0, Math.min(100, Number(value) || 0)));
    progress = Math.max(progress, next);
    navigation?.progress(progress, text);
    const bar = document.getElementById("loading-bar-fill");
    const label = document.getElementById("loading-percent");
    const status = document.getElementById("loading-text");
    if (bar) bar.style.width = `${progress}%`;
    if (label) label.textContent = `${progress}%`;
    if (status && typeof text === "string") status.textContent = text;
    if (progress >= 100) void revealGameWhenReady();
  }

  function markBackgroundReady() {
    const background = document.getElementById("game-bg");
    if (!background) return;
    background.dataset.ready = "true";
    void revealGameWhenReady();
  }

  return { setProgress, markBackgroundReady };
}

function battleLoading() {
  const scope = getPageScope();
  // Phaser and the game entry load after the boot bundle. They share one
  // loader per page lifetime, including when the router keeps the Document.
  const owner = scope || document;
  return owner[BATTLE_LOADER] ||= createBattleLoading(scope);
}

export function setBattleLoading(progress, text) {
  battleLoading().setProgress(progress, text);
}

export function markBattleBackgroundReady() {
  battleLoading().markBackgroundReady();
}
