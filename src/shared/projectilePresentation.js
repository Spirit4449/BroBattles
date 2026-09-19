// Actors are buffered; combat remains on the current server timeline so hit
// feedback is not delayed. Bridge a fresh remote launch from its displayed
// actor to the authoritative flight path, then converge over 100 ms.
function remoteLaunchCorrection(actor, origin, ageMs, now) {
  if (!actor || !origin || ageMs < 0 || ageMs > 120) return null;
  const x = actor.x - origin.x, y = actor.y - origin.y;
  if (!Number.isFinite(x) || !Number.isFinite(y) || Math.hypot(x, y) > 200) return null;
  return { x, y, at: now, duration: 100 };
}
const TEAM_GREEN = 0x50ce88;
const TEAM_RED = 0xff413f;
function teamColor(owner) {
  return owner?._bbTeamColor === TEAM_RED ? TEAM_RED : TEAM_GREEN;
}

// Canvas is the live game's renderer. Cache recolored atlas sources and cloned
// frames, so animation and skin geometry remain intact without per-frame pixels.
const coloredSources = new WeakMap();
const coloredFrames = new WeakMap();
function teamPalette(owner) {
  return teamColor(owner) === TEAM_RED
    ? { edge: 0xd92f46, mid: 0xff6253, light: 0xffc18a, core: 0xfff2d4 }
    : { edge: 0x179968, mid: 0x4ee59a, light: 0xb0ffd1, core: 0xf1fff6 };
}
// Selective material edits only. Gold, silhouettes and neutral highlights stay intact.
function materialPixel(value, color, style, x = 0, width = 1) {
  const r = value >> 16, g = (value >> 8) & 255, b = value & 255;
  if (style === 'crown' && color !== TEAM_RED && r > g*1.5 && r > b*1.4) {
    return (b << 16) | (Math.min(255, Math.round(g*0.65+r*0.35)) << 8) | r;
  }
  if (style === 'crown' && color !== TEAM_RED && g > r*1.25 && g > b*1.15) {
    return (Math.round(b*0.5) << 16) | (Math.round(g*0.65) << 8) | g;
  }
  if (style === 'arrow' && color === TEAM_RED && x > width*0.72) {
    return (Math.min(255, Math.round(r*0.65+90)) << 16) | (Math.round(g*0.66) << 8) | Math.round(b*0.67);
  }
  if (style === 'weapon' && Math.max(r,g,b)-Math.min(r,g,b) < 65 && r+g+b > 100) {
    const target = color === TEAM_RED ? [230,105,98] : [95,205,145];
    return [r,g,b].reduce((v,c,i)=>(v<<8)|Math.round(c*0.82+target[i]*0.18),0);
  }
  return value;
}
// Kept for effects that deliberately retain their existing palette.
function attackColor(_owner, original) { return original; }

function coloredFrame(frame, color, style) {
  if (!frame?.source?.image || typeof document === "undefined") return frame;
  const cacheKey = `${color}:${style}`;
  let frames = coloredFrames.get(frame);
  if (!frames) coloredFrames.set(frame, frames = new Map());
  if (frames.has(cacheKey)) return frames.get(cacheKey);
  let sources = coloredSources.get(frame.source);
  if (!sources) coloredSources.set(frame.source, sources = new Map());
  if (!sources.has(cacheKey)) {
    const canvas = document.createElement("canvas");
    canvas.width = frame.source.width;
    canvas.height = frame.source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(frame.source.image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < pixels.data.length; i += 4) {
      const rgb = materialPixel((pixels.data[i] << 16) | (pixels.data[i+1] << 8) | pixels.data[i+2], color, style, (i / 4) % canvas.width, canvas.width);
      pixels.data[i] = rgb >> 16; pixels.data[i+1] = (rgb >> 8) & 255; pixels.data[i+2] = rgb & 255;
    }
    ctx.putImageData(pixels, 0, 0);
    sources.set(cacheKey, { ...frame.source, image: canvas });
  }
  const clone = frame.clone();
  clone.source = sources.get(cacheKey);
  frames.set(cacheKey, clone);
  return clone;
}

// Team ownership is shared, but every material edit is explicitly opted into.
// Generated attacks and procedural palettes never receive a global filter.
function applyTeamVisual(sprite, owner, projectile = false, style = null) {
  if (!sprite || sprite._bbTeamVisualApplied) return;
  sprite._bbTeamVisualApplied = true;
  const color = teamColor(owner);
  sprite._bbTeamColor = color;
  if (!projectile || !style) return;
  if (sprite.renderCanvas) {
    const render = sprite.renderCanvas;
    sprite.renderCanvas = function(renderer, src, camera, parentMatrix) {
      const original = src.frame;
      try {
        if (original) src.frame = coloredFrame(original, color, style);
        render.call(this, renderer, src, camera, parentMatrix);
      } finally {
        src.frame = original;
      }
    };
  }
}
function reconcileFlight(from, to, now, speed) {
  const x = from.x - to.x, y = from.y - to.y;
  // Removing error at <= half normal flight speed avoids confirmation reversing
  // an outbound shot. Authority still owns collisions, turns and lifetime.
  const duration = Math.max(100, Math.min(1200, 2000 * Math.hypot(x, y) / Math.max(100, speed || 0)));
  return { x, y, at: now, duration };
}
module.exports = { remoteLaunchCorrection, reconcileFlight, TEAM_GREEN, TEAM_RED, teamColor, applyTeamVisual, materialPixel, teamPalette, attackColor };
