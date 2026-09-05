import { shouldMuteClientDefaultLogs } from "./netTestLogger.js";

/**
 * Simple UI sound system
 * Usage:
 * 1. Auto: Add data-sound="click" to any button/element
 * 2. Manual: import { playSound } from './lib/uiSounds.js'; playSound('click');
 */

const sounds = {};
const soundPath = "/assets/ui-sound/";
let preloaded = false;

// Default sound mappings (filename without extension)
const soundFiles = {
  click: "click",
  ready: "ready",
  cancel: "cancel",
  cancel2: "cancel2",
  success: "success",
  error: "error",
  cursor2: "Cursor2",
  cursor3: "Cursor3",
  cursor4: "Cursor4",
  cursor5: "Cursor5",
  party: "party",
  notification: "notification",
  beep: "/assets/beep.mp3",
  start: "/assets/start.mp3",
  upgrade: "/assets/upgrade.wav",
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

// Preload sounds
function preloadSounds() {
  if (preloaded) return;
  Object.entries(soundFiles).forEach(([key, filename]) => {
    sounds[key] = createAudioWithFallback(filename);
  });
  preloaded = true;
}

function getOrLoadSound(soundName) {
  preloadSounds();
  if (sounds[soundName]) return sounds[soundName];
  const filename = soundFiles[soundName];
  if (!filename) return null;
  const audio = createAudioWithFallback(filename);
  sounds[soundName] = audio;
  return audio;
}

// Play a sound
export function playSound(soundName, volume = 0.5, options = {}) {
  const source = getOrLoadSound(soundName);
  if (!source) return;
  const sound = options.overlap ? source.cloneNode(true) : source;
  sound.currentTime = 0;
  sound.volume = volume;
  sound.playbackRate = Math.max(0.5, Math.min(2, Number(options.playbackRate) || 1));
  sound.play().catch((e) => {
    if (!shouldMuteClientDefaultLogs()) {
      console.warn(`Sound ${soundName} failed:`, e);
    }
  });
}

// Initialize auto-sound on elements with data-sound attribute
export function initUISounds() {
  preloadSounds();

  const safeClosest = (node, selector) => {
    if (!node || typeof node.closest !== "function") return null;
    return node.closest(selector);
  };

  // Auto-attach to elements with data-sound
  document.addEventListener(
    "click",
    (e) => {
      const target = safeClosest(e.target, "[data-sound]");
      if (target) {
        const soundName = target.getAttribute("data-sound");
        const volume = parseFloat(target.getAttribute("data-volume")) || 0.5;
        playSound(soundName, volume);
      }
    },
    true,
  );

  // Optional: hover sounds
  document.addEventListener(
    "pointerover",
    (e) => {
      const target = safeClosest(e.target, "[data-sound-hover]");
      if (!target || target.matches(":disabled") || target.contains(e.relatedTarget)) return;
      const soundName = target.getAttribute("data-sound-hover");
      const volume = parseFloat(target.getAttribute("data-volume")) || 0.3;
      playSound(soundName, volume);
    },
    true,
  );
}
