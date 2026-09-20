import { mapDefaults } from '../shared/maps';
import { buildCharacterSkinAtlasUrls, buildCharacterSkinWeaponUrl } from '../lib/skinAssets';
import { getMapBgAsset } from '../maps/manifest';

export function warmBattleSelection(selection, roster = []) {
  const urls = [];
  if (selection?.mapId) {
    const map = mapDefaults.find(entry => Number(entry.id) === Number(selection.mapId));
    const variant = map?.variants?.[String(selection.modeVariantId || '').replace(/^duels-/, '')] || Object.values(map?.variants || {})[0];
    urls.push(getMapBgAsset(selection.mapId));
    for (const asset of Object.values(variant?.assets || {})) urls.push(asset.url, asset.textureURL, asset.atlasURL);
  }
  for (const member of roster) {
    const character = member?.char_class || member?.character;
    if (!character || character === 'Random' || character === 'shuffle') continue;
    const atlas = buildCharacterSkinAtlasUrls(character, member.selected_skin_id);
    urls.push(atlas.animationsUrl, atlas.spritesheetUrl, buildCharacterSkinWeaponUrl(character, member.selected_skin_id));
  }
  window.__BB_NAVIGATION__?.preload(urls.filter(url => typeof url === 'string' && url.startsWith('/assets/')));
}
