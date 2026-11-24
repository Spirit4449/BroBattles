import { characterDefinitions } from "../../../../shared/characters/index.js";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import rigData from "../../../../shared/characters/characterRig.js";
import { POWERUP_COLORS } from "../../powerups/powerupConfig";
import { playPlayerSound } from "../../audio/playerAudio";
import { rigPoint, spriteArtPoint } from "../shared/rig";
import { attachToPlayer } from "../shared/attachToPlayer";

// Arcane Surge's powerup fusion, around the caster:
//  1. orbit   when the staff strikes the floating book (cast frame
//             BOOK_FRAME), every powerup the surge can grant (ozzy.json
//             `arcaneSurge.powerups`) flies out of the book and circles him;
//  2. fusion  the circle tightens and collapses into the burning staff head as
//             the surge lands (`arcaneSurge.surgeMs`), then holds there as a
//             fused orb;
//  3. push-out when the server's surge arrives, the orb bursts and out come
//             the powerups it actually picked: the caster's own dives into
//             him, each teammate's is kicked towards them and handed to its
//             beam (effects.js).
// Drawn in SURGE_CELL px cells with opacity in whole thirds, like the sprite
// art and the surge burst.

const { key: NAME } = characterDefinitions.ozzy;
const SURGE = getResolvedCharacterSpecialConfig(NAME, "arcaneSurge");
const CANDIDATES = Array.isArray(SURGE.powerups) ? SURGE.powerups : [];
const FUSE_AT = SURGE.surgeMs; // cast time the fusion lands
const CAST_ANIM = `${NAME}-special`;
const BOOK_FRAME = "special03"; // the staff strikes the book
const BOOK_ART = rigData.rigPointArt(NAME, "staffTip", BOOK_FRAME);

const CELL = 2;
const ICON_PX = 18; // longest side of an orbiting icon
const EMERGE_MS = 260; // book -> orbit
const CONVERGE_MS = 300; // orbit -> staff head, ending at FUSE_AT
const HOLD_MS = 700; // longest the fused orb waits for the server's surge
const PUSH_MS = 170; // orb burst -> teammate beams launch
const ABSORB_AT = 220; // caster's icon starts diving into him
const ABSORB_MS = 300;
const PUSH_FX_MS = 900;
const WHITE = 0xfffbea;
const GOLD = 0xffd166;
const VIOLET = 0xa78bfa;

const clamp01 = (v) => Math.max(0, Math.min(1, v));
const thirds = (v) => Math.ceil(clamp01(v) * 3) / 3;
const ease = (v) => 1 - Math.pow(1 - clamp01(v), 3);
const easeIn = (v) => Math.pow(clamp01(v), 2);
const snap = (v) => Math.round(v / CELL) * CELL;
const colorOf = (type) => POWERUP_COLORS?.[type] || VIOLET;

function textureFor(scene, type) {
  for (const key of [`pu-icon-${type}-webp`, `pu-icon-${type}-png`]) {
    if (scene?.textures?.exists?.(key)) return key;
  }
  return null;
}

// An icon image, or null when the texture is missing (the trail still shows).
function makeIcon(scene, type) {
  const texture = textureFor(scene, type);
  if (!texture || !scene.add?.image) return null;
  const icon = scene.add.image(0, 0, texture);
  const longest = Math.max(icon.width || ICON_PX, icon.height || ICON_PX);
  icon.bbBaseScale = ICON_PX / longest;
  icon.setScale?.(icon.bbBaseScale);
  icon.setAlpha?.(0);
  return icon;
}

function placeIcon(icon, sprite, x, y, { scale = 1, alpha = 1, behind = false } = {}) {
  if (!icon) return;
  icon.setPosition?.(x, y);
  icon.setScale?.(Math.max(0.05, (icon.bbBaseScale || 1) * scale));
  icon.setAlpha?.(clamp01(alpha));
  icon.setDepth?.((sprite.depth || 20) + (behind ? -0.8 : 2.5));
}

function painter(g) {
  return (x, y, color, alpha = 1, size = 1) => {
    if (!g || alpha <= 0) return;
    g.fillStyle(color, thirds(alpha));
    const shift = Math.floor((size - 1) / 2) * CELL;
    g.fillRect(snap(x) - shift, snap(y) - shift, size * CELL, size * CELL);
  };
}

// Rasterize short lightning segments on the same grid as the surge sparks.
function boltSegment(layer, from, to, color, strength) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / CELL);
  for (let k = 1; k <= steps; k++) {
    const x = snap(from.x + dx * k / steps), y = snap(from.y + dy * k / steps);
    layer.fillStyle(color, strength * 0.16);
    layer.fillRect(x - CELL, y - CELL, CELL * 3, CELL * 3);
    layer.fillStyle(0xcffaff, strength);
    layer.fillRect(x, y, CELL, CELL);
  }
}

// Draw each row of the disc or ring once so additive light stays even.
export function pixelCircle(graphics, x, y, radius, thickness = radius) {
  if (radius <= 0 || thickness <= 0) return;
  const cell = 3;
  const r = Math.round(radius / cell);
  const inner = Math.max(0, r - Math.max(1, Math.round(thickness / cell)));
  const cx = Math.round(x / cell) * cell;
  const cy = Math.round(y / cell) * cell;
  for (let row = -r; row <= r; row++) {
    const edge = Math.floor(Math.sqrt(r * r - row * row));
    const py = cy + row * cell;
    if (Math.abs(row) >= inner) {
      graphics.fillRect(cx - edge * cell, py, (2 * edge + 1) * cell, cell);
    } else {
      const hole = Math.ceil(Math.sqrt(inner * inner - row * row));
      const width = (edge - hole + 1) * cell;
      graphics.fillRect(cx - edge * cell, py, width, cell);
      graphics.fillRect(cx + hole * cell, py, width, cell);
    }
  }
}

const staffHead = (sprite) => rigPoint(sprite, "staffTip", NAME) || { x: sprite.x, y: sprite.y - 40 };
const chestOf = (sprite) => rigPoint(sprite, "chest", NAME) || { x: sprite.x, y: sprite.y - 20 };

// How far into the cast the sprite is, and when the book is struck, read from
// the playing animation so the owner (whose pose started on the key press)
// and remote viewers line up with the frames they see.
function castClock(sprite) {
  const anims = sprite?.anims;
  const anim = anims?.currentAnim;
  if (!anim || anim.key !== CAST_ANIM || !Array.isArray(anim.frames)) return null;
  const step = (frame) => (Number(anim.msPerFrame) || 0) + (Number(frame?.duration) || 0);
  let at = 0;
  let touch = null;
  let elapsed = null;
  for (const frame of anim.frames) {
    if (touch === null && frame.textureFrame === BOOK_FRAME) touch = at;
    if (elapsed === null && frame === anims.currentFrame) elapsed = at + (Number(anims.accumulator) || 0);
    at += step(frame);
  }
  return { elapsed: elapsed ?? 0, touch: touch ?? 0 };
}

function drawWarmupHalo(caster, ms, low, top) {
  const feet = rigPoint(caster, "feet", NAME) || caster;
  // Rune circle under his feet: flares out, turns, then fades.
  const grow = ease(ms / 300);
  const runeFade = thirds(Math.min(1, (FUSE_AT - ms) / 320));
  const rx = 18 + grow * 44;
  for (const [scale, color, dash, turn] of [[1, VIOLET, 4, 1], [0.72, 0x67e8f9, 3, -1.6], [0.45, 0x7c3aed, 2, 2.2]]) {
    const count = Math.round(40 * scale);
    for (let i = 0; i < count; i++) {
      if (i % dash === dash - 1) continue;
      const angle = (i / count) * Math.PI * 2 + (turn * ms) / 700;
      low(feet.x + Math.cos(angle) * rx * scale, feet.y + Math.sin(angle) * rx * scale * 0.24, color, runeFade);
    }
  }
  // Sparks lift off the rune circle.
  for (let i = 0; i < 14; i++) {
    const start = (i % 7) * 60;
    const life = (ms - start) / 600;
    if (life <= 0 || life >= 1) continue;
    const angle = i * 2.39996;
    const x = feet.x + Math.cos(angle) * rx * (0.5 + 0.5 * ((i * 7) % 5) / 4);
    const y = feet.y + Math.sin(angle) * rx * 0.2 - ease(life) * (46 + (i % 4) * 12);
    top(x + Math.sin(life * 9 + i) * 3, y, i % 3 ? VIOLET : 0x67e8f9, thirds(1 - life), i % 4 ? 1 : 2);
  }
}

const fusionKey = "ozzy-surge-fusion";

// Phases 1-2, started with the caster's `player:special` on every client.
export function playSurgeOrbit(scene, caster) {
  if (!scene?.add || !caster || !CANDIDATES.length) return null;
  const clock = castClock(caster);
  let cast = clock ? clock.elapsed : 0;
  const touchAt = clock ? clock.touch : 0;
  // Already past the fusion (a late `player:special`): nothing to circle.
  if (cast >= FUSE_AT + HOLD_MS) return null;
  const icons = new Map(CANDIDATES.map(type => [type, makeIcon(scene, type)]));
  const phase = (FUSE_AT - CONVERGE_MS - touchAt) / 1000;
  const handle = attachToPlayer(scene, caster, {
    key: fusionKey,
    layers: ["floor", "behind", "front"],
    onEnd() { for (const icon of icons.values()) icon?.destroy(); },
    lifetimeMs: FUSE_AT + HOLD_MS - cast,
    update(_ms, dt, { floor, behind, front }) {
      cast += dt;
      // Interrupted cast (stun, death pose): the circle breaks off.
      const anim = caster.anims?.currentAnim?.key;
      if (clock && anim && anim !== CAST_ANIM) return false;
      floor.clear(); behind.clear(); front.clear();
      const back = painter(behind); const top = painter(front);
      if (cast < FUSE_AT) drawWarmupHalo(caster, cast, painter(floor), top);
      const since = cast - touchAt;
      if (since < 0) {
        for (const icon of icons.values()) icon?.setAlpha?.(0);
        return true;
      }
      const book = BOOK_ART ? spriteArtPoint(caster, BOOK_ART, NAME) : staffHead(caster);
      const chest = chestOf(caster);
      const head = staffHead(caster);
      const height = caster.displayHeight || 100;
      const rx = height * (0.5 - 0.12 * clamp01(since / 700));
      const ry = rx * 0.36;
      const centre = { x: chest.x, y: chest.y - height * 0.04 };
      // Spin speeds up from 4 to 13 rad/s towards the fusion.
      const s = since / 1000;
      const spin = 4 * s + (9 / 2) * s * s / Math.max(0.2, phase);
      const converge = easeIn((cast - (FUSE_AT - CONVERGE_MS)) / CONVERGE_MS);
      const fused = cast >= FUSE_AT;

      const orbitAt = (i, extra = 0) => {
        const angle = spin - extra + (i / CANDIDATES.length) * Math.PI * 2;
        return { x: centre.x + Math.cos(angle) * rx, y: centre.y + Math.sin(angle) * ry, angle };
      };
      CANDIDATES.forEach((type, i) => {
        const icon = icons.get(type);
        const color = colorOf(type);
        if (fused) { icon?.setAlpha?.(0); return; }
        const emerge = ease((since - i * 40) / EMERGE_MS);
        const at = (extra) => {
          const ring = orbitAt(i, extra);
          let x = book.x + (ring.x - book.x) * emerge;
          let y = book.y + (ring.y - book.y) * emerge;
          x += (head.x - x) * converge;
          y += (head.y - y) * converge;
          return { x, y, behind: Math.sin(ring.angle) < 0 && converge < 0.5 };
        };
        const pos = at(0);
        if (emerge <= 0) { icon?.setAlpha?.(0); return; }
        // Hold each bolt shape for a few frames while it travels with the orbit.
        // Taper the displacement at the ends so neighbouring arcs stay on the ring.
        const arc = 2 * Math.PI / CANDIDATES.length;
        const charge = emerge * (1 - converge);
        const beat = Math.floor((since + i * 23) / 115);
        let previous = at(arc * 0.10);
        for (let k = 1; k <= 8; k++) {
          const t = k / 8;
          const lag = arc * (0.10 + 0.90 * t);
          const p = at(lag);
          const angle = spin - lag + i * arc;
          const offset = (k % 2 ? 1 : -1) * (4 + 3 * Math.sin(beat * 2.3 + i + k * 1.7))
            * Math.sin(Math.PI * t) * charge;
          const nx = Math.cos(angle), ny = Math.sin(angle);
          p.x += offset * nx;
          p.y += offset * ny;
          const layer = p.behind ? behind : front;
          const strength = charge * (1 - 0.48 * t) * (p.behind ? 0.65 : 1);
          boltSegment(layer, previous, p, color, strength);
          if (k === 3 && (beat + i) % 2 === 0) {
            const elbow = { x: p.x + (7 * nx + 4 * ny) * charge, y: p.y + (7 * ny - 4 * nx) * charge };
            const end = { x: elbow.x + 5 * nx * charge, y: elbow.y + 5 * ny * charge };
            boltSegment(layer, p, elbow, color, strength * 0.75);
            boltSegment(layer, elbow, end, color, strength * 0.45);
          }
          previous = p;
        }
        placeIcon(icon, caster, pos.x, pos.y, {
          scale: (0.35 + 0.65 * emerge) * (1 - 0.6 * converge) * (1 + (pos.behind ? -0.12 : 0.08)),
          alpha: emerge * (pos.behind ? 0.67 : 1) * (1 - converge ** 4),
          behind: pos.behind,
        });
        if (!icon) (pos.behind ? back : top)(pos.x, pos.y, color, emerge, 3);
      });
      // Sparks spill from the book as it is struck.
      for (let i = 0; i < 8; i++) {
        const life = (since - i * 22) / 320;
        if (life <= 0 || life >= 1) continue;
        const angle = i * 2.4 + 0.6;
        top(book.x + Math.cos(angle) * ease(life) * 22, book.y + Math.sin(angle) * ease(life) * 16 - life * 8,
          i % 2 ? colorOf(CANDIDATES[i % CANDIDATES.length]) : WHITE, 1 - life);
      }
      if (fused) drawFusedOrb(top, head, cast - FUSE_AT, 1);
      return true;
    },
  });
  handle.layers.behind.setBlendMode("ADD");
  handle.layers.front.setBlendMode("ADD");
  handle.takeIcon = type => {
    const icon = icons.get(type);
    icons.delete(type);
    return icon;
  };
  return handle;
}

// The fused orb: a white-hot core inside a turning ring of every candidate's
// colour, which flares as it forms.
function drawFusedOrb(top, at, ms, strength) {
  const flare = 1 - ms / 220;
  if (flare > 0) {
    top(at.x, at.y, WHITE, flare * strength, 7);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const r = 6 + ease(ms / 220) * 26;
      top(at.x + Math.cos(angle) * r, at.y + Math.sin(angle) * r, colorOf(CANDIDATES[i % CANDIDATES.length]), flare * strength);
    }
  }
  const pulse = 0.75 + 0.25 * Math.sin(ms / 60);
  top(at.x, at.y, GOLD, 0.67 * strength * pulse, 5);
  top(at.x, at.y, WHITE, strength, 3);
  CANDIDATES.forEach((type, i) => {
    const angle = ms / 90 + (i / CANDIDATES.length) * Math.PI * 2;
    top(at.x + Math.cos(angle) * 9, at.y + Math.sin(angle) * 9, colorOf(type), strength * pulse, 2);
  });
}

// Phase 3, on the server's surge. `recipients` are { username, type, isCaster };
// `launchBeam(sprite, entry)` starts a teammate's beam once its icon is out.
export function playSurgePushOut(scene, caster, recipients, { casterName, resolveSprite, launchBeam } = {}) {
  if (!scene?.add || !caster) return null;
  const orbit = caster._bbAttachments?.get(fusionKey);
  const own = recipients.find((entry) => entry?.isCaster || (casterName && entry?.username === casterName)) || null;
  const allies = recipients.filter((entry) => entry && entry !== own)
    .map((entry) => ({ entry, sprite: resolveSprite?.(entry.username) }))
    .filter(({ sprite }) => sprite && sprite !== caster);
  // Each distinct roll inherits its orbit sprite. Duplicate rolls split at the staff.
  const take = type => orbit?.takeIcon(type) || makeIcon(scene, type);
  const ownIcon = own ? take(own.type) : null;
  const allyIcons = allies.map(({ entry }) => take(entry.type));
  // A surge can arrive a frame before convergence. Start from the last visible pose.
  const visiblePose = icon => icon?.alpha > 0 ? { x: icon.x, y: icon.y, alpha: icon.alpha, scale: icon.scaleX / icon.bbBaseScale } : null;
  const ownPose = visiblePose(ownIcon);
  const allyPoses = allyIcons.map(visiblePose);
  orbit?.destroy();
  function emerge(icon, pose, x, y, scale, progress) {
    if (pose) {
      x += (pose.x - x) * (1 - progress);
      y += (pose.y - y) * (1 - progress);
      scale += (pose.scale - scale) * (1 - progress);
    }
    placeIcon(icon, caster, x, y, { scale, alpha: progress + (pose?.alpha || 0) * (1 - progress) });
  }
  let launched = false;
  let absorbed = false;
  return attachToPlayer(scene, caster, {
    key: "ozzy-surge-push-out",
    layers: ["front"],
    objects: [ownIcon],
    onEnd() { for (const icon of allyIcons) icon?.destroy(); },
    lifetimeMs: PUSH_FX_MS,
    update(ms, _dt, { front }) {
      front.clear();
      const top = painter(front);
      const head = staffHead(caster);
      const chest = chestOf(caster);
      // The orb bursts: its core blows out and thins away.
      drawFusedOrb(top, head, 220 + ms, clamp01(1 - ms / 160));
      const burst = ease(ms / 200);
      for (let i = 0; i < 10; i++) {
        const angle = (i / 10) * Math.PI * 2 + 0.3;
        top(head.x + Math.cos(angle) * (6 + burst * 30), head.y + Math.sin(angle) * (6 + burst * 30),
          i % 2 ? WHITE : colorOf(CANDIDATES[i % CANDIDATES.length]), 1 - ms / 240);
      }
      // Teammates' powerups are kicked out towards them, then ride the beams.
      if (!launched) allies.forEach(({ entry, sprite }, i) => {
        const icon = allyIcons[i];
        const target = sprite.body?.center || sprite;
        const dx = target.x - head.x; const dy = target.y - head.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const out = ease(ms / PUSH_MS);
        const x = head.x + (dx / d) * 20 * out; const y = head.y + (dy / d) * 20 * out;
        emerge(icon, allyPoses[i], x, y, 0.4 + 0.7 * out, out);
        for (let k = 1; k <= 3; k++) top(x - (dx / d) * k * 5, y - (dy / d) * k * 5, colorOf(entry.type), out * (1 - k / 4));
        if (!icon) top(x, y, colorOf(entry.type), out, 3);
      });
      if (ms >= PUSH_MS && !launched) {
        launched = true;
        allies.forEach(({ entry, sprite }, i) => {
          if (launchBeam?.(sprite, entry, allyIcons[i])) allyIcons[i] = null;
          else allyIcons[i]?.setAlpha(0);
        });
      }
      // His own powerup hangs over the staff, then dives into his chest.
      if (own) {
        const color = colorOf(own.type);
        const pop = ease(ms / 140);
        const dive = easeIn((ms - ABSORB_AT) / ABSORB_MS);
        const hover = { x: head.x, y: head.y - 14 * pop };
        const x = hover.x + (chest.x - hover.x) * dive + Math.sin(dive * Math.PI) * 14 * (caster.flipX ? 1 : -1);
        const y = hover.y + (chest.y - hover.y) * dive;
        if (dive < 1) {
          emerge(ownIcon, ownPose, x, y, (0.4 + 0.8 * pop) * (1 - 0.65 * dive), pop);
          for (let k = 1; k <= 4 && dive > 0; k++) {
            const t = Math.max(0, dive - k * 0.07);
            top(hover.x + (chest.x - hover.x) * t, hover.y + (chest.y - hover.y) * t, k === 1 ? WHITE : color, 1 - k / 5);
          }
          if (!ownIcon) top(x, y, color, pop, 3);
        } else {
          ownIcon?.setAlpha?.(0);
          if (!absorbed) {
            absorbed = true;
            try { playPlayerSound(scene, caster, `pu-touch-${own.type}`, { volume: 0.28 }); } catch (_) {}
          }
          // Taken in: a ring of its colour pulses out from his chest.
          const life = (ms - ABSORB_AT - ABSORB_MS) / 360;
          if (life < 1) {
            const r = 6 + ease(life) * 30;
            for (let i = 0; i < 20; i++) {
              if (i % 4 === 3) continue;
              const angle = (i / 20) * Math.PI * 2;
              top(chest.x + Math.cos(angle) * r, chest.y + Math.sin(angle) * r * 0.8, i % 2 ? color : WHITE, 1 - life);
            }
            top(chest.x, chest.y, WHITE, 1 - life * 1.5, 3);
          }
        }
      }
      if (ms >= PUSH_FX_MS) return false;
      return true;
    },
  });
}
