import physics from '../shared/movementPhysics.json';
import { dashDirection } from '../shared/dash';

import { sweepMovement } from '../shared/sweptCollision';
import { playPlayerSound } from './playerAudio';

export function playDashSound(scene, remote = false, source = null) {
  // A little pitch movement keeps repeat dashes from sounding identical.
  const options = { volume: 0.7, rate: 0.97 + Math.random() * 0.06 };
  if (remote) playPlayerSound(scene, source, 'sfx-dash', options);
  else scene?.sound?.play?.('sfx-dash', options);
}

// Snapshot IDs persist after the short burst, so even a skipped burst snapshot
// still produces one cue. Missing/older snapshots must not reset the watermark.
export function presentRemoteDash(scene, sprite, state, tracker, hidden = false) {
  const seq = state?.dashSeq;
  if (!Number.isSafeInteger(seq) || seq < 0) return;
  const previous = tracker._lastDashSeq;
  if (previous !== undefined && seq <= previous) return;
  tracker._lastDashSeq = seq;
  // Establish a baseline on join without replaying historical activations.
  const joiningDuringDash = seq > 0 && /^(dash|dashing)$/.test(state.animation || '');
  if ((previous === undefined && !joiningDuringDash) || hidden || !sprite?.active) return;
  if (sprite.visible && sprite.alpha !== 0 && !sprite._powerupInvisible) {
    spawnDashEffect(scene, sprite, state.dashX, state.dashY);
  }
  playDashSound(scene, true, sprite);
}

export function spawnDashEffect(scene, sprite, x, y) {
  if (!sprite?.visible || !scene.add?.image || !scene.add?.graphics || !scene.time) return;
  let previous = { x: sprite.x, y: sprite.y };
  let stopped = false;
  const length = Math.hypot(x, y);
  const ux = Number.isFinite(length) && length > 0 ? x / length : (sprite.flipX ? -1 : 1);
  const uy = Number.isFinite(length) && length > 0 ? y / length : 0;
  const fade = (target, duration, extra = {}) => scene.tweens.add({
    targets: target, alpha: 0, duration, ...extra, onComplete: () => target.destroy(),
  });
  const ghost = () => {
    const image = scene.add.image(sprite.x, sprite.y, sprite.texture.key, sprite.frame.name)
      .setOrigin(sprite.originX, sprite.originY).setScale(sprite.scaleX, sprite.scaleY)
      .setFlipX(sprite.flipX).setTint(0xb9edff).setAlpha(0.32).setDepth(sprite.depth - 1);
    fade(image, 170);
  };
  // A white-hot bow wraps the leading edge, with thinner cyan shoulders
  // sweeping back beside the character, like air flowing around a meteor.
  const burst = scene.add.graphics().setDepth(sprite.depth + 0.1);
  const halfWidth = (sprite.body?.width || 32) / 2;
  const halfHeight = (sprite.body?.height || 48) / 2;
  const nose = Math.abs(ux) * halfWidth + Math.abs(uy) * halfHeight + 14;
  const radius = Math.abs(uy) * halfWidth + Math.abs(ux) * halfHeight + 16;
  const tailLength = 76;
  // Cubic shoulders round the nose, wrap around the body, then converge
  // onto the two rear trail rails instead of flaring away from them.
  const contour = (t, side) => {
    const u = 1 - t;
    return {
      x: u * u * u * nose + 3 * u * u * t * nose - 3 * u * t * t * 24 - t * t * t * tailLength,
      y: side * (3 * u * u * t * radius + 3 * u * t * t * radius * 1.35 + t * t * t * 10),
    };
  };
  for (const [width, color, alpha] of [[17, 0x39caff, 0.32], [8, 0x8bdaff, 0.9], [4, 0xffffff, 1]]) {
    for (const side of [-1, 1]) {
      for (let i = 0; i < 32; i++) {
        const t = (i + 0.5) / 32;
        const from = contour(i / 32, side), to = contour((i + 1) / 32, side);
        const strength = 1 - t * 0.65;
        burst.lineStyle(width * strength, color, alpha * (1 - t * 0.4));
        burst.lineBetween(from.x, from.y, to.x, to.y);
      }
    }
  }
  let heading = Math.atan2(uy, ux);
  let lastHeadX = sprite.x, lastHeadY = sprite.y;
  const followHead = () => {
    if (stopped) return;
    if (!sprite.active || !sprite.visible || sprite.alpha < 0.1) {
      burst.setAlpha(0);
      return;
    }
    const dx = sprite.x - lastHeadX, dy = sprite.y - lastHeadY;
    const distance = Math.hypot(dx, dy);
    if (distance >= 1 && distance <= 180) heading = Math.atan2(dy, dx);
    lastHeadX = sprite.x; lastHeadY = sprite.y;
    const center = sprite.getCenter?.() || sprite;
    burst.setPosition(center.x, center.y).setRotation(heading);
  };
  followHead();
  // Run after interpolation so the leading edge stays attached between stamps.
  scene.events?.on('postupdate', followHead);
  fade(burst, 120, { delay: 100 });
  ghost();
  const stamp = () => {
    if (stopped || !sprite.active || !sprite.visible || sprite.alpha < 0.1) return;
    const dx = sprite.x - previous.x, dy = sprite.y - previous.y;
    const distance = Math.hypot(dx, dy);
    if (distance < 3) return;
    // Do not bridge teleports/respawns with a map-spanning trail.
    if (distance > 180) { previous = { x: sprite.x, y: sprite.y }; return; }
    const tx = dx / distance, ty = dy / distance;
    const trail = scene.add.graphics().setDepth(sprite.depth - 0.1);
    for (let i = -1; i <= 1; i++) {
      const offset = i * 10;
      trail.lineStyle(i ? 3 : 9, 0x39caff, i ? 0.65 : 0.4);
      const rear = i ? tailLength : 0;
      trail.lineBetween(previous.x - tx * rear - ty * offset, previous.y - ty * rear + tx * offset,
        sprite.x - tx * rear - ty * offset, sprite.y - ty * rear + tx * offset);
      if (i) {
        trail.lineStyle(1.5, 0xffffff, 0.55);
        trail.lineBetween(previous.x - tx * rear - ty * offset, previous.y - ty * rear + tx * offset,
          sprite.x - tx * rear - ty * offset, sprite.y - ty * rear + tx * offset);
      }
    }
    trail.lineStyle(3, 0xffffff, 0.95);
    trail.lineBetween(previous.x, previous.y, sprite.x, sprite.y);
    // Bright segmented marks keep the trail readable against busy maps.
    for (let i = 0; i < 8; i++) {
      const t = Math.random(), spread = (Math.random() - 0.5) * 60;
      const px = previous.x + dx * t - ty * spread;
      const py = previous.y + dy * t + tx * spread;
      const size = Math.min(distance, 12 + Math.random() * 24);
      trail.lineStyle(i % 3 ? 2 : 3, i % 3 ? 0x8bdaff : 0xffffff, 0.85);
      trail.lineBetween(px, py, px - tx * size, py - ty * size);
    }
    fade(trail, 240);
    ghost();
    previous = { x: sprite.x, y: sprite.y };
  };
  const timer = scene.time.addEvent({ delay: 24, repeat: 8, callback: stamp });
  const stop = () => {
    if (stopped) return;
    stopped = true;
    timer.remove();
    scene.events?.off('postupdate', followHead);
    scene.tweens.killTweensOf?.(burst);
    burst.destroy();
    sprite.off?.('destroy', stop);
    scene.events?.off('shutdown', stop);
  };
  sprite.once('destroy', stop);
  scene.events?.once('shutdown', stop);
  scene.time.delayedCall(220, stop);
}

// Local screen feedback only; remote dashes keep their world-space trails.
function spawnDashScreenEffect(scene, direction) {
  if (typeof document === 'undefined' || typeof window === 'undefined' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const root = document.createElement('div');
  root.className = 'bb-dash-speed-lines';
  root.setAttribute('aria-hidden', 'true');
  root.style.setProperty('--dash-angle', `${Math.atan2(direction.y, direction.x)}rad`);
  root.style.setProperty('--dash-travel-x', `${-direction.x * 90}px`);
  root.style.setProperty('--dash-travel-y', `${-direction.y * 90}px`);
  // Sparse marks around the perimeter leave the center of combat unobscured.
  for (const [x, y, length, delay] of [[18, 6, 100, 0], [72, 8, 80, 25],
    [90, 30, 96, 10], [88, 76, 76, 35], [28, 91, 90, 15], [10, 62, 84, 30]]) {
    const line = document.createElement('i');
    line.style.left = `${x}%`; line.style.top = `${y}%`;
    line.style.width = `${length}px`; line.style.animationDelay = `${delay}ms`;
    root.appendChild(line);
  }
  (document.fullscreenElement || document.body).appendChild(root);
  const destroy = () => { root.remove(); scene.events?.off('shutdown', destroy); };
  scene.events?.once('shutdown', destroy);
  scene.time.delayedCall(460, destroy);
}

export function endDash(player, coast = true) {
  if (player && !coast) player._dashCoastUntil = 0;
  const dash = player?._dash;
  if (!dash || !player.body) return;
  player.body.allowGravity = dash.allowGravity;
  player.setAcceleration(0, 0);
  player.setDrag(0, 0);
  // Keep the velocity produced by physics, including zero normal velocity on impact.
  player._dashCoastUntil = coast ? Date.now() + physics.dashCoastMs : 0;
  player._dash = null;
}

export function protectDashMotion(scene, player, now = Date.now(), delta = 1 / 60) {
  const body = player?.body;
  if (!body?.enable || (!player._dash && now >= (player._dashCoastUntil || 0))) return;
  const surfaces = (scene._mapObjects || []).map(object => object.body).filter(Boolean);
  const result = sweepMovement({ x: body.prev.x, y: body.prev.y, width: body.width, height: body.height },
    body.newVelocity.x, body.newVelocity.y, surfaces);
  // Arcade has already separated overlaps. Reconstruct this step from its
  // pre-collision displacement, then let the continuous sweep own map contacts.
  // Otherwise a spurious side flag/zeroed X from a fractional landing survives.
  if (delta > 0) {
    body.velocity.x = body.newVelocity.x / delta;
    body.velocity.y = body.newVelocity.y / delta;
  }
  for (const flags of [body.blocked, body.touching]) {
    flags.left = flags.right = flags.up = flags.down = false;
    flags.none = true;
  }
  body.x = result.x; body.y = result.y;
  for (const face of ['left', 'right', 'up', 'down']) {
    if (!result.hits[face]) continue;
    body.blocked[face] = true; body.blocked.none = false;
    body.touching[face] = true; body.touching.none = false;
    if (face === 'left' || face === 'right') body.velocity.x = 0; else body.velocity.y = 0;
  }
  if (body.collideWorldBounds) {
    const bounds = body.world.bounds;
    const x = Math.max(bounds.x, Math.min(bounds.right - body.width, body.x));
    const y = Math.max(bounds.y, Math.min(bounds.bottom - body.height, body.y));
    if (x !== body.x) {
      body.velocity.x = 0;
      result.hits[x < body.x ? 'right' : 'left'] = true;
    }
    if (y !== body.y) {
      body.velocity.y = 0;
      result.hits[y < body.y ? 'down' : 'up'] = true;
    }
    body.x = x; body.y = y;
  }
  // Keep a microscopic gap just like the normal landing separator. This
  // prevents rounded fractional body sizes overlapping a platform next step.
  const clearance = 1e-7;
  if (result.hits.down) body.y -= clearance;
  if (result.hits.up) body.y += clearance;
  if (result.hits.right) body.x -= clearance;
  if (result.hits.left) body.x += clearance;
  body.updateCenter();
  // A zero normal velocity no longer produces swept hits on subsequent steps.
  // Probe actual adjacency instead of retaining contact after leaving an edge.
  let horizontalSurface = false, verticalSurface = false;
  for (const surface of surfaces) {
    if (surface.enable === false || surface.checkCollision?.none) continue;
    const c = surface.checkCollision || {};
    const overlapX = body.right > surface.left + 0.01 && body.left < surface.right - 0.01;
    const overlapY = body.bottom > surface.top + 0.01 && body.top < surface.bottom - 0.01;
    // Retain exact contact flags while sliding with zero normal displacement.
    // Sweeps alone have no new impact to report on these frames.
    const contacts = {
      down: overlapX && c.up !== false && Math.abs(body.bottom - surface.top) < 0.5 && body.velocity.y >= 0,
      up: overlapX && c.down !== false && Math.abs(body.top - surface.bottom) < 0.5 && body.velocity.y <= 0,
      right: overlapY && c.left !== false && Math.abs(body.right - surface.left) < 0.5 && body.velocity.x >= 0,
      left: overlapY && c.right !== false && Math.abs(body.left - surface.right) < 0.5 && body.velocity.x <= 0,
    };
    for (const face of ['left', 'right', 'up', 'down']) if (contacts[face]) {
      body.blocked[face] = true; body.blocked.none = false;
      body.touching[face] = true; body.touching.none = false;
    }
    horizontalSurface ||= overlapX && (
      (c.up !== false && Math.abs(body.bottom - surface.top) < 0.5) ||
      (c.down !== false && Math.abs(body.top - surface.bottom) < 0.5));
    verticalSurface ||= overlapY && (
      (c.left !== false && Math.abs(body.right - surface.left) < 0.5) ||
      (c.right !== false && Math.abs(body.left - surface.right) < 0.5));
  }
  if (body.collideWorldBounds) {
    const bounds = body.world.bounds;
    for (const [face, touching] of Object.entries({
      down: Math.abs(body.bottom - bounds.bottom) < 0.5 && body.velocity.y >= 0,
      up: Math.abs(body.top - bounds.y) < 0.5 && body.velocity.y <= 0,
      right: Math.abs(body.right - bounds.right) < 0.5 && body.velocity.x >= 0,
      left: Math.abs(body.left - bounds.x) < 0.5 && body.velocity.x <= 0,
    })) if (touching) {
      body.blocked[face] = true; body.blocked.none = false;
      body.touching[face] = true; body.touching.none = false;
    }
    horizontalSurface ||= Math.abs(body.bottom - bounds.bottom) < 0.5 || Math.abs(body.top - bounds.y) < 0.5;
    verticalSurface ||= Math.abs(body.right - bounds.right) < 0.5 || Math.abs(body.left - bounds.x) < 0.5;
  }
  const friction = physics.dashSurfaceDrag * Math.max(0, delta);
  const slow = value => Math.sign(value) * Math.max(0, Math.abs(value) - friction);
  // Normal locomotion already supplies horizontal ground drag while coasting.
  if (horizontalSurface && player._dash) body.velocity.x = slow(body.velocity.x);
  if (verticalSurface) {
    // Proportional wall drag cannot erase every small gravity step, unlike
    // constant friction greater than gravity (which pinned Y at zero).
    body.velocity.y *= Math.exp(-physics.dashWallDragRate * Math.max(0, delta));
    if (player._dash) {
      player._dash.wallContact = true;
      body.allowGravity = player._dash.allowGravity;
    }
  }
  // Air resistance is strongest at high speed and fades toward zero near the
  // apex. It cannot stop or reverse velocity; gravity alone turns ascent to fall.
  if (!player._jumpLaunch) {
    const remaining = Math.max(0, Math.min(1,
      ((player._dashCoastUntil || 0) - now) / physics.dashCoastMs));
    const strength = player._dash ? 1 : remaining * remaining;
    body.velocity.y = dampDashVertical(body.velocity.y, delta, strength);
  }
}

export function dampDashVertical(velocity, delta, strength = 1) {
  return velocity / (1 + physics.dashVerticalResistance * Math.abs(velocity) *
    Math.max(0, delta) * Math.max(0, strength));
}

export function applyDashCoast(player, inputDirection, maxSpeed, now = Date.now()) {
  if (now >= (player._dashCoastUntil || 0)) return;
  const vx = player.body.velocity.x;
  if (Math.abs(vx) <= maxSpeed) return;
  player.setMaxVelocity(Math.max(maxSpeed, Math.abs(vx)), Math.max(1000, Math.abs(player.body.velocity.y)));
  if (!inputDirection || Math.sign(vx) === inputDirection) {
    player.setAccelerationX(0);
    player.setDragX((player.body.touching.down || player.body.blocked?.down) ? physics.dashSurfaceDrag : physics.dashCoastDrag);
  }
}

export function updateDash(scene, player, { pressed, left, right, up, down, blocked, showEffect = true, now = Date.now() }) {
  if (blocked) { endDash(player, false); player._dashCoastUntil = 0; return false; }
  let dash = player._dash;
  let launched = false;
  if (dash && now >= dash.until) {
    endDash(player);
    player._dashCoastUntil = now + physics.dashCoastMs;
    dash = null;
  }
  if (pressed && !dash && now >= (player._dashReadyAt || 0)) {
    const direction = dashDirection(left, right, up, down, player.flipX ? -1 : 1);
    const vx = direction.x * physics.dashSpeed;
    const vy = direction.y * (direction.x === 0 && direction.y > 0 ? physics.dashDownSpeed : physics.dashSpeed);
    dash = player._dash = { ...direction, vx, vy, steeredAt: now, until: now + physics.dashDurationMs,
      allowGravity: player.body.allowGravity,
      airborne: !(player.body.touching?.down || player.body.blocked?.down) || vy !== 0 };
    player._dashReadyAt = now + physics.dashDurationMs + physics.dashCooldownMs;
    player._dashSeq = (player._dashSeq || 0) + 1;
    player._dashDirection = direction;
    player._jumpLaunch = null;
    player._duckRequested = false;
    player._duckGroundSpan = null;
    player._wallKickUntil = 0;
    player._wallKickLockUntil = 0;
    launched = true;
    player.setVelocity(vx, vy);
    if (dash.x) player.setFlipX(dash.x < 0);
    playDashSound(scene);
    if (showEffect) {
      spawnDashEffect(scene, player, dash.x, dash.y);
      spawnDashScreenEffect(scene, direction);
    }
  }
  if (!dash) return false;
  player.body.allowGravity = dash.wallContact ? dash.allowGravity : false;
  player.setAcceleration(0, 0);
  player.setDrag(0, 0);
  player.setMaxVelocity(physics.dashMaxSpeed,
    dash.x === 0 && dash.y > 0 ? physics.dashDownSpeed : physics.dashMaxSpeed);
  const inputX = Number(!!right) - Number(!!left);
  const inputY = Number(!!down) - Number(!!up);
  const dt = Math.min(0.05, Math.max(0, now - dash.steeredAt) / 1000);
  dash.steeredAt = now;
  dash.inputX = inputX;
  if (!(player.body.touching?.down || player.body.blocked?.down) || player.body.velocity.y !== 0) dash.airborne = true;
  if (!launched && !dash.airborne && (inputX || inputY)) {
    const length = Math.hypot(inputX, inputY);
    const velocity = player.body.velocity;
    // Rotate existing momentum toward live input. At a standstill, allow normal
    // movement speed so the player can steer away instead of waiting for expiry.
    const speed = Math.min(physics.dashSpeed, Math.max(physics.maxSpeed, Math.hypot(velocity.x, velocity.y)));
    let targetX = inputX / length * speed, targetY = inputY / length * speed;
    const contact = player.body.blocked || {};
    const touching = player.body.touching || {};
    if ((targetX < 0 && (contact.left || touching.left)) ||
        (targetX > 0 && (contact.right || touching.right))) targetX = 0;
    if ((targetY < 0 && (contact.up || touching.up)) ||
        (targetY > 0 && (contact.down || touching.down))) targetY = 0;
    const dx = targetX - velocity.x, dy = targetY - velocity.y;
    const amount = Math.min(1, physics.dashSteerAccel * dt / (Math.hypot(dx, dy) || 1));
    player.setVelocity(velocity.x + dx * amount, velocity.y + dy * amount);
    if (inputX) player.setFlipX(inputX < 0);
  }
  return true;
}

export function drawDashCooldown(scene, player, hidden = false) {
  if (!player) return;
  if (!player._dashHud) {
    const root = document.createElement('div');
    root.className = 'bb-dash-hud';
    root.innerHTML = '<div class="bb-dash-hud__heading"><span>Dash <kbd>SPACE</kbd></span><span data-dash-status>Ready</span></div><div class="bb-dash-hud__track" role="progressbar" aria-label="Dash recharge" aria-valuemin="0" aria-valuemax="100"><div class="bb-dash-hud__fill"></div></div>';
    // Keep this screen-space HUD outside Phaser camera zoom and world scrolling.
    (document.fullscreenElement || document.body).appendChild(root);
    const onFullscreen = () => (document.fullscreenElement || document.body).appendChild(root);
    document.addEventListener('fullscreenchange', onFullscreen);
    const hud = player._dashHud = { root,
      status: root.querySelector('[data-dash-status]'),
      track: root.querySelector('[role="progressbar"]'),
      fill: root.querySelector('.bb-dash-hud__fill'),
      hide: () => { root.hidden = true; },
    };
    const destroy = () => {
      root.remove();
      document.removeEventListener('fullscreenchange', onFullscreen);
      player.off?.('destroy', destroy);
      scene.events.off('shutdown', destroy);
      if (player._dashHud === hud) player._dashHud = null;
    };
    player.once('destroy', destroy);
    scene.events.once('shutdown', destroy);
  }
  const hud = player._dashHud;
  hud.root.hidden = hidden;
  if (hidden) return;
  const now = Date.now();
  const remaining = Math.min(physics.dashCooldownMs, Math.max(0, (player._dashReadyAt || 0) - now));
  if (remaining || player._dash) hud.readySince = null;
  else if (hud.readySince == null) hud.readySince = now;
  hud.root.dataset.idle = String(hud.readySince != null && now - hud.readySince >= 6000);
  // Integrate the changing pulse rate so speeding up never jumps phase.
  const pulseSeconds = hud.readySince == null ? 0 : Math.max(0, (now - hud.readySince - 6000) / 1000);
  const rampSeconds = Math.min(12, pulseSeconds);
  const strength = 0.15 + 0.85 * rampSeconds / 12;
  const cycles = rampSeconds / 3 + rampSeconds * rampSeconds / 48 + Math.max(0, pulseSeconds - 12) / 1.2;
  const wave = (1 - Math.cos(cycles * Math.PI * 2)) / 2;
  hud.root.dataset.halo = String(pulseSeconds >= 6);
  const haloFade = Math.min(1, Math.max(0, (pulseSeconds - 6) / 2));
  hud.root.style.setProperty('--dash-pulse-opacity', String(haloFade * strength * (0.2 + 0.8 * wave) * 0.85));
  hud.root.style.setProperty('--dash-pulse-glow', `${4 + 15 * strength * wave}px`);
  hud.root.style.setProperty('--dash-pulse-content-opacity', String(Math.min(1, 0.85 - 0.2 * strength + 0.35 * strength * wave)));
  hud.root.style.setProperty('--dash-pulse-brightness', String(1 + 0.6 * strength * wave));
  const dashing = !!player._dash;
  const progress = dashing
    ? Math.max(0, Math.min(1, (player._dash.until - now) / physics.dashDurationMs))
    : 1 - remaining / physics.dashCooldownMs;
  const label = dashing ? 'Dash!' : remaining ? `${(Math.ceil(remaining / 100) / 10).toFixed(1)}s` : 'Ready';
  if (hud.status.textContent !== label) hud.status.textContent = label;
  hud.root.dataset.ready = String(!dashing && remaining === 0);
  hud.root.dataset.dashing = String(!!player._dash);
  hud.track.setAttribute('aria-valuenow', Math.round(progress * 100));
  hud.track.setAttribute('aria-valuetext', dashing ? 'Dashing' : remaining ? `${label} remaining` : 'Dash ready');
  hud.fill.style.transform = `scaleX(${progress})`;
}
