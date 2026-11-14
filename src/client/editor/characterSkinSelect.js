import { createPixelSelect } from '../ui/pixelSelect.js';
import { attachNestedDropdown } from './nestedDropdown.js';
import catalog from '../../shared/catalogs/skinsCatalog.json';

// Keep the character list compact and show its skins beside the hovered row.
export function createCharacterSkinSelect({ options, value, skinId, onChange, className }) {
  let selectedSkin = skinId;
  const control = createPixelSelect({ options, value, label: 'Character', className,
    onChange(character) {
      selectedSkin = catalog.characters[character].defaultSkinId;
      onChange(character, selectedSkin);
    },
  });
  control.element.classList.add('studio-character-select');
  attachNestedDropdown(control, {
    getOptions: character => catalog.characters[character].skins.map(skin => ({ value: skin.id, label: skin.name })),
    getValue: character => control.value === character ? selectedSkin : catalog.characters[character].defaultSkinId,
    onSelect(character, skinId) {
      selectedSkin = skinId;
      control.setValue(character);
      onChange(character, skinId);
    },
  });
  return control;
}
