import { getSettings, subscribeSettings } from "../site/preferences.js";
import { shouldMuteClientDefaultLogs } from "../lib/netTestLogger.js";

/**
 * Simple UI sound system
 * Usage:
 * 1. Auto: Buttons and links get a default cue; data-sound overrides it.
 * 2. Manual: import { playSound } from './lib/uiSounds.js'; playSound('click');
 */

const sounds = {};
const activeSounds = new Map();
const soundPools = new Map();
let uiSoundsInitialized = false;
const clickContexts = [];
let automaticClickCue = false;
const clickCues = new Set(["click", "cursor2", "cursor3", "cursor4", "cursor5", "cancel", "cancel2"]);
subscribeSettings(settings => {
  for (const [sound, base] of activeSounds) sound.volume = base * settings.sfx;
});
const soundPath = "/assets/ui-sound/";

// Default sound mappings (filename without extension)
const soundFiles = {
  click: "Cursor4.wav",
  ready: "ready",
  cancel: "cancel",
  cancel2: "cancel2.wav",
  success: "shop-confirm.ogg",
  error: "shop-error.ogg",
  cursor2: "Cursor2.wav",
  cursor3: "Cursor3.wav",
  cursor4: "Cursor4.wav",
  cursor5: "Cursor5.wav",
  party: "party",
  notification: "notification",
  beep: "/assets/game-sounds/beep.mp3",
  start: "/assets/game-sounds/start.mp3",
  playerJoin: "/assets/player-join.wav",
  upgrade: "/assets/upgrade.mp3",
  unlock: "/assets/unlock.mp3",
  shopOpen: "shop-open.ogg",
  shopClose: "shop-close.ogg",
  shopHover: "shop-hover.ogg",
  shopPress: "shop-press.ogg",
  shopBuy: "shop-buy.ogg",
  shopConfirm: "shop-confirm.ogg",
  shopBigSuccess: "shop-big-success.ogg",
  shopError: "shop-error.ogg",
  shopReveal: "shop-reveal.ogg",
  rewardCoins: "rewards/aura-soft.mp3",
  rewardGems: "rewards/aura-bless.mp3",
  rewardUnlock: "rewards/aura-radiant.mp3",
  rewardEpic: "rewards/aura-divine.mp3",
  rewardLegendary: "rewards/aura-celestial.mp3",
  rewardCoinImpact: "rewards/coin-impact.wav",
  rewardGemImpact: "rewards/gem-impact.wav",
  shopCurrencyImpact: "shop-currency-impact.wav",
};

function createAudioWithFallback(filename) {
  const hasExtension = /\.[a-z0-9]+$/i.test(filename);
  const sources = hasExtension
    ? [filename.startsWith("/") ? filename : `${soundPath}${filename}`]
    : [".mp3", ".wav", ".ogg"].map((ext) => `${soundPath}${filename}${ext}`);
  const audio = new Audio();
  audio.preload = "auto";

  let idx = 0;
  const tryNext = () => {
    if (idx >= sources.length) return;
    audio.src = sources[idx++];
    audio.load();
  };

  const handleError = () => {
    if (idx < sources.length) {
      tryNext();
    } else {
      audio.removeEventListener("error", handleError);
    }
  };

  const handleReady = () => {
    audio.removeEventListener("error", handleError);
    audio.removeEventListener("canplaythrough", handleReady);
  };

  audio.addEventListener("error", handleError);
  audio.addEventListener("canplaythrough", handleReady, { once: true });
  tryNext();
  return audio;
}

function getOrLoadSound(soundName) {
  if (sounds[soundName]) return sounds[soundName];
  const filename = soundFiles[soundName];
  if (!filename) return null;
  const audio = createAudioWithFallback(filename);
  sounds[soundName] = audio;
  return audio;
}

// Warm time-critical cues without playing them.
export function preloadSound(soundName) { getOrLoadSound(soundName); }

// Play a sound
export function playSound(soundName, volume = 0.5, options = {}) {
  const source = getOrLoadSound(soundName);
  if (!source) return;
  const clickContext = automaticClickCue ? null : [...clickContexts].reverse().find(context => context.event.eventPhase !== 0);
  if (clickContext) {
    // Profile/slot handlers can call the same cue twice as a click bubbles.
    if (clickCues.has(soundName) && clickContext.cues.has(soundName)) return;
    clickContext.cues.add(soundName);
    clickContext.played = true;
  }
  let sound = source;
  if (options.overlap) {
    const limit = Math.max(1, Math.min(16, Number(options.maxVoices) || 16));
    const pool = soundPools.get(soundName) || [];
    sound = pool.find(voice => !activeSounds.has(voice));
    if (!sound && pool.length < limit) {
      sound = source.cloneNode(true);
      const voice = sound;
      window.__BB_PAGE_SCOPE__?.onDispose(() => { voice.pause(); voice.removeAttribute('src'); voice.load(); });
      pool.push(sound);
    }
    if (!sound) {
      sound = pool.shift();
      pool.push(sound);
    }
    soundPools.set(soundName, pool);
  }
  sound.currentTime = 0;
  activeSounds.set(sound, volume);
  sound.volume = volume * getSettings().sfx;
  const release = () => activeSounds.delete(sound);
  sound.onended = release;
  sound.onerror = release;
  sound.playbackRate = Math.max(0.5, Math.min(2, Number(options.playbackRate) || 1));
  sound.play().catch((e) => {
    release();
    if (!shouldMuteClientDefaultLogs()) {
      console.warn(`Sound ${soundName} failed:`, e);
    }
  });
}

// Delegation covers dynamic controls (friends, chat, shop, and popups).
export function initUISounds() {
  if (uiSoundsInitialized) return;
  uiSoundsInitialized = true;
  let disposed = false;
  const controls = '[data-sound], button, a[href], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"], [role="button"], [role="tab"], [role="menuitem"], [role="option"], summary';
  const safeClosest = (node, selector) => (node?.closest ? node : node?.parentElement)?.closest(selector);
  const disabled = target => !!target.closest(':disabled, [aria-disabled="true"], [inert]');
  const readVolume = (target, fallback) => {
    const raw = target.getAttribute("data-volume");
    const value = raw == null || raw.trim() === "" ? NaN : Number(raw);
    return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  };

  const onClick = event => {
    const target = safeClosest(event.target, controls);
    // Snapshot before handlers disable, replace, or remove the control.
    const eligible = target && !disabled(target);
    const explicitSound = eligible ? target.getAttribute("data-sound") : null;
    const isClose = eligible && (
      /^[×✕✖xX]$/.test(target.textContent?.trim() || "") ||
      /^close\b/i.test(target.getAttribute("aria-label") || "") ||
      target.matches?.('.bb-close, .bb-chat-close, .close-popup')
    );
    const soundName = eligible
      ? (explicitSound === "none" || explicitSound === "" ? explicitSound : isClose ? "cancel" : explicitSound ?? "cursor4")
      : null;
    const volume = eligible ? readVolume(target, target.getAttribute("data-sound") == null ? 0.3 : 0.5) : 0;
    const context = { event, played: false, cues: new Set() };
    clickContexts.push(context);
    // Let existing synchronous handlers supply their custom cue first. Capture
    // plus a deferred task still works when a popup stops propagation.
    // A microtask can run between native event listeners, before the handler.
    setTimeout(() => {
      const index = clickContexts.indexOf(context);
      if (index !== -1) clickContexts.splice(index, 1);
      if (!disposed && !context.played && soundName && soundName !== "none") {
        automaticClickCue = true;
        try { playSound(soundName, volume); }
        finally { automaticClickCue = false; }
      }
    }, 0);
  };
  const onHover = event => {
    const target = safeClosest(event.target, "[data-sound-hover]");
    if (!target || disabled(target) || target.contains(event.relatedTarget)) return;
    const soundName = target.getAttribute("data-sound-hover");
    if (soundName && soundName !== "none") playSound(soundName, readVolume(target, 0.3));
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("pointerover", onHover, true);
  window.__BB_PAGE_SCOPE__?.onDispose(() => {
    disposed = true;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("pointerover", onHover, true);
    clickContexts.length = 0;
    uiSoundsInitialized = false;
  });
}
