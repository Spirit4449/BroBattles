import { keyLabel } from './keyBindings.mjs';
const ARROW_KEYS = { 37: 'left', 38: 'up', 39: 'right', 40: 'down' };
// Arrow keys show the shared pixel arrow; everything else is plain text.
export function renderKeyLabel(node, code) {
  const direction = ARROW_KEYS[code];
  if (!direction) { node.textContent = keyLabel(code); return; }
  const doc = node.ownerDocument || document;
  const arrow = doc.createElement('span');
  arrow.className = `bb-arrow bb-arrow-${direction} bb-arrow-sm`;
  arrow.setAttribute('aria-hidden', 'true');
  const name = doc.createElement('span');
  name.className = 'bb-visually-hidden';
  name.textContent = `${direction} arrow`;
  node.replaceChildren(arrow, name);
}
export function bindingEventCode(code) {
  if(code>=65&&code<=90)return `Key${String.fromCharCode(code)}`;
  if(code>=48&&code<=57)return `Digit${String.fromCharCode(code)}`;
  return {32:'Space',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown'}[code] || '';
}
export function updateControlsGuide(root, settings) {
  for(const key of root.querySelectorAll('kbd[data-binding]')) {
    const code=settings.keys[key.dataset.binding];
    renderKeyLabel(key, code);
    key.dataset.code=bindingEventCode(code);
    key.classList.remove('is-pressed');
  }
}
