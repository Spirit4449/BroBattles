import { createPixelSelect } from '../ui/pixelSelect.js';
import { attachNestedDropdown } from './nestedDropdown.js';
import { arenaFor } from '../../shared/maps/arenas';
import { modes } from '../../shared/catalogs/gameModes.catalog.json';

export function createMapModeSelect({ options, value, onChange, className }) {
  let selected = String(value);
  const groups = new Map();
  for (const option of options) {
    const modeId = arenaFor(option.modeVariantId)?.modeId;
    if (!modeId) continue;
    if (!groups.has(modeId)) groups.set(modeId, []);
    groups.get(modeId).push(option);
  }
  const groupOptions = [...groups.keys()].map(value => ({ value, label: modes.find(mode => mode.id === value)?.label || value }));
  const groupFor = mapId => [...groups.keys()].find(mode => groups.get(mode).some(map => map.value === String(mapId)));
  let nested;
  const control = createPixelSelect({
    options: groupOptions,
    value: groupFor(selected),
    label: 'Map',
    className: `${className} is-compact`,
    onSelect(mode) {
      nested.show(mode, { focus: true });
      return false;
    },
  });
  function setValue(mapId) {
    selected = String(mapId);
    control.setValue(groupFor(selected));
    const map = options.find(option => option.value === selected);
    if (map) {
      control.element.querySelector('.bb-pixel-select-value').textContent = map.label;
      control.element.querySelector('.bb-pixel-select-trigger').setAttribute('aria-label', `Map: ${map.label}`);
    }
  }
  nested = attachNestedDropdown(control, {
    getOptions: mode => groups.get(mode),
    getValue: mode => groupFor(selected) === mode ? selected : null,
    onSelect(mode, mapId) {
      setValue(mapId);
      onChange(mapId);
    },
  });
  setValue(selected);
  return { ...control, get value() { return selected; }, setValue };
}
