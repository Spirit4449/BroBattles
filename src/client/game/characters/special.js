import { getCharacterClassByKey } from "./index";

export function performSpecial(character, context) {
  const Character = getCharacterClassByKey(character);
  if (!Character) {
    console.warn(`No special attack defined for ${character}`);
    return;
  }
  const { player } = context;
  // The per-fighter HUD uses this counter to play its super-launch animation.
  if (player) player._superBarLaunch = (player._superBarLaunch || 0) + 1;
  Character.performSpecial(context);
}
