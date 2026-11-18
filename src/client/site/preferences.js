import { readJson, writeJson } from "../lib/safeStorage.js";
import { DEFAULT_BINDINGS, normalizeBindings } from './keyBindings.mjs';
import { SETTINGS_STORAGE_KEY } from '../../shared/storageKeys.js';
const SETTINGS_CHANGED = 'bb:settings-changed';
export const GRAPHICS_OPTIONS = Object.freeze([
  { value: 'low', label: 'Low', renderScale: 0.5, pixelMultiplier: 0.25 },
  { value: 'medium', label: 'Medium', renderScale: 1, pixelMultiplier: 1 },
  { value: 'high', label: 'High', renderScale: Math.SQRT2, pixelMultiplier: 2 },
  { value: 'super-high', label: 'Super High', renderScale: 2, pixelMultiplier: 4 },
]);
export const DEFAULT_SETTINGS = Object.freeze({ sensitivity:1, sfx:1, music:1, graphics:'high', autoHideCursor:true, streamer:false, keys:DEFAULT_BINDINGS });
export function graphicsRenderScale(level) {
  return GRAPHICS_OPTIONS.find(option => option.value === level)?.renderScale
    ?? GRAPHICS_OPTIONS.find(option => option.value === DEFAULT_SETTINGS.graphics).renderScale;
}
const subscribers = new Set();
export function normalizeSettings(raw={}) {
  if (!raw || typeof raw !== 'object') raw={};
  const number=(key,min,max)=>typeof raw[key]==='number' && Number.isFinite(raw[key]) ? Math.min(max,Math.max(min,raw[key])) : DEFAULT_SETTINGS[key];
  return { keys:normalizeBindings(raw.keys), sensitivity:number('sensitivity',0.25,3), sfx:number('sfx',0,1), music:number('music',0,1), graphics:GRAPHICS_OPTIONS.some(option => option.value === raw.graphics) ? raw.graphics : DEFAULT_SETTINGS.graphics, autoHideCursor:typeof raw.autoHideCursor==='boolean'?raw.autoHideCursor:DEFAULT_SETTINGS.autoHideCursor, streamer:typeof raw.streamer==='boolean'?raw.streamer:DEFAULT_SETTINGS.streamer };
}
function read() { return normalizeSettings(readJson(() => localStorage, SETTINGS_STORAGE_KEY)); }
let settings=read();
export function getSettings() { return {...settings,keys:{...settings.keys}}; }
export function subscribeSettings(fn) { subscribers.add(fn); return ()=>subscribers.delete(fn); }
function announce() { subscribers.forEach(fn=>fn(getSettings())); }
export function saveSettings(update) { settings=normalizeSettings({...settings,...update}); writeJson(() => localStorage, SETTINGS_STORAGE_KEY, settings); announce();
  // Navigation and each page bundle have separate module instances.
  if (typeof CustomEvent !== 'undefined' && typeof window !== 'undefined') window.dispatchEvent?.(new CustomEvent(SETTINGS_CHANGED, { detail: settings }));
}
if (typeof window !== 'undefined') window.addEventListener(SETTINGS_CHANGED, event => {
  if (event.detail === settings) return;
  settings = normalizeSettings(event.detail); announce();
});
export function resetSettings() { saveSettings(DEFAULT_SETTINGS); }
if (typeof window!=='undefined') window.addEventListener('storage',event=>{ if(event.key===SETTINGS_STORAGE_KEY || event.key===null){settings=read();announce();} });
export function bindAudio(audio, channel, baseVolume) {
  const update=()=>{ audio.volume=Math.min(1,Math.max(0,baseVolume*settings[channel])); };
  update(); const unsubscribe=subscribeSettings(update);
  return unsubscribe;
}
export function bindGameAudio(scene) {
  const apply=()=>scene.sound.setVolume(settings.sfx);
  apply(); const off=subscribeSettings(apply); scene.events.once('shutdown',off);
}
// Canvas name labels contain no real username while streamer mode is enabled.
export function bindCanvasName(text, original) {
  const apply=()=>text?.active && text.setText(settings.streamer ? '' : original);
  apply(); const off=subscribeSettings(apply); text.once('destroy',off);
}
