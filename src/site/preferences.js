const KEY = 'bb_settings_v1';
export const DEFAULT_SETTINGS = Object.freeze({ sensitivity:1, sfx:1, music:1, autoHideCursor:true, streamer:false });
const subscribers = new Set();
export function normalizeSettings(raw={}) {
  if (!raw || typeof raw !== 'object') raw={};
  const number=(key,min,max)=>typeof raw[key]==='number' && Number.isFinite(raw[key]) ? Math.min(max,Math.max(min,raw[key])) : DEFAULT_SETTINGS[key];
  return { sensitivity:number('sensitivity',0.25,3), sfx:number('sfx',0,1), music:number('music',0,1), autoHideCursor:typeof raw.autoHideCursor==='boolean'?raw.autoHideCursor:true, streamer:typeof raw.streamer==='boolean'?raw.streamer:false };
}
function read() { try { return normalizeSettings(JSON.parse(localStorage.getItem(KEY))); } catch (_) { return {...DEFAULT_SETTINGS}; } }
let settings=read();
export function getSettings() { return {...settings}; }
export function subscribeSettings(fn) { subscribers.add(fn); return ()=>subscribers.delete(fn); }
function announce() { subscribers.forEach(fn=>fn(getSettings())); }
export function saveSettings(update) { settings=normalizeSettings({...settings,...update}); try { localStorage.setItem(KEY,JSON.stringify(settings)); } catch (_) {} announce(); }
export function resetSettings() { saveSettings(DEFAULT_SETTINGS); }
if (typeof window!=='undefined') window.addEventListener('storage',event=>{ if(event.key===KEY || event.key===null){settings=read();announce();} });
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
