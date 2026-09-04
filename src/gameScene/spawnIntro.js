import { resolveAnimKey } from '../characters';
import { spawnSpawnBurst, spawnFastFallTrail } from '../effects';

export const PARACHUTE_FALL_SPEED = 88;
export const PARACHUTE_HEIGHT = 89;
export const PARACHUTE_DRIFT_DISTANCE = 36;

// Reserve clearance for the whole descent, including the landing platform's
// edges. Narrow ledges/corridors automatically reduce or disable the breeze.
export function parachuteBreezeClearance(body, objects, height, launchSide = -1) {
  let clearance = Math.min(PARACHUTE_DRIFT_DISTANCE, height * 0.23);
  for (const object of objects) {
    const b = object.body;
    if (!b?.enable || b.checkCollision?.none) continue;
    if (b.checkCollision?.up !== false && Math.abs(b.top - body.bottom - 2) < 4 && b.left <= body.left && b.right >= body.right) {
      clearance = Math.min(clearance, launchSide < 0 ? body.left - b.left - 2 : b.right - body.right - 2);
    }
    if (b.bottom <= body.top - height || b.top >= body.bottom) continue;
    if (b.right <= body.left) {
      if (launchSide < 0) clearance = Math.min(clearance, body.left - b.right - 4);
    } else if (b.left >= body.right) {
      if (launchSide > 0) clearance = Math.min(clearance, b.left - body.right - 4);
    }
    else clearance = 0;
  }
  return Math.max(0, clearance);
}

export function parachuteBreezeVelocity(entry, now, deltaMs) {
  const s = entry.sprite;
  const dt = Math.max(1 / 240, Math.min(0.05, (Number(deltaMs) || 1000 / 60) / 1000));
  const remaining = Math.max(0, entry.target.y - s.y - Math.max(0, s.body.velocity.y) * dt);
  // A gently curved, monotonic glide from the upwind launch point. Its slope
  // eases near the ground without swinging back or teleporting to the target.
  const fraction = Math.min(1, remaining / Math.max(1, entry.dropHeight));
  const desiredX = entry.target.x + entry.launchOffsetX * fraction ** 1.25;
  const direction = -Math.sign(entry.launchOffsetX);
  const velocity = (desiredX - s.x) / dt;
  return direction * Math.max(0, Math.min(24, velocity * direction));
}

export function parachuteTilt(angle, velocityX, deltaMs) {
  const target = Math.max(-12, Math.min(12, velocityX * 0.65));
  const blend = 1 - Math.exp(-Math.max(0, Number(deltaMs) || 1000 / 60) / 180);
  return angle + (target - angle) * blend;
}

// One opening recording avoids multiplying the volume by the roster size.
// Delayed, quieter copies create short echoes through Phaser's normal audio
// manager, so global mute/volume and browser audio locking still apply.
export function parachuteSoundLayers(playerCount) {
  const count = Math.max(1, Math.min(6, Number(playerCount) || 1));
  const taps = Math.ceil(count / 2);
  const layers = [{ loop: false, rate: 1, volume: 0.18, delay: 0 }];
  for (let i = 1; i <= taps; i++) {
    layers.push({ loop: false, rate: 1, volume: 0.18 * (0.22 + count * 0.015) ** i, delay: i * 0.14 });
  }
  return layers;
}

function stopParachuteSound(scene, fade = false) {
  const sounds = scene._parachuteSounds || [];
  if (fade && scene.tweens && sounds.length) {
    if (scene._parachuteSoundFade) return;
    scene._parachuteSoundFade = scene.tweens.add({ targets: sounds, volume: 0, duration: 220,
      onComplete: () => { scene._parachuteSoundFade = null; stopParachuteSound(scene); } });
    return;
  }
  scene._parachuteSoundFade?.stop();
  scene._parachuteSoundFade = null;
  sounds.forEach(sound => sound.destroy());
  scene._parachuteSounds = [];
}

// Intro physics is isolated from gameplay input and remote interpolation.
export function prepareSpawnIntro(scene, sprite, character, skin, remote = false, friendly = !remote) {
  if (!sprite?.body || !sprite._spawnLanding) return;
  const entries = scene._spawnIntroEntries ||= [];
  if (entries.some(e => e.sprite === sprite)) return;
  const entry = { sprite, character, skin, remote, friendly, target: { ...sprite._spawnLanding }, gravity: sprite.body.allowGravity, maxY: sprite.body.maxVelocity.y };
  entries.push(entry);
  sprite.body.moves = false;
  sprite._spawnIntroPending = true;
}

export function startSpawnIntro(scene, positions = {}) {
  if (!scene || scene._spawnIntroStarted) return;
  scene._spawnIntroStarted = true;
  scene._spawnIntroActive = true;
  for (const e of scene._spawnIntroEntries || []) {
    const { sprite, target } = e;
    if (!sprite.active) continue;
    const authoritative = positions[sprite.username];
    if (Number.isFinite(authoritative?.x) && Number.isFinite(authoritative?.y)) Object.assign(target, authoritative);
    sprite.body.reset(target.x, target.y);
    sprite.body.updateFromGameObject();
    let height = target.dropHeight;
    // Never launch inside an overhead ledge. Keep the full body in free space.
    for (const object of scene._mapObjects || []) {
      const b = object.body;
      if (!b?.enable || b.checkCollision?.none || b.checkCollision?.up === false) continue;
      if (b.right <= sprite.body.left || b.left >= sprite.body.right) continue;
      if (b.bottom <= sprite.body.top) height = Math.min(height, Math.max(0, sprite.body.top - b.bottom - 4));
    }
    e.dropHeight = height;
    const seed = Array.from(String(sprite.username || '')).reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 0);
    let launchSide = seed % 2 ? -1 : 1;
    let clearance = parachuteBreezeClearance(sprite.body, scene._mapObjects || [], height, launchSide);
    const otherClearance = parachuteBreezeClearance(sprite.body, scene._mapObjects || [], height, -launchSide);
    if (clearance < 8 && otherClearance > clearance) { launchSide *= -1; clearance = otherClearance; }
    e.launchOffsetX = launchSide * clearance * (0.8 + (seed % 11) / 50);
    e.canopyAngle = 0;
    sprite.body.reset(target.x + e.launchOffsetX, target.y - height);
    sprite.body.moves = true;
    sprite.body.allowGravity = true;
    sprite.body.setMaxVelocity(sprite.body.maxVelocity.x, PARACHUTE_FALL_SPEED);
    if (e.remote) e.colliders = (scene._mapObjects || []).map(o => scene.physics.add.collider(sprite, o));
    const texture = e.friendly ? 'spawn-parachute-blue' : 'spawn-parachute-red';
    // Preserve the slightly different proportions of the two supplied images.
    const width = PARACHUTE_HEIGHT * (e.friendly ? 342 : 329) / 334;
    e.canopy = scene.add.image(sprite.x, sprite.body.top + 8, texture).setOrigin(0.5, 1).setDisplaySize(width, PARACHUTE_HEIGHT).setDepth(sprite.depth + 1);
    e.landed = false;
    e.lastFx = 0;
  }
  const count = (scene._spawnIntroEntries || []).filter(e => e.sprite.active).length;
  scene._parachuteSounds = [];
  if (count && scene.cache?.audio?.exists('sfx-parachute-open')) {
    for (const config of parachuteSoundLayers(count)) {
      try {
        const sound = scene.sound.add('sfx-parachute-open', config);
        scene._parachuteSounds.push(sound);
        sound.play();
      } catch (_) { /* Silent fallback when audio is unavailable. */ }
    }
  }
  const update = () => {
    for (const e of scene._spawnIntroEntries || []) {
      const s = e.sprite;
      if (!s.active || e.landed) continue;
      e.canopyAngle = parachuteTilt(e.canopyAngle, s.body.velocity.x, scene.game?.loop?.delta);
      e.canopy?.setPosition(s.body.center.x, s.body.top + 8).setAngle(e.canopyAngle);
      if (s.body.blocked.down || s.body.touching.down) {
        e.landed = true;
        s.setVelocity(0, 0);
        s.body.moves = false;
        e.canopy?.destroy();
        e.canopy = null;
        spawnSpawnBurst(scene, s, { tint: 0xffffff, accent: 0xb8ecff, depth: 28 });
        s.anims.play(resolveAnimKey(scene, e.character, 'idle', 'idle', e.skin), true);
      } else {
        s.body.velocity.x = parachuteBreezeVelocity(e, scene.time.now, scene.game?.loop?.delta);
        s.anims.play(resolveAnimKey(scene, e.character, 'falling', 'idle', e.skin), true);
        if (scene.time.now - e.lastFx > 140) {
          spawnFastFallTrail(scene, s, { velocityY: s.body.velocity.y });
          e.lastFx = scene.time.now;
        }
      }
    }
    if ((scene._spawnIntroEntries || []).every(e => !e.sprite.active || e.landed)) stopParachuteSound(scene, true);
  };
  scene.events.on('postupdate', update);
  scene._stopSpawnIntroUpdate = () => scene.events.off('postupdate', update);
  scene.events.once('shutdown', () => finishSpawnIntro(scene));
}

export function finishSpawnIntro(scene) {
  if (!scene) return;
  stopParachuteSound(scene);
  scene._stopSpawnIntroUpdate?.();
  for (const e of scene._spawnIntroEntries || []) {
    e.canopy?.destroy();
    e.colliders?.forEach(c => c.destroy());
    if (!e.sprite.active) continue;
    e.sprite.body.velocity.x = 0;
    e.sprite._spawnIntroPending = false;
    e.sprite.body.moves = true;
    e.sprite.body.allowGravity = e.gravity;
    e.sprite.body.setMaxVelocity(e.sprite.body.maxVelocity.x, e.maxY);
  }
  scene._spawnIntroEntries = [];
  scene._spawnIntroActive = false;
}
