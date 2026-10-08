import { mapDefaults } from '../../shared/maps';
import { buildCharacterSkinAtlasUrls, buildCharacterSkinWeaponUrl } from '../views/skinAssets';
import { sceneryUrls } from '../../shared/maps/scenery';
import { warmEquippedPlayerCard, warmRosterPlayerCards } from '../views/playerCardAnimation.cjs';

let lastSelection;
let lastRoster = [];

export function warmBattleSelection(selection = lastSelection, roster = null) {
  const self = window.__BRO_BATTLES_USERDATA__;
  if (self) warmEquippedPlayerCard(self.selected_card_id || self.selectedCardId);
  if (!selection) return;
  lastSelection = selection;
  if (roster) lastRoster = roster;
  const members = roster || (lastRoster.length ? lastRoster.map(member =>
    self && member.name === self.name ? { ...member, ...self,
      selected_skin_id: self.selected_skin_id_by_char?.[self.char_class], selected_skin_game_assets: null,
    } : member,
  ) : self ? [self] : []);
  warmRosterPlayerCards(members.map(member => member?.selected_card_id || member?.selectedCardId || null));
  window.__BB_NAVIGATION__?.selectPreloadMode?.(selection.modeId);
  // Plays the moment the battle loading screen lifts.
  const urls = ['/assets/game-sounds/pregame.mp3'];
  if (selection?.mapId) {
    const map = mapDefaults.find(entry => Number(entry.id) === Number(selection.mapId));
    urls.push(...sceneryUrls(map?.scenery));
    for (const asset of Object.values(map?.assets || {})) urls.push(asset.url, asset.textureURL, asset.atlasURL);
  }
  for (const member of members) {
    const character = String(member?.char_class || member?.character || '').toLowerCase();
    if (!character || character === 'random' || character === 'shuffle') continue;
    // Phaser preloads the base character even when a selected skin is present.
    const skinId = member.selected_skin_id ?? member.selected_skin_id_by_char?.[character];
    const base = buildCharacterSkinAtlasUrls(character);
    const atlas = buildCharacterSkinAtlasUrls(character, skinId);
    const custom = member.selected_skin_game_assets;
    urls.push(base.animationsUrl, base.spritesheetUrl, buildCharacterSkinWeaponUrl(character),
      custom?.animationsUrl || atlas.animationsUrl, custom?.spritesheetUrl || atlas.spritesheetUrl,
      custom?.weaponUrl || buildCharacterSkinWeaponUrl(character, skinId));
  }
  window.__BB_NAVIGATION__?.preload(urls.filter(url => typeof url === 'string' && url.startsWith('/assets/')));
}
