import { getSettings, subscribeSettings } from "../site/preferences.js";
import { shouldMuteClientDefaultLogs } from "./netTestLogger.js";

/**
 * Simple UI sound system
 * Usage:
 * 1. Auto: Add data-sound="click" to any button/element
 * 2. Manual: import { playSound } from './lib/uiSounds.js'; playSound('click');
 */

const sounds = {};
const activeSounds = new Map();
const soundPools = new Map();
subscribeSettings(settings => {
  for (const [sound, base] of activeSounds) sound.volume = base * settings.sfx;
});
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
  let sound = source;
  if (options.overlap) {
    const limit = Math.max(1, Math.min(16, Number(options.maxVoices) || 16));
    const pool = soundPools.get(soundName) || [];
    sound = pool.find(voice => !activeSounds.has(voice));
    if (!sound && pool.length < limit) {
      sound = source.cloneNode(true);
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
