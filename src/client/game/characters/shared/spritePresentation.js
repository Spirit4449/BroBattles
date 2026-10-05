const { characterFrames, characterPresentation } = require('../../../../shared/characters');
const { getCharacterStats } = require('../../../../shared/characters/characterStats');
const { getResolvedCharacterBodyConfig } = require('../../../../shared/characters/characterTuning');

// A character definition's `presentation.hiResArt` describes base artwork drawn at a higher
// resolution than its authoritative geometry. Returns that config when the
// texture is such art (skins and older atlases keep the legacy presentation).
function hiResArtFor(character, texture) {
  const art = characterPresentation(character).hiResArt;
  if (!art || texture?.key !== character) return null;
  if (art.requiresFrame && !texture.has?.(art.requiresFrame)) return null;
  return texture.get?.('idle00')?.width === art.sourceSize ? art : null;
}

// Artwork resolution is independent of the authoritative character geometry.
// Legacy skins continue to use the original presentation unchanged.
function spritePresentation(character, texture) {
  const stats = getCharacterStats(character);
  const body = getResolvedCharacterBodyConfig(character);
  const legacyScale = stats.spriteScale || 1;
  const art = hiResArtFor(character, texture);
  if (!art) {
    return { scale: legacyScale, body, originX: 0.5, originY: 0.5 };
  }
  const frame = characterFrames[character];
  const worldWidth = (frame.w - body.widthShrink) * legacyScale;
  const worldHeight = (frame.h - body.heightShrink) * legacyScale;
  // Match the legacy body's center relative to the network sprite position.
  const centerX = worldWidth * (1 - legacyScale) / 2 + body.offsetXFromHalf * legacyScale;
  const centerY = body.offsetY * legacyScale - frame.h * legacyScale / 2 + worldHeight / 2;
  const { scale, sourceSize: size, groundY: ground } = art;
  const sourceWidth = worldWidth / scale;
  const sourceHeight = worldHeight / scale;
  return {
    scale,
    // Fixed clearance for the HUD above the character's original art height.
    hudTopOffset: art.hudTopOffset,
    originX: (size / 2 - centerX / scale) / size,
    originY: (ground - sourceHeight / 2 - centerY / scale) / size,
    body: { ...body, widthShrink: size - sourceWidth,
      heightShrink: size - sourceHeight, offsetXFromHalf: 0,
      offsetY: ground - sourceHeight, flipOffset: (body.flipOffset || 0) * legacyScale / scale, sourceUnits: true },
  };
}
module.exports = { hiResArtFor, spritePresentation };
