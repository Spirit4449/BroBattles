export const KEY_SLOTS = Object.freeze([
  ['left','Move left',65],['right','Move right',68],['up','Jump / climb',87],['down','Duck / drop',83],
  ['leftAlt','Move left (alternate)',37],['rightAlt','Move right (alternate)',39],['upAlt','Jump (alternate)',38],['downAlt','Duck (alternate)',40],
  ['jump','Jump (additional)',32],['attack','Attack',74],['special','Special',73],['interact','Mode interaction',69],
]);
export const DEFAULT_BINDINGS = Object.freeze(Object.fromEntries(KEY_SLOTS.map(([id,,code])=>[id,code])));
export const validKey = code => Number.isInteger(code) && ((code>=65&&code<=90)||(code>=48&&code<=57)||(code>=37&&code<=40)||code===32);
export function normalizeBindings(raw) {
  const result={...DEFAULT_BINDINGS};
  if(!raw || typeof raw!=='object')return result;
  raw={...raw};for(const [id] of KEY_SLOTS)if(id.endsWith('Alt')||id==='jump')raw[id]=DEFAULT_BINDINGS[id];
  const values=KEY_SLOTS.map(([id])=>raw[id]);
  if(values.every(validKey) && new Set(values).size===values.length) for(const [id] of KEY_SLOTS)result[id]=raw[id];
  return result;
}
export function assignBinding(bindings,slot,code) {
  if(!(slot in DEFAULT_BINDINGS)||slot.endsWith('Alt')||slot==='jump'||!validKey(code))throw new Error('Use a letter, number, arrow, or Space.');
  const next=normalizeBindings(bindings);
  const duplicate=KEY_SLOTS.find(([id])=>id!==slot&&next[id]===code);
  if(duplicate)throw new Error(`Already used for ${duplicate[1].toLowerCase()}.`);
  next[slot]=code;return next;
}
export const keyLabel = code => ({32:'Space',37:'←',38:'↑',39:'→',40:'↓'}[code] || String.fromCharCode(code));
export function eventKeyCode(event) {
  if(/^Key[A-Z]$/.test(event.code))return event.code.charCodeAt(3);
  if(/^Digit[0-9]$/.test(event.code))return event.code.charCodeAt(5);
  return {Space:32,ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40}[event.code];
}
