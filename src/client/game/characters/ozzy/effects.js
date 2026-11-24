import { characterDefinitions } from "../../../../shared/characters/index.js";
import { playPlayerSound } from "../../audio/playerAudio";

import { POWERUP_COLORS } from "../../powerups/powerupConfig";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { rigPoint } from "../shared/rig";
import { attachToPlayer } from "../shared/attachToPlayer";
import { pixelCircle, playSurgePushOut } from "./surgeFusion";

// Cast/beam timings live in src/shared/characters/ozzy.json (special.arcaneSurge).

const { key: NAME } = characterDefinitions.ozzy;

const SURGE = getResolvedCharacterSpecialConfig(NAME, "arcaneSurge");
const ARCANE_SURGE_BEAM_MS = SURGE.beamMs; // total beam lifetime per ally
// Visual-only beam phases within ARCANE_SURGE_BEAM_MS.
const BEAM_HIT_MS = 300; // beam reaches the ally
const BEAM_CLEAR_MS = 780; // beam tail fully faded
const ALLY_GLOW_COLOR = 0x7dd3fc; // fallback tint when a powerup has no color

function getSpriteAnchor(sprite) {
  const height = sprite?.displayHeight || sprite?.height || 120;
  return {
    x: Number(sprite?.x) || 0,
    y: (Number(sprite?.y) || 0) - height * 0.18,
    height,
  };
}

// The burning staff head on the frame being shown (ozzy.json
// `rig.points.staffTip.special` / `.surge`): beams and the burst leave from it.
function getStaffFlame(sprite) {
  return rigPoint(sprite, "staffTip", NAME) || getSpriteAnchor(sprite);
}

function getHitboxCenter(sprite) {
  const center = sprite?.body?.center;
  return Number.isFinite(center?.x) && Number.isFinite(center?.y)
    ? { x: center.x, y: center.y }
    : getSpriteAnchor(sprite);
}

function destroyMany(items = []) {
  for (const item of items) {
    try {
      item?.destroy?.();
    } catch (_) {}
  }
}

function isBeamTargetAlive(sprite) {
  return !!sprite?.active && sprite.visible !== false && sprite.body?.enable !== false;
}

// Smooth layered light with a sparse pixel fringe matches the sprite art.
function createPowerupBeam(scene, caster, sprite, entry, carriedIcon) {
  const graphics = scene.add.graphics();
  graphics.setBlendMode("ADD");
  graphics.setDepth((sprite.depth || 20) + 4);
  const launch = carriedIcon || getStaffFlame(caster);
  const start = { x: launch.x, y: launch.y };
  const icon = carriedIcon || scene.add.text(start.x, start.y, String(entry.type || "?").charAt(0).toUpperCase(), {
        fontFamily: "monospace", fontSize: "20px", color: "#ffffff",
      }).setOrigin(0.5);
  icon.setDepth((sprite.depth || 20) + 5);

  const state = { elapsed: 0 };
  let delivered = false;
  let tween;
  let disposed = false;
  const cleanup = () => {
    if (disposed) return;
    disposed = true;
    tween?.stop();
    scene.events?.off("shutdown", cleanup);
    scene.events?.off("presentation:reset", cleanup);
    scene.events?.off("update", checkAlive);
    sprite.off?.("destroy", cleanup);
    caster?.off?.("destroy", cleanup);
    sprite.off?.("combat:reset", cleanup);
    caster?.off?.("combat:reset", cleanup);
    destroyMany([graphics, icon]);
  };
  const checkAlive = () => {
    if (!isBeamTargetAlive(sprite) || !isBeamTargetAlive(caster)) cleanup();
  };
  const pixel = (x, y, size, color, alpha) => {
    graphics.fillStyle(color, alpha);
    graphics.fillRect(Math.round(x / 3) * 3 - size / 2,
      Math.round(y / 3) * 3 - size / 2, size, size);
  };
  scene.events?.once("shutdown", cleanup);
  scene.events?.once("presentation:reset", cleanup);
  scene.events?.on("update", checkAlive);
  sprite.once?.("destroy", cleanup);
  caster?.once?.("destroy", cleanup);
  sprite.once?.("combat:reset", cleanup);
  caster?.once?.("combat:reset", cleanup);
  tween = scene.tweens.add({
    targets: state,
    elapsed: ARCANE_SURGE_BEAM_MS,
    duration: ARCANE_SURGE_BEAM_MS,
    ease: "Linear",
    onUpdate: () => {
      checkAlive();
      if (disposed) return;
      const ms = state.elapsed;
      const target = getHitboxCenter(sprite);
      const source = getStaffFlame(caster);
      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const nx = -dy / distance;
      const ny = dx / distance;
      const fade = Math.min(1, ms / 80);
      const travel = Math.min(1, ms / BEAM_HIT_MS);
      const tip = { x: start.x + (target.x - start.x) * travel, y: start.y + (target.y - start.y) * travel };
      const reach = Math.min(1, Math.hypot(tip.x - source.x, tip.y - source.y) / distance);
      const tail = Math.max(0, Math.min(1, (ms - BEAM_HIT_MS) / (BEAM_CLEAR_MS - BEAM_HIT_MS)));
      const impact = Math.max(0, Math.min(1, (ms - BEAM_HIT_MS) / (ARCANE_SURGE_BEAM_MS - BEAM_HIT_MS)));
      const pulse = 0.85 + Math.sin(ms / 95) * 0.15;
      graphics.clear();
      const release = Math.max(0, 1 - ms / 300);
      // One strip per grid column (or row for steep beams). Adjacent strips
      // share an edge, so diagonal beams keep their steps at every angle.
      const cell = 3;
      const horizontal = Math.abs(dx) >= Math.abs(dy);
      const major = horizontal ? dx : dy;
      const steps = Math.max(1, Math.ceil(Math.abs(major) / cell));
      for (const [width, color, alpha] of [
        [39, 0x249cff, 0.09], [21, ALLY_GLOW_COLOR, 0.25],
        [12, 0xb8edff, 0.60], [6, 0xffffff, 0.95],
      ]) {
        const across = Math.max(1, Math.round(width * (1 + release * 0.4) * distance / (Math.max(1, Math.abs(major)) * cell)));
        const offset = Math.floor(across / 2) * cell;
        const axisStart = Math.round((horizontal ? source.x : source.y) / cell);
        for (let i = Math.floor(tail * steps); i < Math.ceil(reach * steps) && tail < reach; i++) {
          const t = i / steps;
          const along = (axisStart + Math.sign(major) * i) * cell;
          const cross = horizontal ? source.y + dy * t : source.x + dx * t;
          const side = Math.round(cross / cell) * cell - offset;
          const edge = tail > 0 ? Math.min(1, Math.max(0, (t - tail) / 0.16)) : 1;
          graphics.fillStyle(color, alpha * fade * pulse * edge);
          if (horizontal) graphics.fillRect(along, side, cell, across * cell);
          else graphics.fillRect(side, along, across * cell, cell);
        }
      }
      // A hot launch core and expanding shock ring announce the release.
      for (const [radius, alpha] of [[42, 0.08], [26, 0.17], [12, 0.6]]) {
        graphics.fillStyle(0xb8edff, alpha * fade * release);
        pixelCircle(graphics, source.x, source.y, radius * (1 + release * 0.5));
        pixelCircle(graphics, tip.x, tip.y, radius * 0.7);
      }
      if (release > 0) {
        graphics.fillStyle(0xe0f7ff, release * fade);
        pixelCircle(graphics, source.x, source.y, 12 + (1 - release) * 68, 3);
        for (let i = 0; i < 10; i++) {
          const angle = i * Math.PI / 5;
          const radius = 18 + (1 - release) * 80;
          for (let offset = 0; offset < 14 * release; offset += 4) {
            pixel(source.x + Math.cos(angle) * (radius + offset),
              source.y + Math.sin(angle) * (radius + offset), 3, ALLY_GLOW_COLOR, release * fade);
          }
        }
      }
      // Streams of detached pixels visibly flow from ozzy to teammate.
      for (let i = 0; i < 14; i++) {
        const t = (ms / 760 + i / 14) % 1;
        if (t > reach || t <= tail) continue;
        const spread = Math.sin(i * 2.4 + ms / 180) * (14 + (i % 3) * 5);
        pixel(source.x + dx * t + nx * spread,
          source.y + dy * t + ny * spread, i % 3 === 0 ? 6 : 3,
          i % 2 ? 0xffffff : ALLY_GLOW_COLOR, fade * 0.85 * Math.min(1, (t - tail) / 0.16));
      }
      icon.setPosition(tip.x, tip.y);
      icon.setAlpha(Math.max(0, 1 - impact * 5));
      if (ms >= BEAM_HIT_MS) {
        const burstFade = Math.pow(1 - impact, 2);
        const radius = 12 + (1 - Math.pow(1 - impact, 3)) * 66;
        graphics.fillStyle(ALLY_GLOW_COLOR, burstFade * 0.22);
        pixelCircle(graphics, target.x, target.y, radius);
        graphics.fillStyle(0xffffff, burstFade * 0.65);
        pixelCircle(graphics, target.x, target.y, 18 * (1 - impact));
        graphics.fillStyle(0xe0f7ff, burstFade);
        pixelCircle(graphics, target.x, target.y, radius, 5 * (1 - impact) + 1);
        graphics.fillStyle(ALLY_GLOW_COLOR, burstFade * 0.75);
        pixelCircle(graphics, target.x, target.y, radius * 0.72, 3);
        for (let i = 0; i < 12; i++) {
          const angle = i * Math.PI / 6;
          const sparkRadius = radius * (1 + impact * 0.4);
          pixel(target.x + Math.cos(angle) * sparkRadius,
            target.y + Math.sin(angle) * sparkRadius, i % 3 ? 3 : 6,
            i % 3 ? 0xe0f2fe : POWERUP_COLORS[entry.type] || ALLY_GLOW_COLOR,
            burstFade * 0.8);
        }
      }
      if (travel === 1 && !delivered) {
        delivered = true;
        try { playPlayerSound(scene, target, `pu-touch-${entry.type}`, { volume: 0.28 }); } catch (_) {}
      }
    },
    onComplete: cleanup,
  });
}

// The surge itself, drawn when the server's surge arrives, which is when the
// cast's flames burst (ozzy.json `arcaneSurge.surgeMs`): a white-hot flash
// with rays and a shock ring from the burning staff head, and his own powerup
// spiralling down from the staff into him. Pixel cells of SURGE_CELL px with
// opacity in whole thirds, like the sprite art.
const SURGE_CELL = 2;
const SURGE_FX_MS = 950;
const SURGE_COLORS = { white: 0xfffbea, gold: 0xffd166, ember: 0xff9f43, cyan: 0x67e8f9, violet: 0xa78bfa };
const thirds = (v) => Math.ceil(Math.max(0, Math.min(1, v)) * 3) / 3;
const ease = (v) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3);

function playSurgeBurst(scene, caster, boonColor) {
  return attachToPlayer(scene, caster, {
    key: "ozzy-surge-burst",
    layers: ["front"],
    lifetimeMs: SURGE_FX_MS,
    update(ms, _dt, { front }) {
      front.clear();
      const paint = (g) => (x, y, color, alpha = 1, size = 1) => {
        if (alpha <= 0) return;
        g.fillStyle(color, alpha);
        const shift = Math.floor((size - 1) / 2) * SURGE_CELL;
        g.fillRect(Math.round(x / SURGE_CELL) * SURGE_CELL - shift, Math.round(y / SURGE_CELL) * SURGE_CELL - shift, size * SURGE_CELL, size * SURGE_CELL);
      };
      const top = paint(front);
      const flame = getStaffFlame(caster);
      const chest = rigPoint(caster, "chest", NAME) || getHitboxCenter(caster);
      const t = ms / SURGE_FX_MS;

      // Flash: a white-hot core and eight rays that shoot out and thin away.
      const flash = 1 - ms / 260;
      if (flash > 0) {
        top(flame.x, flame.y, SURGE_COLORS.white, thirds(flash), 5);
        top(flame.x, flame.y, SURGE_COLORS.gold, thirds(flash * 0.8), 8);
      }
      const rays = ease(ms / 340);
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4 + Math.PI / 8;
        const long = i % 2 ? 0.6 : 1;
        for (let k = 0; k < 7; k++) {
          const r = 8 + rays * 58 * long * (k / 6);
          const fade = thirds((1 - ms / 420) * (1 - k / 8));
          top(flame.x + Math.cos(angle) * r, flame.y + Math.sin(angle) * r, k < 2 ? SURGE_COLORS.white : k < 4 ? SURGE_COLORS.gold : SURGE_COLORS.ember, fade);
        }
      }
      // Shock ring off the staff head, cooling from gold to violet.
      const ring = ease(ms / 480);
      if (ms < 520) {
        const radius = 8 + ring * 74;
        const color = ring < 0.35 ? SURGE_COLORS.gold : ring < 0.7 ? SURGE_COLORS.cyan : SURGE_COLORS.violet;
        for (let i = 0; i < 36; i++) {
          if (i % 3 === 2) continue;
          const angle = (i / 36) * Math.PI * 2 + ms / 400;
          top(flame.x + Math.cos(angle) * radius, flame.y + Math.sin(angle) * radius, color, thirds(1 - ring), ring < 0.3 ? 2 : 1);
        }
      }
      // His own powerup: motes spiral down from the staff fire into his chest.
      for (let i = 0; i < 9; i++) {
        const life = (ms - 120 - i * 35) / 420;
        if (life <= 0 || life >= 1) continue;
        const k = ease(life);
        const swirl = (1 - k) * 16;
        const angle = i * 0.7 + life * 7;
        const x = flame.x + (chest.x - flame.x) * k + Math.cos(angle) * swirl;
        const y = flame.y + (chest.y - flame.y) * k + Math.sin(angle) * swirl;
        top(x, y, i % 3 ? boonColor : SURGE_COLORS.white, thirds(Math.min(1, (1 - life) * 3)), i % 3 ? 1 : 2);
      }
      if (t >= 1) return false;
      return true;
    },
  });
}

export function playOzzyArcaneSurge(scene, payload, resolveSpriteByName) {
  if (!scene?.add || typeof resolveSpriteByName !== "function") return;

  const recipients = Array.isArray(payload?.recipients) ? payload.recipients : [];
  if (!recipients.length) return;

  // The caster's pose, sound and powerup orbit come from `player:special`
  // (special.js); this event, sent when the cast's flames burst, adds the
  // surge burst, pushes the picked powerups out of the fusion (surgeFusion.js)
  // and hands teammates' on to their beams.
  const casterSprite = resolveSpriteByName(payload?.caster);
  if (!isBeamTargetAlive(casterSprite)) return;
  const own = recipients.find((entry) => entry?.isCaster || entry?.username === payload?.caster);
  playSurgeBurst(scene, casterSprite, POWERUP_COLORS[own?.type] || ALLY_GLOW_COLOR);

  playSurgePushOut(scene, casterSprite, recipients, {
    casterName: payload?.caster,
    resolveSprite: (name) => {
      const sprite = resolveSpriteByName(name);
      return isBeamTargetAlive(sprite) ? sprite : null;
    },
    launchBeam: (sprite, entry, icon) => {
      if (!isBeamTargetAlive(sprite) || !isBeamTargetAlive(casterSprite)) return;
      createPowerupBeam(scene, casterSprite, sprite, entry, icon);
      return true;
    },
  });
}
