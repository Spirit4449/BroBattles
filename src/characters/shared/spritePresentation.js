const { characterFrames } = require('../../shared/characters');
const { getCharacterStats } = require('../../shared/characterStats');
const { getResolvedCharacterBodyConfig } = require('../../shared/characterTuning');

// Artwork resolution is independent of the authoritative character geometry.
// Legacy skins continue to use the original presentation unchanged.
function spritePresentation(character, texture) {
  const stats = getCharacterStats(character);
  const body = getResolvedCharacterBodyConfig(character);
  const legacyScale = stats.spriteScale || 1;
  if (character !== 'ninja' || texture?.key !== character ||
      !texture.has?.('attack00') || texture.get('idle00')?.width !== 256) {
    return { scale: legacyScale, body, originX: 0.5, originY: 0.5 };
  }
  const frame = characterFrames[character];
  const worldWidth = (frame.w - body.widthShrink) * legacyScale;
  const worldHeight = (frame.h - body.heightShrink) * legacyScale;
  // Match the legacy body's center relative to the network sprite position.
  const centerX = worldWidth * (1 - legacyScale) / 2 + body.offsetXFromHalf * legacyScale;
  const centerY = body.offsetY * legacyScale - frame.h * legacyScale / 2 + worldHeight / 2;
  const scale = 0.32;
  const sourceWidth = worldWidth / scale;
  const sourceHeight = worldHeight / scale;
  const ground = 240;
  return {
    scale,
    // Fixed clearance for the three-bar HUD above Ninja's original hood height.
    hudTopOffset: -35,
    originX: (128 - centerX / scale) / 256,
    originY: (ground - sourceHeight / 2 - centerY / scale) / 256,
    body: { ...body, widthShrink: 256 - sourceWidth,
      heightShrink: 256 - sourceHeight, offsetXFromHalf: 0,
      offsetY: ground - sourceHeight, flipOffset: (body.flipOffset || 0) * legacyScale / scale, sourceUnits: true },
  };
}
module.exports = { spritePresentation };
