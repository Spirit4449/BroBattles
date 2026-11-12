// Client side of character rigs (src/shared/characters/characterRig.js): where
// things are on a player sprite, in world space, for any facing and scale.
// Drawing code asks for a named point or anchor here instead of tuning its own
// offsets, and only bindPlayerOrigin decides a player sprite's origin.
import rigData from "../../../../shared/characters/characterRig.js";

const { rigOf, rigPointArt, artToWorld } = rigData;

const characterOf = (sprite, character) => String(character || sprite?._bbCharacter || "").toLowerCase();

// The sprite's current transform as artToWorld expects it. Frame size falls
// back to the character's base frame for stand-ins without a texture frame.
export function spriteView(sprite, character) {
  const frame = rigOf(characterOf(sprite, character)).frame;
  const frameW = sprite.frame?.realWidth || frame?.w || sprite.width || 0;
  const frameH = sprite.frame?.realHeight || frame?.h || sprite.height || 0;
  const scaleX = Number.isFinite(sprite.scaleX) ? sprite.scaleX : (sprite.displayWidth || frameW) / (frameW || 1);
  const scaleY = Number.isFinite(sprite.scaleY) ? sprite.scaleY : (sprite.displayHeight || frameH) / (frameH || 1);
  return { x: sprite.x, y: sprite.y, flip: !!sprite.flipX, scaleX, scaleY, frameW, frameH,
    originX: sprite.originX, originY: sprite.originY };
}

// World position of a point given in the sprite's frame pixels (facing right).
export function spriteArtPoint(sprite, point, character) {
  return artToWorld(spriteView(sprite, character), point);
}

// World position of a named rig point on the sprite's current frame, or null
// when the character's rig does not define it.
export function rigPoint(sprite, name, character) {
  const key = characterOf(sprite, character);
  // Points are measured on the base art; other art (a skin drawn at another
  // size) gets none rather than a point in the wrong place.
  const width = sprite?.frame?.realWidth;
  const rigWidth = rigOf(key).frame?.w;
  if (width && rigWidth && width !== rigWidth) return null;
  const art = rigPointArt(key, name, sprite?.frame?.name);
  return art ? spriteArtPoint(sprite, art, key) : null;
}

// The rig's team-ring drop (ring half-heights below the feet), or null.
export function rigRingDrop(sprite, character) {
  return rigOf(characterOf(sprite, character)).ringDrop;
}

// The Arcade body's bounds from the sprite's current transform (as
// Body.preUpdate places it), so anchors never trail the sprite by a frame.
export function bodyBounds(sprite) {
  const body = sprite?.body;
  if (!body?.offset) return null;
  const left = sprite.x + sprite.scaleX * (body.offset.x - sprite.displayOriginX);
  const top = sprite.y + sprite.scaleY * (body.offset.y - sprite.displayOriginY);
  if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
  return { left, top, width: body.width, height: body.height, right: left + body.width, bottom: top + body.height };
}

// Named places on a player for anything drawn on or around them:
//   feet    standing point: ring, floor effects, landing dust
//   top     top of the hitbox at the stand x: name tag and health bars
//   centre  middle of the hitbox: hit flashes
//   core    middle of the drawn body (the rig's `core` point, else `centre`):
//           auras and bubbles, for art that does not fill its hitbox
// Anything else is looked up as a rig point. Horizontal anchors use the sprite
// position (where the rig's feet stand) rather than the body centre, because
// some bodies shift a few pixels when the character turns.
export function playerAnchor(sprite, name) {
  if (!sprite) return null;
  const bounds = bodyBounds(sprite);
  if (name === "feet") return { x: sprite.x, y: bounds ? bounds.bottom : sprite.y };
  if (name === "top") return { x: sprite.x, y: bounds ? bounds.top : sprite.y - (sprite.displayHeight || 0) / 2 };
  if (name === "centre") {
    return bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: sprite.x, y: sprite.y };
  }
  if (name === "core") return rigPoint(sprite, "core") || playerAnchor(sprite, "centre");
  return rigPoint(sprite, name);
}

// Player sprites this client has bound, for the rig debug overlay.
export const boundPlayerSprites = new Set();

// Owns a player sprite's origin. The origin is fixed per facing (swapped for
// rigs whose feet are off-centre, since Phaser mirrors a flipped frame in
// place), the client body moves with it, and any other setOrigin call keeps
// the facing's horizontal origin: no effect can knock the art off its hitbox.
// Flips arrive from many places (movement, dashes, attack locks, snapshots),
// so the sprite's own flipX does the swap.
export function bindPlayerOrigin(sprite, presentation) {
  if (!sprite || !presentation) return;
  const originX = Number.isFinite(presentation.originX) ? presentation.originX : 0.5;
  const flipOriginX = Number.isFinite(presentation.flipOriginX) ? presentation.flipOriginX : originX;
  const proto = Object.getPrototypeOf(sprite);
  const baseSetOrigin = proto.setOrigin;
  let flipped = !!sprite.flipX;
  const facingOrigin = () => (flipped ? flipOriginX : originX);
  sprite.setOrigin = function setOrigin(_x = 0.5, y = presentation.originY ?? 0.5) {
    return baseSetOrigin.call(this, facingOrigin(), y);
  };
  baseSetOrigin.call(sprite, facingOrigin(), presentation.originY ?? 0.5);
  Object.defineProperty(sprite, "flipX", {
    configurable: true,
    enumerable: true,
    get: () => flipped,
    set: (value) => {
      const next = !!value;
      if (next === flipped) return;
      flipped = next;
      if (flipOriginX === originX) return;
      baseSetOrigin.call(sprite, facingOrigin(), sprite.originY);
      // The same move applyFlipOffset makes from the presentation flipOffset.
      const body = sprite.body;
      const width = sprite.frame?.realWidth || sprite.width || 0;
      if (body?.offset) body.setOffset(body.offset.x + (next ? 1 : -1) * (flipOriginX - originX) * width, body.offset.y);
    },
  });
  boundPlayerSprites.add(sprite);
  sprite.once?.("destroy", () => boundPlayerSprites.delete(sprite));
}
