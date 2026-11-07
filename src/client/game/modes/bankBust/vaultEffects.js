// Everything a vault does on screen besides being drawn: how it reacts to a
// hit, how it looks as it empties, and the bust itself. All of it is local
// decoration driven by the coin numbers in the snapshot, so nothing here can
// affect the match, and it never reads the server's clock.

import { COIN_FRAME_SIZE, COIN_SPIN_FRAMES, coinSpinFrame } from "./coinMotion.mjs";

const COIN_TEXTURE = "coin-spin";
const PIXEL_TEXTURE = "bb-vault-fx-pixel";
export const PUFF_TEXTURE = "bb-vault-fx-puff";
const RAY_TEXTURE = "bb-vault-fx-ray";
const TWINKLE_TEXTURE = "bb-vault-fx-twinkle";

// Where the round door sits in the 216x224 vault artwork, as fractions of the
// frame so it follows whatever size the map gives the vault. The centre is
// VAULT_DOOR_Y in scripts/art/bake-iron-junction.cjs; move both together.
const DOOR = { x: 109 / 216, y: 106 / 224, radius: 80 / 216, wheelRadius: 41 / 216 };

const GOLD = 0xffd264;
const HOT = 0xfff3c4;
const STEEL = [0x3d4f73, 0x56688f, 0x1f2a44];

const GRAVITY = 1500;
const COIN_SIZE = 30;
const COIN_BOUNCE = 0.42;
const COIN_REST_SPEED = 90;
// Every coin is a live sprite stepped by hand, so a long fight has a ceiling.
// Past it the oldest coin already lying on the floor makes way for a new one.
const MAX_LOOSE_COINS = 260;

// A hit whitens the whole vault only when it is a big one, and not more often
// than this: a fast attacker would otherwise make it strobe.
const HIT_FLASH_MIN_STRENGTH = 0.55;
const HIT_FLASH_GAP_MS = 220;
const HIT_BLOOM_CAP = 0.3;

const POP_NUMBER_IN_MS = 170;
const POP_NUMBER_HOLD_MS = 340;
const POP_NUMBER_OUT_MS = 620;
const POP_NUMBER_RISE_PX = 54;
const POP_NUMBER_MERGE_MS = 160;

const BUST_WINDUP_MS = 220;

// A standing vault starts smoking once it has lost this share of its coins,
// and the smoke thickens from there until it is about to break.
const SMOKE_START_WEAR = 0.2;
const SMOKE_SLOWEST_MS = 900;
const SMOKE_FASTEST_MS = 110;
const BUST_BLAST_COINS = 80;
const BUST_GUSH_MS = 2800;
const BUST_GUSH_INTERVAL_MS = 40;

function between(min, max) {
  return min + Math.random() * (max - min);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function mixColour(from, to, t) {
  const channel = (shift) =>
    Math.round(lerp((from >> shift) & 0xff, (to >> shift) & 0xff, t)) << shift;
  return channel(16) | channel(8) | channel(0);
}

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// Everything a hit does scales from zero up to a hit this big, about the
// hardest super in the game. Ordinary attacks (200-500) sit low on that range
// on purpose: they land constantly, so they have to stay a small reaction.
const FULL_HIT_DAMAGE = 1500;
const COINS_PER_DAMAGE = 3 / 200;
const MAX_COINS_PER_HIT = 22;

/** How hard a hit lands on that scale, 0 to 1. */
export function hitStrength(coinsLost) {
  const lost = Math.max(0, Number(coinsLost) || 0);
  return Math.min(1, Math.pow(lost / FULL_HIT_DAMAGE, 0.85));
}

/** Coins knocked out by a hit: one for a tap, a real spray only for a big one. */
export function coinsForHit(coinsLost) {
  const lost = Math.max(0, Number(coinsLost) || 0);
  return Math.min(MAX_COINS_PER_HIT, Math.max(1, Math.round(lost * COINS_PER_DAMAGE)));
}

/**
 * One step of a loose object falling under gravity. Floors are one-way tops
 * like the map's platforms: it passes up through them and lands coming down.
 */
export function stepLoose(body, dt, floors) {
  if (body.resting) return;
  const previousBottom = body.y + body.radius;
  body.vy += GRAVITY * dt;
  body.x += body.vx * dt;
  body.y += body.vy * dt;
  body.phase += body.spin * dt;
  if (body.vy <= 0) return;
  const bottom = body.y + body.radius;
  let landed = null;
  for (const floor of floors) {
    if (body.x < floor.left || body.x > floor.right) continue;
    if (previousBottom > floor.top || bottom < floor.top) continue;
    if (!landed || floor.top < landed.top) landed = floor;
  }
  if (!landed) return;
  body.y = landed.top - body.radius;
  if (body.vy < COIN_REST_SPEED) {
    body.vx = 0;
    body.vy = 0;
    body.spin = 0;
    body.resting = true;
    return;
  }
  body.vy *= -COIN_BOUNCE;
  body.vx *= 0.7;
  body.spin *= 0.65;
}

export function createVaultEffects({
  scene,
  Phaser,
  layers,
  reducedMotion = false,
  getFloors = () => [],
  getMapCentreX = () => Infinity,
  playSfx = () => {},
  focusCamera = () => {},
} = {}) {
  const vaults = new Map();
  const looseCoins = [];
  const looseDebris = [];
  const popLabels = [];
  const lingering = new Set();
  let delta = 1 / 60;
  let lastHitSfxAt = -Infinity;
  let destroyed = false;

  const COIN_DEPTH = layers.POWERUPS + 1;
  const BLAST_DEPTH = layers.SCENERY_FRONT + 1;
  const SPARK_DEPTH = layers.ATTACKS;
  const WHEEL_DEPTH = layers.GAME_OBJECTS + 2;

  function now() {
    return Number(scene.time?.now) || 0;
  }

  function vaultState(team) {
    let vault = vaults.get(team);
    if (!vault) {
      vault = {
        wheel: null,
        wheelKey: null,
        wheelAngle: 0,
        wheelSpeed: 0,
        squash: 0,
        squashSpeed: 0,
        shake: 0,
        shakeClock: Math.random() * 10,
        flashUntil: -Infinity,
        bloom: 0,
        lastPop: null,
        lastDepositAt: -Infinity,
        windupUntil: 0,
        busted: false,
        doorPiece: null,
        nextAmbientAt: 0,
        nextSmokeAt: 0,
        nextCoinDripAt: 0,
      };
      vaults.set(team, vault);
    }
    return vault;
  }

  function doorPoint(vault) {
    return {
      x: Number(vault.x) - vault.width / 2 + vault.width * DOOR.x,
      y: Number(vault.y) - vault.height / 2 + vault.height * DOOR.y,
      radius: vault.width * DOOR.radius,
    };
  }

  function onCamera(x, y, margin = 200) {
    const view = scene.cameras?.main?.worldView;
    if (!view) return true;
    return (
      x > view.x - margin &&
      x < view.right + margin &&
      y > view.y - margin &&
      y < view.bottom + margin
    );
  }

  function shakeCamera(x, y, duration, strength) {
    try {
      // A vault out of frame is only felt faintly: it is somebody else's fight.
      scene.cameras?.main?.shake?.(duration, onCamera(x, y, 0) ? strength : strength * 0.3);
    } catch (_) {}
  }

  // -- Generated textures --------------------------------------------------

  function drawTexture(key, width, height, paint) {
    if (scene.textures?.exists?.(key)) return true;
    try {
      const texture = scene.textures.createCanvas(key, width, height);
      paint(texture.getContext());
      texture.refresh();
      return true;
    } catch (_) {
      return false;
    }
  }

  function ensureBaseTextures() {
    drawTexture(PIXEL_TEXTURE, 4, 4, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 4, 4);
    });
    drawTexture(PUFF_TEXTURE, 48, 48, (ctx) => {
      const gradient = ctx.createRadialGradient(24, 24, 2, 24, 24, 24);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(0.6, "rgba(255,255,255,0.55)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 48, 48);
    });
    // Drawn pointing up from its bottom edge, so it rotates about the door.
    drawTexture(RAY_TEXTURE, 80, 512, (ctx) => {
      const gradient = ctx.createLinearGradient(0, 512, 0, 0);
      gradient.addColorStop(0, "rgba(255,255,255,1)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.moveTo(40, 512);
      ctx.lineTo(0, 0);
      ctx.lineTo(80, 0);
      ctx.closePath();
      ctx.fill();
    });
    drawTexture(TWINKLE_TEXTURE, 15, 15, (ctx) => {
      ctx.fillStyle = "#fff";
      ctx.fillRect(7, 0, 1, 15);
      ctx.fillRect(0, 7, 15, 1);
      ctx.fillRect(6, 4, 3, 7);
      ctx.fillRect(4, 6, 7, 3);
    });
  }

  // A round piece lifted out of a vault frame, so the wheel can turn and the
  // door can come off without any extra artwork to keep in step with the frames.
  function cutFromFrame(stateKey, name, radiusFraction) {
    const key = `bb-vault-${name}-${stateKey}`;
    const frame = `bank-bust-vault-${stateKey}`;
    if (scene.textures?.exists?.(key)) return key;
    if (!scene.textures?.exists?.(frame)) return null;
    const source = scene.textures.get(frame)?.getSourceImage?.();
    const width = Number(source?.width) || 0;
    const height = Number(source?.height) || 0;
    if (!width || !height) return null;
    const radius = Math.ceil(width * radiusFraction);
    const painted = drawTexture(key, radius * 2, radius * 2, (ctx) => {
      ctx.imageSmoothingEnabled = false;
      ctx.beginPath();
      ctx.arc(radius, radius, radius, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(source, radius - width * DOOR.x, radius - height * DOOR.y);
    });
    return painted ? key : null;
  }

  function hasTexture(key) {
    return !!scene.textures?.exists?.(key);
  }

  // -- Short-lived pieces --------------------------------------------------

  function fade(target, props, onDone) {
    lingering.add(target);
    scene.tweens.add({
      targets: target,
      ...props,
      onComplete: () => {
        lingering.delete(target);
        try {
          target.destroy();
        } catch (_) {}
        onDone?.();
      },
    });
  }

  function sparks(x, y, count, { speed = [160, 460], colors = [GOLD, HOT], life = [180, 420], spread = Math.PI * 2, direction = -Math.PI / 2 } = {}) {
    if (!hasTexture(PIXEL_TEXTURE)) return;
    for (let i = 0; i < count; i++) {
      const angle = direction + (Math.random() - 0.5) * spread;
      const distance = between(speed[0], speed[1]) * 0.4;
      const spark = scene.add.image(x, y, PIXEL_TEXTURE);
      spark.setDepth(SPARK_DEPTH);
      spark.setTint(pick(colors));
      spark.setScale(between(0.75, 1.6));
      spark.setBlendMode(Phaser.BlendModes.ADD);
      fade(spark, {
        x: x + Math.cos(angle) * distance,
        y: y + Math.sin(angle) * distance + 14,
        alpha: 0,
        scale: 0.3,
        duration: between(life[0], life[1]),
        ease: "Cubic.easeOut",
      });
    }
  }

  function smoke(x, y, { scale = 1, rise = 90, tint = 0x4b5563, alpha = 0.45, life = 900, depth = layers.GAME_OBJECTS + 3 } = {}) {
    if (!hasTexture(PUFF_TEXTURE)) return;
    const puff = scene.add.image(x, y, PUFF_TEXTURE);
    puff.setDepth(depth);
    puff.setTint(tint);
    puff.setAlpha(alpha);
    puff.setScale(scale * 0.5);
    fade(puff, {
      x: x + between(-24, 24),
      y: y - rise,
      scale: scale * 1.7,
      alpha: 0,
      duration: life * between(0.8, 1.2),
      ease: "Sine.easeOut",
    });
  }

  function twinkle(x, y, scale = 1) {
    if (!hasTexture(TWINKLE_TEXTURE)) return;
    const star = scene.add.image(x, y, TWINKLE_TEXTURE);
    star.setDepth(layers.GAME_OBJECTS + 3);
    star.setTint(HOT);
    star.setBlendMode(Phaser.BlendModes.ADD);
    star.setScale(0);
    fade(star, {
      scale: { from: 0, to: 1.5 * scale },
      alpha: { from: 1, to: 0 },
      angle: 45,
      duration: 420,
      ease: "Sine.easeInOut",
    });
  }

  function ring(x, y, radius, { color = GOLD, width = 4, duration = 480, delay = 0, depth = SPARK_DEPTH } = {}) {
    const shape = scene.add.circle(x, y, 8, 0x000000, 0);
    shape.setStrokeStyle(width, color, 0.95);
    shape.setDepth(depth);
    fade(shape, { radius, alpha: 0, duration, delay, ease: "Cubic.easeOut" });
  }

  function flash(x, y, radius, { color = HOT, alpha = 0.9, duration = 260 } = {}) {
    const shape = scene.add.circle(x, y, radius * 0.25, color, alpha);
    shape.setBlendMode(Phaser.BlendModes.ADD);
    shape.setDepth(SPARK_DEPTH);
    fade(shape, { radius, alpha: 0, duration, ease: "Cubic.easeOut" });
  }

  // The number knocked off, on the same beat as every other floating number in
  // this mode (coinFx's floatText): pop in, hold long enough to read, then rise
  // and fade. A flurry of small hits adds up on one label and holds it there
  // rather than stacking a column of them.
  function playPopNumber(label, baseY, restScale, fromScale) {
    scene.tweens.killTweensOf?.(label);
    label.setPosition(label.x, baseY);
    label.setAlpha(1);
    label.setVisible(true);
    label.setScale(fromScale);
    scene.tweens.add({
      targets: label,
      scale: restScale,
      duration: POP_NUMBER_IN_MS,
      ease: "Back.easeOut",
    });
    scene.tweens.add({
      targets: label,
      y: baseY - POP_NUMBER_RISE_PX,
      alpha: 0,
      delay: POP_NUMBER_HOLD_MS,
      duration: POP_NUMBER_OUT_MS,
      ease: "Quad.easeIn",
      onComplete: () => label.setVisible(false),
    });
  }

  function popNumber(vaultFx, x, y, coinsLost, strength) {
    const time = now();
    const previous = vaultFx.lastPop;
    if (previous?.label?.visible && time - previous.at < POP_NUMBER_MERGE_MS) {
      previous.amount += coinsLost;
      previous.at = time;
      previous.label.setText(`-${Math.round(previous.amount).toLocaleString("en-US")}`);
      const restScale = 1 + 0.6 * hitStrength(previous.amount);
      playPopNumber(previous.label, previous.baseY, restScale, restScale * 1.15);
      return;
    }
    let label = popLabels.find((entry) => !entry.visible);
    if (!label) {
      if (popLabels.length >= 8) return;
      label = scene.add.text(0, 0, "", {
        fontFamily: "'Press Start 2P', monospace",
        fontSize: "13px",
        color: "#ff9d9d",
        stroke: "#1a1006",
        strokeThickness: 5,
      });
      label.setOrigin(0.5);
      label.setDepth(layers.PLAYER_HUD + 1);
      popLabels.push(label);
    }
    const restScale = 1 + 0.6 * strength;
    const baseY = y - 20;
    label.setText(`-${Math.round(coinsLost).toLocaleString("en-US")}`);
    label.setPosition(x + between(-30, 30), baseY);
    playPopNumber(label, baseY, restScale, restScale * 0.4);
    vaultFx.lastPop = { label, amount: coinsLost, at: time, baseY };
  }

  // -- Loose coins and debris ----------------------------------------------

  function coinScale() {
    return COIN_SIZE / COIN_FRAME_SIZE;
  }

  function releaseCoin(index) {
    const [coin] = looseCoins.splice(index, 1);
    try {
      coin.sprite.destroy();
    } catch (_) {}
  }

  function throwCoin(x, y, vx, vy, { size = 1, restMs = 900, depth = COIN_DEPTH } = {}) {
    if (reducedMotion || !hasTexture(COIN_TEXTURE)) return;
    if (looseCoins.length >= MAX_LOOSE_COINS) {
      const oldest = looseCoins.findIndex((coin) => coin.resting);
      if (oldest < 0) return;
      releaseCoin(oldest);
    }
    const scale = coinScale() * size;
    const sprite = scene.add.image(x, y, COIN_TEXTURE);
    sprite.setDepth(depth);
    sprite.setScale(scale);
    looseCoins.push({
      sprite,
      x,
      y,
      vx,
      vy,
      scale,
      radius: (COIN_SIZE * size) / 2,
      phase: Math.random() * Math.PI,
      spin: between(5, 10) * (Math.random() < 0.5 ? -1 : 1),
      resting: false,
      restMs,
      airMs: 0,
    });
  }

  function throwDebris(textureKey, x, y, vx, vy, { tint = null, scale = 1, radius = 8, restMs = 1400, spin = between(-9, 9), depth = BLAST_DEPTH, keep = false, displayWidth = 0 } = {}) {
    if (reducedMotion || !hasTexture(textureKey)) return null;
    const sprite = scene.add.image(x, y, textureKey);
    sprite.setDepth(depth);
    if (displayWidth) sprite.setDisplaySize(displayWidth, displayWidth);
    else sprite.setScale(scale);
    if (tint !== null) sprite.setTint(tint);
    const body = { sprite, x, y, vx, vy, radius, phase: 0, spin, resting: false, restMs, keep };
    looseDebris.push(body);
    return body;
  }

  function stepLooseObjects() {
    const floors = getFloors() || [];
    const ms = delta * 1000;
    for (let i = looseCoins.length - 1; i >= 0; i--) {
      const coin = looseCoins[i];
      stepLoose(coin, delta, floors);
      if (coin.resting) {
        coin.restMs -= ms;
        if (coin.restMs <= 0) {
          releaseCoin(i);
          continue;
        }
        coin.sprite.setPosition(coin.x, coin.y);
        // Turns on until it faces front, so none is left as an edge-on sliver.
        if (coinSpinFrame(coin.phase) % (COIN_SPIN_FRAMES / 2) !== 0) coin.phase += 10 * delta;
        coin.sprite.setFrame(coinSpinFrame(coin.phase));
        coin.sprite.setAlpha(Math.min(1, coin.restMs / 400));
        continue;
      }
      coin.sprite.setPosition(coin.x, coin.y);
      // Spinning through its turn: the flip is what makes a small coin read as one.
      coin.sprite.setFrame(coinSpinFrame(coin.phase));
      // One that missed every platform is falling out of the map.
      coin.airMs += ms;
      if (coin.airMs > 6000) releaseCoin(i);
    }
    for (let i = looseDebris.length - 1; i >= 0; i--) {
      const piece = looseDebris[i];
      stepLoose(piece, delta, floors);
      piece.sprite.setPosition(piece.x, piece.y);
      piece.sprite.setRotation(piece.phase);
      if (!piece.resting || piece.keep) continue;
      piece.restMs -= ms;
      piece.sprite.setAlpha(Math.min(1, piece.restMs / 400));
      if (piece.restMs <= 0) {
        looseDebris.splice(i, 1);
        try {
          piece.sprite.destroy();
        } catch (_) {}
      }
    }
  }

  // -- What a vault does ---------------------------------------------------

  /** A hit: the vault takes the blow and coins fly away from whoever landed it. */
  function hit(team, vault, coinsLost, attacker = null) {
    const lost = Math.max(0, Number(coinsLost) || 0);
    if (!lost) return;
    const vaultFx = vaultState(team);
    if (vaultFx.busted) return;
    const strength = hitStrength(lost);
    const door = doorPoint(vault);
    const time = now();
    if (time - lastHitSfxAt > 70) {
      lastHitSfxAt = time;
      playSfx("sfx-coin-pickup", {
        volume: 0.05 + 0.13 * strength,
        rate: between(0.85, 1.3),
      });
    }
    if (reducedMotion) return;

    if (strength >= HIT_FLASH_MIN_STRENGTH && time - vaultFx.flashUntil > HIT_FLASH_GAP_MS) {
      vaultFx.flashUntil = time + 55;
    }
    // Squared, so the wiggle stays a tremble until a hit is genuinely heavy.
    vaultFx.shake = Math.max(vaultFx.shake, 0.5 + 10 * strength * strength);
    vaultFx.squashSpeed = Math.max(-4, vaultFx.squashSpeed - (0.15 + 2.6 * strength));
    // A soft pulse in proportion to the hit. Capped, because hits land constantly
    // and a run of them would otherwise build up into a bright glow.
    vaultFx.bloom = Math.max(
      vaultFx.bloom,
      Math.min(HIT_BLOOM_CAP, vaultFx.bloom + 0.03 + 0.18 * strength),
    );
    const spinWay = attacker && Number(attacker.x) > door.x ? -1 : 1;
    vaultFx.wheelSpeed += spinWay * (1.5 + 18 * strength);

    const lean = attacker
      ? Math.max(-1, Math.min(1, (door.x - Number(attacker.x)) / 240)) * 0.6
      : 0;
    const speedScale = 0.45 + 0.75 * strength;
    const spread = 0.8 + 0.8 * strength;
    const count = coinsForHit(lost);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + lean + (Math.random() - 0.5) * spread;
      const speed = between(280, 620) * speedScale;
      throwCoin(
        door.x + between(-22, 22),
        door.y + between(-22, 22),
        Math.cos(angle) * speed,
        Math.sin(angle) * speed,
        { size: between(0.6, 0.85) + 0.35 * strength, restMs: 350 + 750 * strength },
      );
    }
    sparks(door.x, door.y, Math.round(1 + 12 * strength), {
      direction: -Math.PI / 2 + lean,
      spread: 3.6,
    });
    flash(door.x, door.y, door.radius * (0.3 + 0.5 * strength), {
      alpha: 0.06 + 0.3 * strength,
      duration: 140,
    });
    if (strength > 0.55) {
      ring(door.x, door.y, door.radius * (1 + strength * 0.8), { width: 3, duration: 300 });
    }
    popNumber(vaultFx, door.x, door.y - door.radius * 0.5, lost, strength);
  }

  /** Coins going in: the vault gulps them and glints. */
  function deposit(team, vault) {
    if (reducedMotion) return;
    const vaultFx = vaultState(team);
    const time = now();
    if (vaultFx.busted || time - vaultFx.lastDepositAt < 180) return;
    vaultFx.lastDepositAt = time;
    // Timed for the flying coins arriving, not for them setting off.
    scene.time.delayedCall(420, () => {
      if (destroyed || vaultFx.busted) return;
      const door = doorPoint(vault);
      vaultFx.squashSpeed += 2.4;
      vaultFx.bloom = Math.min(1, vaultFx.bloom + 0.4);
      vaultFx.wheelSpeed += 5;
      ring(door.x, door.y, door.radius * 1.15, { color: GOLD, width: 3, duration: 340, depth: layers.GAME_OBJECTS + 3 });
      for (let i = 0; i < 3; i++) {
        const angle = Math.random() * Math.PI * 2;
        twinkle(door.x + Math.cos(angle) * door.radius, door.y + Math.sin(angle) * door.radius, 1.2);
      }
    });
  }

  /** The vault changing frame: cracking open, or patched back up with coins. */
  function conditionChanged(team, vault, previous, next) {
    if (reducedMotion || next === "breached") return;
    const vaultFx = vaultState(team);
    const door = doorPoint(vault);
    if (next === "intact") {
      vaultFx.squashSpeed += 3;
      ring(door.x, door.y, door.radius * 1.5, { color: HOT, duration: 420 });
      for (let i = 0; i < 6; i++) {
        const angle = (i / 6) * Math.PI * 2;
        twinkle(door.x + Math.cos(angle) * door.radius, door.y + Math.sin(angle) * door.radius, 1.4);
      }
      return;
    }
    vaultFx.flashUntil = now() + 90;
    vaultFx.shake = 12;
    vaultFx.squashSpeed -= 4;
    vaultFx.wheelSpeed += 30;
    flash(door.x, door.y, door.radius * 1.5, { alpha: 0.8, duration: 240 });
    ring(door.x, door.y, door.radius * 2.2, { duration: 420 });
    throwChunks(door, 10, 520);
    for (let i = 0; i < 24; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.8;
      const speed = between(420, 900);
      throwCoin(door.x, door.y, Math.cos(angle) * speed, Math.sin(angle) * speed, { depth: BLAST_DEPTH });
    }
    for (let i = 0; i < 5; i++) {
      smoke(door.x + between(-40, 40), door.y + between(-40, 40), { scale: 1.2 });
    }
    shakeCamera(door.x, door.y, 180, 0.004);
  }

  function throwChunks(door, count, speed) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const launch = between(speed * 0.45, speed);
      throwDebris(
        PIXEL_TEXTURE,
        door.x + Math.cos(angle) * door.radius * 0.7,
        door.y + Math.sin(angle) * door.radius * 0.7,
        Math.cos(angle) * launch,
        Math.sin(angle) * launch - 260,
        { tint: pick(STEEL), scale: between(2, 5), radius: 6 },
      );
    }
  }

  /**
   * The bust: the vault strains for a moment, the door is blown off its hinges
   * and every coin in it erupts, first as a blast and then as a gush that takes
   * a few seconds to run dry.
   */
  function bust(team, vault) {
    const vaultFx = vaultState(team);
    if (vaultFx.busted) return;
    vaultFx.busted = true;
    vaultFx.wheelSpeed = 40;
    playSfx("sfx-bankbust-wall-claim", { volume: 0.5, rate: 0.6 });
    if (reducedMotion) return;
    const door = doorPoint(vault);
    focusCamera(door.x, door.y);
    vaultFx.windupUntil = now() + BUST_WINDUP_MS;
    sparks(door.x, door.y, 20, { speed: [300, 700] });
    scene.time.delayedCall(BUST_WINDUP_MS, () => {
      if (!destroyed) detonate(vaultFx, vault, door);
    });
  }

  function detonate(vaultFx, vault, door) {
    // The frame is already showing the breached door by this point; what comes
    // off is the door it was showing a moment ago.
    const doorTexture = cutFromFrame(vaultFx.frameBeforeBust || "intact", "door", DOOR.radius);
    vaultFx.windupUntil = 0;
    vaultFx.shake = 22;
    vaultFx.squash = 0.14;
    vaultFx.squashSpeed = -3;
    vaultFx.bloom = 1;
    vaultFx.flashUntil = now() + 110;

    playSfx("sfx-bankbust-turret-shoot", { volume: 0.7, rate: 0.5 });
    playSfx("sfx-bankbust-wall-claim", { volume: 0.7, rate: 0.45 });
    for (let i = 0; i < 16; i++) {
      scene.time.delayedCall(i * 95 + between(0, 70), () => {
        if (!destroyed) playSfx("sfx-coin-pickup", { volume: 0.09, rate: between(0.7, 1.5) });
      });
    }
    shakeCamera(door.x, door.y, 560, 0.016);

    flash(door.x, door.y, vault.width * 2.2, { alpha: 1, duration: 420 });
    flash(door.x, door.y, vault.width * 1.1, { color: 0xffffff, alpha: 1, duration: 200 });
    ring(door.x, door.y, 340, { color: HOT, width: 8, duration: 560 });
    ring(door.x, door.y, 480, { color: GOLD, width: 5, duration: 720, delay: 70 });
    ring(door.x, door.y, 640, { color: GOLD, width: 3, duration: 900, delay: 150 });
    throwRays(door);

    // The door itself, the biggest single thing in the blast. It lands and
    // stays where it fell for the rest of the match.
    const side = door.x < getMapCentreX() ? 1 : -1;
    if (doorTexture) {
      throwDebris(doorTexture, door.x, door.y, side * between(380, 520), -between(620, 760), {
        radius: door.radius * 0.28,
        spin: side * between(9, 13),
        displayWidth: door.radius * 2,
        keep: true,
        depth: BLAST_DEPTH,
      });
    }
    throwChunks(door, 22, 900);
    sparks(door.x, door.y, 70, { speed: [500, 1500], life: [300, 800] });
    for (let i = 0; i < 16; i++) {
      smoke(door.x + between(-70, 70), door.y + between(-70, 70), {
        scale: between(1.6, 3),
        rise: between(120, 280),
        alpha: 0.6,
        life: 1500,
        depth: BLAST_DEPTH,
        tint: pick([0x4b5563, 0x6b7280, 0x374151]),
      });
    }

    for (let i = 0; i < BUST_BLAST_COINS; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.7;
      const speed = between(500, 1500);
      throwCoin(door.x + between(-30, 30), door.y + between(-30, 30), Math.cos(angle) * speed, Math.sin(angle) * speed, {
        size: between(0.8, 1.35),
        restMs: between(4500, 9000),
        depth: BLAST_DEPTH,
      });
    }

    // The gush that follows: a tight, high column that slackens into a dribble.
    const gushStart = now();
    const ticks = Math.floor(BUST_GUSH_MS / BUST_GUSH_INTERVAL_MS);
    scene.time.addEvent({
      delay: BUST_GUSH_INTERVAL_MS,
      repeat: ticks - 1,
      callback: () => {
        if (destroyed) return;
        const spent = Math.min(1, (now() - gushStart) / BUST_GUSH_MS);
        const force = Math.max(0, 1 - spent);
        const spread = 0.32 + 0.95 * spent;
        for (let i = 0; i < 2; i++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * spread;
          const speed = between(0.8, 1.1) * (340 + 980 * force);
          throwCoin(door.x + between(-20, 20), door.y + between(-14, 14), Math.cos(angle) * speed, Math.sin(angle) * speed, {
            size: between(0.75, 1.25),
            restMs: between(3500, 8000),
            depth: BLAST_DEPTH,
          });
        }
      },
    });

    // Above the fighters, so whoever is standing on the vault can see it too.
    const banner = scene.add.text(door.x, vault.y - vault.height / 2 - 62, "BUSTED!", {
      fontFamily: "'Press Start 2P', monospace",
      fontSize: "34px",
      color: "#ffd264",
      stroke: "#0b1220",
      strokeThickness: 8,
    });
    banner.setOrigin(0.5);
    banner.setDepth(layers.PLAYER_HUD + 1);
    lingering.add(banner);
    banner.setScale(3.2);
    banner.setAlpha(0);
    scene.tweens.add({ targets: banner, scale: 1, alpha: 1, duration: 260, ease: "Back.easeOut" });
  }

  function throwRays(door) {
    if (!hasTexture(RAY_TEXTURE)) return;
    for (let i = 0; i < 11; i++) {
      const ray = scene.add.image(door.x, door.y, RAY_TEXTURE);
      ray.setOrigin(0.5, 1);
      ray.setDepth(layers.GAME_OBJECTS + 3);
      ray.setBlendMode(Phaser.BlendModes.ADD);
      ray.setTint(pick([GOLD, HOT]));
      // A fan up and out of the door: the vault stands on solid floor.
      const rotation = ((i / 10) * 2 - 1) * 1.95 + between(-0.12, 0.12);
      ray.setRotation(rotation);
      ray.setAlpha(0.75);
      ray.setScale(between(0.6, 1.1), 0.1);
      fade(ray, {
        rotation: rotation + between(0.25, 0.6),
        scaleY: between(1, 1.7),
        alpha: 0,
        duration: between(1100, 1900),
        ease: "Cubic.easeOut",
      });
    }
  }

  // Smoke, sparks and glints that say how the vault is doing at a glance. They
  // only run for vaults on camera: nobody sees the rest. The smoke is the
  // health reading: it gets thicker, darker and faster as the coins run out.
  function ambient(vault, vaultFx, { low, stateKey, health }) {
    if (reducedMotion) return;
    const door = doorPoint(vault);
    if (!onCamera(door.x, door.y)) return;
    const time = now();
    if (stateKey === "breached") {
      if (time >= vaultFx.nextAmbientAt) {
        vaultFx.nextAmbientAt = time + 170;
        smoke(door.x + between(-34, 34), door.y + between(-16, 34), { scale: between(1.1, 1.9), rise: 190, alpha: 0.42, life: 1500 });
        if (Math.random() < 0.5) sparks(door.x + between(-30, 30), door.y + 30, 2, { speed: [80, 220], colors: [0xfb923c, GOLD] });
      }
      return;
    }
    if (time >= vaultFx.nextAmbientAt) {
      const angle = Math.random() * Math.PI * 2;
      if (stateKey === "damaged") {
        vaultFx.nextAmbientAt = time + (low ? 260 : 520);
        sparks(
          door.x + Math.cos(angle) * door.radius * 0.8,
          door.y + Math.sin(angle) * door.radius * 0.8,
          low ? 4 : 2,
          { speed: [120, 320], colors: [0xbfdbfe, HOT] },
        );
      } else {
        vaultFx.nextAmbientAt = time + between(1400, 3000);
        twinkle(
          door.x + Math.cos(angle) * door.radius * between(0.45, 1),
          door.y + Math.sin(angle) * door.radius * between(0.45, 1),
          between(0.9, 1.5),
        );
      }
    }
    const wear = 1 - Math.max(0, Math.min(1, health));
    if (wear > SMOKE_START_WEAR && time >= vaultFx.nextSmokeAt) {
      const thick = (wear - SMOKE_START_WEAR) / (1 - SMOKE_START_WEAR);
      vaultFx.nextSmokeAt = time + lerp(SMOKE_SLOWEST_MS, SMOKE_FASTEST_MS, thick) * between(0.8, 1.2);
      const angle = Math.random() * Math.PI * 2;
      smoke(
        door.x + Math.cos(angle) * door.radius * 0.8,
        door.y + Math.sin(angle) * door.radius * 0.8 - thick * 10,
        {
          scale: lerp(0.6, 1.8, thick),
          rise: lerp(80, 200, thick),
          alpha: lerp(0.2, 0.5, thick),
          tint: mixColour(0x9ca3af, 0x1f2937, thick),
          life: lerp(800, 1500, thick),
        },
      );
    }
    // Nearly empty, it can no longer hold on to what is left.
    if (low && stateKey !== "breached" && time >= vaultFx.nextCoinDripAt) {
      vaultFx.nextCoinDripAt = time + between(300, 750);
      throwCoin(door.x + between(-24, 24), door.y + door.radius * 0.7, between(-70, 70), between(-180, -60), {
        size: between(0.7, 0.95),
        restMs: 700,
      });
    }
  }

  function syncWheel(vaultFx, vault, pose, stateKey) {
    const key = stateKey === "breached" ? null : cutFromFrame(stateKey, "wheel", DOOR.wheelRadius);
    if (!key) {
      vaultFx.wheel?.setVisible?.(false);
      return;
    }
    if (!vaultFx.wheel) {
      vaultFx.wheel = scene.add.image(0, 0, key);
      vaultFx.wheel.setDepth(WHEEL_DEPTH);
      vaultFx.wheelKey = key;
    }
    if (vaultFx.wheelKey !== key) {
      vaultFx.wheel.setTexture(key);
      vaultFx.wheelKey = key;
    }
    const size = vault.width * DOOR.wheelRadius * 2 * pose.scaleX;
    vaultFx.wheel.setPosition(
      pose.x + (DOOR.x - 0.5) * vault.width * pose.scaleX,
      pose.spriteY + (DOOR.y - 0.5) * vault.height * pose.scaleY,
    );
    vaultFx.wheel.setDisplaySize(size, size);
    vaultFx.wheel.setRotation(vaultFx.wheelAngle);
    vaultFx.wheel.setVisible(true);
    if (pose.flash) vaultFx.wheel.setTintFill(0xffffff);
    else vaultFx.wheel.clearTint();
  }

  /**
   * How the vault should be drawn this frame. Called once per vault per frame,
   * after tick(), and it also moves the wheel and runs the ambient effects.
   */
  function pose(team, vault, { low = false, health = 1, stateKey = "intact" } = {}) {
    const vaultFx = vaultState(team);
    const time = now();
    const windingUp = time < vaultFx.windupUntil;

    if (reducedMotion) {
      const still = { x: vault.x, y: vault.y, spriteY: vault.y, scaleX: 1, scaleY: 1, flash: false, hot: false, bloom: 0, labelScale: 1 };
      syncWheel(vaultFx, vault, still, stateKey);
      return still;
    }

    // A spring, so a hit squashes the vault and it wobbles back to its shape.
    const pull = -560 * vaultFx.squash - 20 * vaultFx.squashSpeed;
    vaultFx.squashSpeed += pull * delta;
    vaultFx.squash += vaultFx.squashSpeed * delta;

    let shake = vaultFx.shake;
    // Settled in about 200ms, like the impact on a fighter.
    vaultFx.shake *= Math.exp(-delta * 16);
    if (vaultFx.shake < 0.05) vaultFx.shake = 0;
    vaultFx.bloom *= Math.exp(-delta * (vaultFx.busted ? 1.1 : 3.4));

    // Coasts back to a slow idle turn, and stops turning when nearly empty.
    const idleSpeed = stateKey === "intact" ? 0.35 : low ? 0 : 0.14;
    vaultFx.wheelSpeed += (idleSpeed - vaultFx.wheelSpeed) * Math.min(1, delta * 3.2);
    vaultFx.wheelAngle += vaultFx.wheelSpeed * delta;

    let squash = vaultFx.squash;
    let flashing = time < vaultFx.flashUntil;
    if (windingUp) {
      const progress = 1 - (vaultFx.windupUntil - time) / BUST_WINDUP_MS;
      shake = Math.max(shake, 3 + 13 * progress);
      squash = Math.max(squash, 0.13 * progress);
      flashing = Math.sin(time / 19) > 0.1;
    }

    vaultFx.shakeClock += delta;
    const offsetX = Math.sin(vaultFx.shakeClock * 58) * shake;
    const offsetY = Math.cos(vaultFx.shakeClock * 47) * shake * 0.45;
    const scaleX = 1 + squash;
    const scaleY = 1 + (windingUp ? squash : squash * -0.7);
    const x = vault.x + offsetX;
    const y = vault.y + offsetY;
    // Squash from the plinth, so the vault stays standing on the floor.
    const spriteY = y + (vault.height * (1 - scaleY)) / 2;

    const result = {
      x,
      y,
      spriteY,
      scaleX,
      scaleY,
      flash: flashing,
      hot: flashing || shake > 4,
      bloom: vaultFx.bloom,
      labelScale: 1 + Math.min(0.5, vaultFx.shake * 0.03),
    };
    syncWheel(vaultFx, vault, result, stateKey);
    ambient(vault, vaultFx, { low, stateKey, health });
    return result;
  }

  /** True while the bust is winding up and the old frame should stay on show. */
  function holdingFrame(team, frameShowing) {
    const vaultFx = vaultState(team);
    if (now() < vaultFx.windupUntil) {
      vaultFx.frameBeforeBust = frameShowing;
      return true;
    }
    return false;
  }

  function hide(team) {
    vaults.get(team)?.wheel?.setVisible?.(false);
  }

  function tick(deltaMs) {
    delta = Math.min(0.05, Math.max(0.001, (Number(deltaMs) || 16.67) / 1000));
    stepLooseObjects();
  }

  function destroy() {
    destroyed = true;
    for (const vaultFx of vaults.values()) {
      try {
        vaultFx.wheel?.destroy?.();
      } catch (_) {}
    }
    for (const body of [...looseCoins, ...looseDebris]) {
      try {
        body.sprite.destroy();
      } catch (_) {}
    }
    for (const target of [...lingering, ...popLabels]) {
      try {
        target.destroy();
      } catch (_) {}
    }
    looseCoins.length = 0;
    looseDebris.length = 0;
    popLabels.length = 0;
    lingering.clear();
    vaults.clear();
  }

  ensureBaseTextures();

  return {
    tick,
    pose,
    hit,
    deposit,
    conditionChanged,
    bust,
    holdingFrame,
    hide,
    destroy,
    looseCoinCount: () => looseCoins.length,
  };
}
