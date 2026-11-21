// Ninja's Shuriken Swarm on screen, as one flow:
//   cast     an ink-smoke poof around him, a crescent slash along the aim and
//            a ringing steel shing
//   barrage  his flurry of throws (the special-* clips, aimed like his basic
//            throws) while speed lines stream back off him; each shuriken
//            leaves with a spark and spins in a spirit ring
//   turn     every shuriken glints where it turns back
//   cut      a cross slash on each target the swarm hits
//   catch    each returning shuriken is pocketed with a spark and a pocket
//            sound (a sharp whoosh; a ding for the crown skin), and the last
//            one ends it with a glint
// Pixel art from scripts/art/ninja-pixel/swarm-fx.cjs (one art pixel per world
// pixel, a green and a red team palette), sounds from swarm-sfx.cjs.
// Presentation only: the server owns the shuriken and their hits.
import { characterDefinitions } from "../../../../shared/characters/index.js";
import { getResolvedCharacterSpecialConfig } from "../../../../shared/characters/characterTuning.js";
import { teamColor, TEAM_RED } from "../../../../shared/projectilePresentation";
import { RENDER_LAYERS } from "../../scene/renderLayers";
import { playPlayerSound } from "../../audio/playerAudio";
import { ninjaProjectileTexture } from "./projectileTexture";

const { key: NAME } = characterDefinitions.ninja;
const SWARM = getResolvedCharacterSpecialConfig(NAME, "swarm");

export const SWARM_FX_KEY = "ninja-swarm-fx";
// name -> frames, fps, repeat (-1 loops)
export const SWARM_FX_ANIMS = {
  smoke: { count: 12, rate: 24, repeat: 0 },
  slash: { count: 8, rate: 30, repeat: 0 },
  wind: { count: 6, rate: 24, repeat: -1 },
  aura: { count: 8, rate: 24, repeat: -1 },
  glint: { count: 8, rate: 24, repeat: 0 },
  impact: { count: 8, rate: 30, repeat: 0 },
  spark: { count: 6, rate: 30, repeat: 0 },
};
export const SWARM_SOUNDS = {
  cast: "ninja-swarm-cast",
  throw: "ninja-swarm-throw",
  hit: "ninja-shuriken-hit", // loaded with his basic sounds (constructor.js)
  pocket: "ninja-swarm-pocket",
  pocketCrown: "ninja-swarm-pocket-crown",
};
export const SWARM_SOUND_FILES = {
  [SWARM_SOUNDS.cast]: "swarm-cast.mp3",
  [SWARM_SOUNDS.throw]: "swarm-throw.mp3",
  [SWARM_SOUNDS.pocket]: "swarm-pocket.mp3",
  [SWARM_SOUNDS.pocketCrown]: "swarm-pocket-crown.mp3",
};

// The barrage on screen: every release plus the facing hold after it.
const BARRAGE_MS = SWARM.count * SWARM.releaseMs + SWARM.lockPaddingMs;
// Hits from fifteen shuriken land close together: one cross slash and one
// slice sound per window keeps a full barrage on one target readable.
const IMPACT_GAP_MS = 70;
const IMPACT_SCALE = 0.8;

const frameName = (name, palette, i) => `${name}${palette}${String(i).padStart(2, "0")}`;
const animKey = (name, palette) => `${SWARM_FX_KEY}-${name}-${palette}`;
const paletteOf = (team) => (teamColor(team) === TEAM_RED ? "R" : "G");
const nowOf = (scene) => scene?.time?.now ?? performance.now();

function ready(scene) {
  return !!scene?.add && !!scene.textures?.exists?.(SWARM_FX_KEY);
}

/** Registers the swarm animations once the atlas is loaded. */
export function createSwarmFxAnimations(scene) {
  if (!scene?.textures?.exists?.(SWARM_FX_KEY)) return;
  for (const palette of ["G", "R"]) {
    for (const [name, { count, rate, repeat }] of Object.entries(SWARM_FX_ANIMS)) {
      const key = animKey(name, palette);
      if (scene.anims.exists(key)) continue;
      scene.anims.create({ key, frameRate: rate, repeat,
        frames: Array.from({ length: count }, (_, i) => ({ key: SWARM_FX_KEY, frame: frameName(name, palette, i) })) });
    }
  }
}

function fx(scene, name, palette, x, y, depth) {
  const sprite = scene.add.sprite(x, y, SWARM_FX_KEY, frameName(name, palette, 0)).setDepth(depth);
  const key = animKey(name, palette);
  if (scene.anims?.exists?.(key)) sprite.anims.play(key);
  return sprite;
}

// Removes a one-shot when its animation ends, or after `ms` as a fallback.
function oneShot(scene, name, palette, x, y, depth, ms = 700) {
  const sprite = fx(scene, name, palette, x, y, depth);
  const done = () => { if (sprite.active) sprite.destroy(); };
  sprite.once?.("animationcomplete", done);
  scene.time?.delayedCall?.(ms, done);
  return sprite;
}

const facingOf = (player) => (player.flipX ? -1 : 1);
const isLocal = (scene, player) => scene?._localPlayerAudioSprite === player;

function endSwarm(scene, swarm) {
  if (swarm.ended) return;
  swarm.ended = true;
  scene.events?.off?.("update", swarm.update);
  scene.events?.off?.("shutdown", swarm.shutdown);
  if (swarm.player?._ninjaSwarm === swarm) delete swarm.player._ninjaSwarm;
  for (const object of swarm.objects) {
    scene.tweens?.killTweensOf?.(object);
    if (object.active) object.destroy();
  }
  swarm.objects.clear();
}

// The barrage is over: the speed lines die away.
function endBarrage(scene, swarm) {
  if (swarm.barrageDone) return;
  swarm.barrageDone = true;
  if (swarm.wind?.active) scene.tweens?.add?.({ targets: swarm.wind, alpha: 0, duration: 160 });
}

// Where along the aim the cast's slash and speed lines sit, from his throwing hand.
const HAND_Y = -12;
const SLASH_REACH = 36;
const WIND_BEHIND = 40;
const aimOf = (player, angle) => (Number.isFinite(angle) ? angle : player.flipX ? Math.PI : 0);

/**
 * Starts the swarm's flow on `player`, or returns the one already running.
 * Called on each shuriken release; only the first release of a barrage casts.
 * `angle` is the super's aim (radians, +y down).
 */
export function beginSwarm(scene, player, angle = null) {
  if (!ready(scene) || !player?.active) return null;
  const now = nowOf(scene);
  const running = player._ninjaSwarm;
  if (running && !running.ended && now < running.barrageUntil) return running;
  if (running) endSwarm(scene, running);

  const palette = paletteOf(player);
  const aim = aimOf(player, angle);
  const ux = Math.cos(aim), uy = Math.sin(aim);
  const objects = new Set();
  const swarm = { player, palette, objects, startedAt: now, barrageUntil: now + BARRAGE_MS,
    outstanding: SWARM.count, caught: 0, ended: false };
  player._ninjaSwarm = swarm;

  // Cast: an ink-smoke poof around him, a crescent slash along the aim and the shing.
  oneShot(scene, "smoke", palette, player.x, player.y - 4, RENDER_LAYERS.PLAYER + 1).setScale(1.15).setAlpha(0.85);
  oneShot(scene, "slash", palette, player.x + ux * SLASH_REACH, player.y + HAND_Y + uy * SLASH_REACH, RENDER_LAYERS.ATTACKS + 2)
    .setRotation(aim).setBlendMode?.("ADD");
  playPlayerSound(scene, player, SWARM_SOUNDS.cast);
  if (isLocal(scene, player)) scene.cameras?.main?.shake?.(110, 0.0025);

  // Speed lines stream back off him, opposite the aim, while he throws.
  swarm.wind = fx(scene, "wind", palette, 0, 0, RENDER_LAYERS.PLAYER - 2).setRotation(aim).setAlpha(0.85);
  objects.add(swarm.wind);

  swarm.update = () => {
    const t = nowOf(scene);
    if (!player.active || player.visible === false) return endSwarm(scene, swarm);
    if (swarm.wind?.active) swarm.wind.setPosition(player.x - ux * WIND_BEHIND, player.y + HAND_Y + 4 - uy * WIND_BEHIND);
    if (t >= swarm.barrageUntil) endBarrage(scene, swarm);
    // Nothing left to catch (or a lost packet): stand down.
    if (t > swarm.startedAt + SWARM.maxLifetimeMs + 500) endSwarm(scene, swarm);
  };
  swarm.shutdown = () => endSwarm(scene, swarm);
  scene.events?.on?.("update", swarm.update);
  scene.events?.once?.("shutdown", swarm.shutdown);
  swarm.update();
  return swarm;
}

/** A spark where a swarm shuriken leaves (or is caught). */
export function swarmSpark(scene, x, y, team) {
  if (!ready(scene)) return;
  oneShot(scene, "spark", paletteOf(team), x, y, RENDER_LAYERS.ATTACKS + 2).setBlendMode?.("ADD");
}

/** The glint where a shuriken turns back. */
export function swarmGlint(scene, x, y, team) {
  if (!ready(scene)) return;
  oneShot(scene, "glint", paletteOf(team), x, y, RENDER_LAYERS.ATTACKS + 3);
}

/** A cross slash on a target the swarm cut. */
export function swarmImpact(scene, x, y, owner, { sound = true } = {}) {
  if (!ready(scene)) return;
  const now = nowOf(scene);
  if (now - (scene._ninjaSwarmImpactAt ?? -Infinity) < IMPACT_GAP_MS) return;
  scene._ninjaSwarmImpactAt = now;
  oneShot(scene, "impact", paletteOf(owner), x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 12, RENDER_LAYERS.ATTACKS + 4)
    .setScale(IMPACT_SCALE).setRotation((Math.random() - 0.5) * 0.6);
  if (!sound) return;
  playPlayerSound(scene, owner?.active ? owner : { x, y }, SWARM_SOUNDS.hit);
}

/** The spirit ring a swarm shuriken spins in; follows `sprite`. */
export function createSwarmAura(scene, sprite) {
  if (!ready(scene)) return null;
  const aura = fx(scene, "aura", paletteOf(sprite), sprite.x, sprite.y, RENDER_LAYERS.ATTACKS - 1);
  aura.setBlendMode?.("ADD");
  aura.anims?.setProgress?.(Math.random());
  return {
    update(visible) { if (aura.active) aura.setVisible(visible).setPosition(Math.round(sprite.x), Math.round(sprite.y)); },
    destroy() { if (aura.active) aura.destroy(); },
  };
}

// A skin whose shuriken is its own weapon art (the crown) pockets it with a
// ding; the base shuriken with a sharp whoosh.
function pocketSound(scene, player) {
  return ninjaProjectileTexture(scene, player).includes("-weapon") ? SWARM_SOUNDS.pocketCrown : SWARM_SOUNDS.pocket;
}

/** One swarm shuriken thrown: the sharpened throw sound, its pitch varied a little. */
export function swarmThrowSound(scene, player) {
  playPlayerSound(scene, player, SWARM_SOUNDS.throw, { rate: 1.22 + Math.random() * 0.16 });
}

/**
 * One swarm shuriken ended. A caught one is pocketed (a spark at his hand and
 * the pocket sound); the last one closes the super.
 */
export function swarmShardEnded(scene, player, { returned = false } = {}) {
  const swarm = player?._ninjaSwarm;
  if (returned && player?.active) {
    swarmSpark(scene, player.x + facingOf(player) * 14, player.y - 10, player);
    playPlayerSound(scene, player, pocketSound(scene, player), { rate: 0.94 + Math.random() * 0.14 });
  }
  if (!swarm || swarm.ended) return;
  if (returned) swarm.caught++;
  swarm.outstanding--;
  if (swarm.outstanding > 0) return;
  endBarrage(scene, swarm);
  if (swarm.caught > 0 && player.active) {
    swarmGlint(scene, player.x + facingOf(player) * 12, player.y - 14, player);
  }
  // Let the speed lines fade before tearing down.
  scene.time?.delayedCall?.(260, () => endSwarm(scene, swarm));
}
