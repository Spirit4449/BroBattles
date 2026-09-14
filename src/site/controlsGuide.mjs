import { keyLabel } from './keyBindings.mjs';
export function bindingEventCode(code) {
  if(code>=65&&code<=90)return `Key${String.fromCharCode(code)}`;
  if(code>=48&&code<=57)return `Digit${String.fromCharCode(code)}`;
  return {32:'Space',37:'ArrowLeft',38:'ArrowUp',39:'ArrowRight',40:'ArrowDown'}[code] || '';
}
export function updateControlsGuide(root, settings) {
  for(const key of root.querySelectorAll('kbd[data-binding]')) {
    const code=settings.keys[key.dataset.binding];
    key.textContent=keyLabel(code);
    key.dataset.code=bindingEventCode(code);
    key.classList.remove('is-pressed');
  }
}
