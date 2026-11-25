// CommonJS keeps these mechanics directly loadable by the Node test suite.
const { characterFrames, characterPresentation } = require('../../../../shared/characters');
const { rigOf } = require('../../../../shared/characters/characterRig');
const { getCharacterStats } = require('../../../../shared/characters/characterStats');
const { getResolvedCharacterBodyConfig } = require('../../../../shared/characters/characterTuning');

// A character definition's `presentation.hiResArt` describes base artwork drawn at a higher
// resolution than its authoritative geometry. Returns that config when the
// texture is such art (skins and older atlases keep the legacy presentation).
function hiResArtFor(character, texture) {
  const art = characterPresentation(character).hiResArt;
  if (!art || texture?.key !== character) return null;
  if (art.requiresFrame && !texture.has?.(art.requiresFrame)) return null;
  const idle = texture.get?.('idle00');
  return (idle?.realWidth ?? idle?.width) === art.sourceSize ? art : null;
}

// Artwork resolution is independent of the authoritative character geometry.
// Legacy skins continue to use the original presentation unchanged.
function spritePresentation(character, texture) {
  const presentation = standOnRigFeet(character, texture, basePresentation(character, texture));
  const head = idleHeadY(texture, presentation.originX);
  if (head != null) {
    const height = texture.get('idle00').realHeight;
    presentation.hudTopOffset = (head - height * presentation.originY) * presentation.scale;
  }
  return presentation;
}

// Measure the idle silhouette once per atlas, including skins. A narrow strip
// above the standing point stays inside the head, excluding nearby staff plumes. Using the same idle
// row throughout a cast keeps the HUD steady as the animation changes frames.
const idleHeads = new WeakMap();
function idleHeadY(texture, originX) {
  if (!texture?.has?.('idle00') || !texture.getSourceImage || typeof document === 'undefined') return null;
  if (idleHeads.has(texture)) return idleHeads.get(texture);
  const frame = texture.get('idle00');
  let head = null;
  if (!frame.rotated) {
    const center = frame.realWidth * originX - frame.x;
    const radius = Math.max(1, frame.realWidth * 0.02);
    const left = Math.max(0, Math.floor(center - radius));
    const right = Math.min(frame.cutWidth, Math.ceil(center + radius));
    if (right > left && frame.cutHeight > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = right - left;
      canvas.height = frame.cutHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.drawImage(texture.getSourceImage('idle00'), frame.cutX + left, frame.cutY, canvas.width, canvas.height,
          0, 0, canvas.width, canvas.height);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        for (let alpha = 3; alpha < pixels.length; alpha += 4) {
          if (pixels[alpha] >= 128) {
            head = frame.y + Math.floor((alpha - 3) / (4 * canvas.width));
            break;
          }
        }
      }
    }
  }
  idleHeads.set(texture, head);
  return head;
}

// Origin and client body before the rig's feet are applied.
function basePresentation(character, texture) {
  const stats = getCharacterStats(character);
  const body = getResolvedCharacterBodyConfig(character);
  const legacyScale = stats.spriteScale || 1;
  const art = hiResArtFor(character, texture);
  if (!art) return { scale: legacyScale, body, originX: 0.5, originY: 0.5, frameW: characterFrames[character]?.w };
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
    frameW: size,
    // Fixed clearance for the HUD above the character's original art height.
    hudTopOffset: art.hudTopOffset,
    originX: (size / 2 - centerX / scale) / size,
    originY: (ground - sourceHeight / 2 - centerY / scale) / size,
    body: { ...body, widthShrink: size - sourceWidth,
      heightShrink: size - sourceHeight, offsetXFromHalf: 0,
      offsetY: ground - sourceHeight, flipOffset: (body.flipOffset || 0) * legacyScale / scale, sourceUnits: true },
  };
}

// A rig's `feet` (characters/<name>.json) put the horizontal origin under the
// character, so its art stands on the sprite position and does not shift when
// it turns. Phaser mirrors a flipped texture inside its frame, so facing left
// the origin is the mirrored point (`flipOriginX`; bindPlayerOrigin swaps it).
// The client body offset moves by the same amount the other way, so the body
// stays exactly where the server puts it. Only applies to the art the rig was
// measured on (the base atlas at the rig's frame size), never to skins.
function standOnRigFeet(character, texture, presentation) {
  const rig = rigOf(character);
  const frameW = presentation.frameW;
  if (!rig.feet || texture?.key !== character || !frameW || rig.frame?.w !== frameW) return presentation;
  const originX = rig.feet[0] / frameW;
  const flipOriginX = 1 - originX;
  const body = presentation.body;
  // Body offsets are in frame pixels: shift by the origin change on each facing.
  const shift = (originX - presentation.originX) * frameW;
  const flipShift = (flipOriginX - presentation.originX) * frameW;
  return { ...presentation, originX, flipOriginX,
    body: { ...body, offsetXFromHalf: (body.offsetXFromHalf || 0) + shift, flipOffset: (body.flipOffset || 0) + flipShift - shift } };
}
// Use the same minimum collision box before spawning local and remote fighters.
function sizePlayerBody(sprite, frame, { widthShrink, heightShrink }) {
  sprite.body.setSize(
    Math.max(4, frame.realWidth - widthShrink),
    Math.max(4, frame.realHeight - heightShrink),
  );
  sprite.body.updateFromGameObject?.();
}

module.exports = { hiResArtFor, spritePresentation, sizePlayerBody };
