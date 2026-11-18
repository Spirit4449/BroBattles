import { RENDER_LAYERS } from "../../scene/renderLayers";
import {
  crateShake,
  crateStage,
  createCrateSpring,
  kickCrate,
  stepCrateSpring,
} from "./coinMotion.mjs";

export function createCenterCrate({
  scene,
  lootFx,
  Phaser,
  shockRing,
  coinFx,
  safePlaySfx,
  reducedMotion,
  formatCoins,
  uiGraphics,
  objectGraphics,
  state,
  destroyContainer,
}) {
  // The crate, once it has been dropped: see ensureCrate.
  let crate = null;

  const CRATE_DROP_MS = 340;

  const CRATE_DROP_HEIGHT = 620;

  const CRATE_WARNING_MS = 5000;

  function ensureCrate() {
    if (crate?.body?.scene) return crate;
    if (!scene.textures?.exists?.("bank-bust-center-crate-intact")) return null;
    // Pivoting on the base keeps the squash and the jolt planted on the floor.
    const body = scene.add.image(-9999, -9999, "bank-bust-center-crate-intact");
    body.setOrigin(0.5, 1);
    body.setDepth(RENDER_LAYERS.GAME_OBJECTS + 1);
    body.setVisible(false);
    const shadow = scene.add.ellipse(-9999, -9999, 132, 16, 0x000000, 0.42);
    shadow.setDepth(RENDER_LAYERS.GAME_OBJECTS);
    shadow.setVisible(false);
    const glow = lootFx.glow(-9999, -9999, 240, 0xffb84a, 0, RENDER_LAYERS.GAME_OBJECTS - 1);
    crate = {
      body,
      shadow,
      glow,
      spring: createCrateSpring(),
      stage: null,
      droppedAt: 0,
      landed: false,
      leaving: false,
      lastHitAt: 0,
      flashUntil: 0,
      barHealth: 1,
      nextCreakAt: 0,
    };
    return crate;
  }

  function hideCrate() {
    crate?.body?.setVisible?.(false);
    crate?.shadow?.setVisible?.(false);
    crate?.glow?.setVisible?.(false);
  }

  function crateFloor(site) {
    return Number(site.y) + (Number(site.height) || 116) / 2;
  }

  function isOnCamera(x, y) {
    const view = scene?.cameras?.main?.worldView;
    return !!view && Phaser.Geom.Rectangle.Contains(view, x, y);
  }

  function landCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    crate.landed = true;
    kickCrate(crate.spring, Math.random() < 0.5 ? -1 : 1, 0.5);
    crate.spring.squashSpeed -= 5;
    shockRing(x, floor, { radius: 170, color: 0xfff3c4, width: 4, duration: 420 });
    for (const side of [-1, 1]) {
      coinFx.debris(x + side * 58, floor - 4, {
        tint: 0x8d8473,
        width: 7,
        height: 7,
        count: 7,
        speed: [90, 260],
        spread: 0.9,
        direction: side < 0 ? -Math.PI * 0.9 : -Math.PI * 0.1,
        life: [0.3, 0.55],
      });
    }
    safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.35 });
    if (!reducedMotion && isOnCamera(x, floor)) {
      try {
        scene.cameras?.main?.shake?.(170, 0.005);
      } catch (_) {}
    }
  }

  // A blow on the crate, from the side the snapshot says it came from.
  function hitCrate(site, hit) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    const side = Math.sign(x - (Number(hit.x) || x)) || (Math.random() < 0.5 ? -1 : 1);
    const maxHealth = Math.max(1, Number(site.maxHealth) || 1);
    // A big hit should look bigger, but a small one still has to register.
    const strength = Phaser.Math.Clamp((Number(hit.damage) || 0) / (maxHealth * 0.16), 0.55, 1.5);
    kickCrate(crate.spring, side, strength);
    crate.flashUntil = scene.time.now + 70;
    const face = x - side * 40;
    const topY = floor - height * 0.72;
    coinFx.debris(face, floor - height * 0.5, {
      tint: 0x4a5a80,
      width: 7,
      height: 3,
      count: 5,
      speed: [140, 320],
      spread: 1.5,
      direction: side > 0 ? -Math.PI * 0.75 : -Math.PI * 0.25,
      floorY: floor,
      floorLeft: x - 120,
      floorRight: x + 120,
      life: [0.4, 0.7],
    });
    coinFx.burst(x + Phaser.Math.Between(-30, 30), topY, {
      count: Math.round(2 + 3 * strength),
      speed: [170, 340],
      spread: 1.5,
      scale: 0.72,
      floorY: floor - 12,
      floorLeft: x - 120,
      floorRight: x + 120,
      life: [0.5, 0.9],
    });
    coinFx.sparkle(face, floor - height * 0.5, { count: 3, radius: 18 });
    safePlaySfx("sfx-coin-pickup", { volume: 0.13, rate: 0.7 + Math.random() * 0.3 });
    safePlaySfx("sfx-bankbust-turret-shoot", { volume: 0.05, rate: 0.6 });
  }

  // The stage it just fell to: a plate goes flying and the pitch of the fight
  // rises, so its condition reads without looking at the bar.
  function crackCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    coinFx.debris(x, floor - height * 0.8, {
      frame: crate.stage === "broken" ? 1 : 0,
      speed: [240, 380],
      spread: 1.1,
      floorY: floor - 4,
      floorLeft: x - 120,
      floorRight: x + 120,
      life: [1, 1.5],
    });
    coinFx.burst(x, floor - height * 0.75, {
      count: 9,
      speed: [220, 420],
      spread: 1.7,
      floorY: floor - 12,
      floorLeft: x - 120,
      floorRight: x + 120,
      life: [0.8, 1.2],
    });
    safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.14, rate: 0.8 });
    crate.spring.squashSpeed -= 3;
  }

  function breakCrate(site) {
    const x = Number(site.x);
    const floor = crateFloor(site);
    const height = Number(site.height) || 116;
    const midY = floor - height / 2;
    hideCrate();
    const flash = lootFx.glow(x, midY, 180, 0xfff3c4, 1, RENDER_LAYERS.ATTACKS);
    scene.tweens.add({
      targets: flash,
      displayWidth: 460,
      displayHeight: 460,
      alpha: 0,
      duration: 340,
      ease: "Quad.easeOut",
      onComplete: () => flash.destroy(),
    });
    shockRing(x, midY, { radius: 260, color: 0xffd264, width: 6, duration: 520 });
    shockRing(x, midY, { radius: 150, color: 0xfff3c4, width: 3, duration: 360 });
    const floorRange = { floorY: floor - 8, floorLeft: x - 120, floorRight: x + 120 };
    // The crate itself: its plates, straps, brackets and the dial.
    for (const [frame, count] of [
      [0, 2],
      [1, 3],
      [2, 4],
      [3, 1],
    ]) {
      coinFx.debris(x, midY, {
        frame,
        count,
        speed: [260, 560],
        spread: Math.PI * 1.15,
        life: [1, 1.6],
        ...floorRange,
      });
    }
    coinFx.debris(x, midY, {
      tint: 0x4a5a80,
      width: 8,
      height: 3,
      count: 18,
      speed: [200, 560],
      spread: Math.PI * 1.4,
      life: [0.5, 1],
      ...floorRange,
    });
    coinFx.burst(x, midY, {
      count: 42,
      speed: [240, 640],
      spread: Math.PI * 1.25,
      jitter: 30,
      life: [1, 1.8],
      ...floorRange,
    });
    coinFx.sparkle(x, midY, { count: 14, radius: 90 });
    coinFx.floatText(x, floor - height - 8, `${formatCoins(Number(site.reward) || 0)}!`, {
      size: 18,
    });
    safePlaySfx("sfx-bankbust-wall-claim", { volume: 0.5 });
    safePlaySfx("sfx-bankbust-mine-collect", { volume: 0.3 });
    if (!reducedMotion && isOnCamera(x, midY)) {
      try {
        scene.cameras?.main?.shake?.(260, 0.008);
      } catch (_) {}
    }
  }

  // Nobody opened it in time: it flickers and collapses in on itself, with
  // nothing thrown out, so it could not be mistaken for coins worth chasing.
  function retireCrate() {
    if (!crate?.body?.scene) return;
    crate.leaving = true;
    crate.shadow.setVisible(false);
    crate.glow.setVisible(false);
    scene.tweens.add({
      targets: crate.body,
      scaleY: 0,
      scaleX: 1.15,
      alpha: 0.2,
      duration: reducedMotion ? 1 : 300,
      ease: "Cubic.easeIn",
      onComplete: () => {
        crate.leaving = false;
        hideCrate();
        crate.body.setAlpha(1);
      },
    });
  }

  function renderActiveCrate(site) {
    const entry = ensureCrate();
    if (!entry) return;
    const x = Number(site.x);
    const floor = crateFloor(site);
    const maxHealth = Math.max(1, Number(site.maxHealth) || 1);
    const ratio = Phaser.Math.Clamp((Number(site.health) || 0) / maxHealth, 0, 1);
    const dt = Math.min(0.05, (Number(scene?.game?.loop?.delta) || 16) / 1000);

    const stage = crateStage(ratio);
    if (entry.stage !== stage) {
      const wasStage = entry.stage;
      entry.stage = stage;
      entry.body.setTexture(`bank-bust-center-crate-${stage}`);
      if (wasStage) crackCrate(site);
    }

    const hit = site.lastHit;
    if (hit && Number(hit.at) > entry.lastHitAt) {
      entry.lastHitAt = Number(hit.at);
      hitCrate(site, hit);
    }

    // Close to breaking, it strains on its own and leaks.
    if (!reducedMotion && ratio <= 0.25 && scene.time.now >= entry.nextCreakAt) {
      entry.nextCreakAt = scene.time.now + 520 + Math.random() * 700;
      kickCrate(entry.spring, Math.random() < 0.5 ? -1 : 1, 0.16);
      coinFx.burst(x + Phaser.Math.Between(-36, 36), floor - 60, {
        count: 1,
        speed: [60, 130],
        spread: 1.2,
        scale: 0.72,
        floorY: floor - 12,
        floorLeft: x - 120,
        floorRight: x + 120,
        life: [0.5, 0.8],
      });
    }

    stepCrateSpring(entry.spring, dt);

    let lift = 0;
    if (!entry.landed) {
      const t = (scene.time.now - entry.droppedAt) / CRATE_DROP_MS;
      if (t >= 1 || reducedMotion) landCrate(site);
      else lift = (1 - t * t) * CRATE_DROP_HEIGHT;
    }
    const squash = reducedMotion ? 0 : entry.spring.squash;
    const shake = reducedMotion ? { x: 0, tilt: 0 } : crateShake(entry.spring);
    entry.body.setVisible(true);
    entry.body.setPosition(x + shake.x, floor - lift);
    entry.body.setRotation(shake.tilt);
    entry.body.setScale(1 - squash * 0.55, 1 + squash);

    // White for the frame it is struck, then the last few seconds count down.
    const remaining = Number(site.expiresAt || 0) - Date.now();
    if (scene.time.now < entry.flashUntil) {
      entry.body.setTintFill(0xffffff);
    } else if (remaining < CRATE_WARNING_MS && Math.floor(scene.time.now / 130) % 2 === 0) {
      entry.body.setTint(0xff9a8a);
    } else {
      entry.body.clearTint();
    }

    const shadowScale = Phaser.Math.Clamp(1 - lift / CRATE_DROP_HEIGHT, 0.25, 1);
    entry.shadow.setVisible(true);
    entry.shadow.setPosition(x, floor - 3);
    entry.shadow.setScale(shadowScale, shadowScale);

    const breathe = reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(scene.time.now / 420);
    entry.glow.setVisible(entry.landed);
    entry.glow.setPosition(x, floor - 58);
    entry.glow.setAlpha((0.16 + 0.12 * breathe) * (1.6 - ratio * 0.6));

    if (entry.landed) drawCrateHealth(entry, x, floor - (Number(site.height) || 116) - 18, ratio);
  }

  function drawCrateHealth(entry, x, y, ratio) {
    const width = 104;
    const height = 8;
    const left = x - width / 2;
    // The lost chunk lingers for a moment and then drains, so the size of the
    // last hit is readable.
    entry.barHealth = Math.max(
      ratio,
      entry.barHealth - 0.6 * ((Number(scene?.game?.loop?.delta) || 16) / 1000),
    );
    uiGraphics.fillStyle(0x0b1220, 0.9);
    uiGraphics.fillRect(left - 3, y - 3, width + 6, height + 6);
    uiGraphics.fillStyle(0x1f2937, 1);
    uiGraphics.fillRect(left, y, width, height);
    uiGraphics.fillStyle(0xfff1b8, 1);
    uiGraphics.fillRect(left, y, width * entry.barHealth, height);
    uiGraphics.fillStyle(0xf59e0b, 1);
    uiGraphics.fillRect(left, y, width * ratio, height);
    uiGraphics.fillStyle(0xfde68a, 1);
    uiGraphics.fillRect(left, y, width * ratio, 2);
  }

  // Square brackets on the hilltop: where the next crate lands.
  function drawCrateSite(x, floor, size, alpha, color = 0xfacc15) {
    const half = size / 2;
    const tick = 14;
    objectGraphics.lineStyle(3, color, alpha);
    for (const sx of [-1, 1]) {
      objectGraphics.beginPath();
      objectGraphics.moveTo(x + sx * (half - tick), floor);
      objectGraphics.lineTo(x + sx * half, floor);
      objectGraphics.lineTo(x + sx * half, floor - tick);
      objectGraphics.strokePath();
    }
  }

  // The contested centre crate. Its site is marked only while a drop is
  // counting down; the crate itself only exists while it is live.
  function renderCenterGold(modeState) {
    const site = modeState?.centerGold;
    if (!site?.enabled) {
      hideCrate();
      return;
    }
    const x = Number(site.x) || 0;
    const floor = crateFloor(site);
    const phase = String(site.phase || "");
    const now = Date.now();
    const wasActive = state.centerGoldPhase === "active";

    if (wasActive && phase !== "active") {
      if (site.lastOutcome === "broken") breakCrate(site);
      else retireCrate();
      if (crate) {
        crate.stage = null;
        crate.landed = false;
      }
    }

    if (phase === "active") {
      if (!wasActive) {
        const entry = ensureCrate();
        if (entry) {
          entry.droppedAt = scene.time.now;
          entry.landed = false;
          entry.leaving = false;
          entry.barHealth = 1;
          entry.spring = createCrateSpring();
          // Its first hit is new; an older round's cannot replay.
          entry.lastHitAt = Number(site.lastHit?.at) || 0;
        }
      }
      renderActiveCrate(site);
    } else if (!crate?.leaving) {
      hideCrate();
    }

    if (phase === "announced") {
      // Counting down: the brackets close on the landing spot, and a shadow
      // grows under a crate that has not arrived yet.
      const total = Math.max(1, Number(site.spawnAt || 0) - Number(site.announceAt || 0));
      const progress = Phaser.Math.Clamp(1 - (Number(site.spawnAt || 0) - now) / total, 0, 1);
      const pulse = reducedMotion ? 1 : 0.6 + 0.4 * Math.abs(Math.sin(scene.time.now / 180));
      drawCrateSite(x, floor, 260 - 120 * progress, (0.45 + 0.5 * progress) * pulse, 0xfde68a);
      objectGraphics.fillStyle(0x000000, 0.1 + 0.25 * progress);
      objectGraphics.fillEllipse(x, floor - 3, 40 + 90 * progress, 6 + 8 * progress);
      if (state.centerGoldPhase !== "announced") {
        safePlaySfx("sfx-bankbust-crate-incoming", { volume: 0.5 });
      }
    }

    state.centerGoldPhase = phase;
  }

  function destroyCrate() {
    destroyContainer(crate?.body);
    destroyContainer(crate?.shadow);
    destroyContainer(crate?.glow);
    crate = null;
  }

  return { hideCrate, renderCenterGold, destroyCrate };
}
