import { drawAmmoChargeBar } from "../../game/scene/ammoBarRenderer";
import { createShowcaseFight } from "./showcaseFight";
import { showcaseRoster } from "./showcaseKit";
import { POWERUP_CATALOG } from "../../../shared/powerups";
// Phaser side of the character showcase (loaded on demand by
// characterShowcase.js once window.Phaser exists). One small game renders a
// single floating platform. Fighters are built like the game's remote players
// (presentation, origin, body, foot ring, health and super bars) and act
// through the real character presentation paths (see showcaseKits.js), so
// what plays here is what plays in a match.
import {
  preloadForRoster, setupFor, setupVariantAnimationsForRoster, getTextureKey,
} from "../../game/characters/index.js";
import { spritePresentation } from "../../game/characters/shared/spritePresentation.js";
import { bindPlayerOrigin, bodyBounds, playerAnchor } from "../../game/characters/shared/rig.js";
import { playSpriteAnimation, clearAction, directionalDashAnimation, resolveSpriteAnimationKey } from "../../game/characters/shared/animationState.js";
import { playPlayerSound } from "../../game/audio/playerAudio.js";
import {
  spawnHealthMarker, spawnJumpTakeoff, spawnLandingImpact, spawnRunDust, spawnDeathBurst, spawnSpawnBurst,
} from "../../game/scene/effects.js";
import { spawnDashEffect, playDashSound } from "../../game/scene/dash.js";
import { attachTeamFootRing } from "../../game/players/teamFootRing.js";
import { drawHealthBar } from "../../game/scene/healthBarRenderer.js";
import { drawSuperChargeBar } from "../../game/scene/superBarRenderer.js";
import { RENDER_LAYERS } from "../../game/scene/renderLayers.js";
import { bindGameAudio, bindCanvasName } from "../../site/preferences.js";
import { getHealth, getSuperChargeHits } from "../../../shared/characters/characterStats.js";
import { TEAM_GREEN, TEAM_RED } from "../../../shared/projectilePresentation";
import { getTerrainConfig, footstepVolume, terrainLandingSound } from "../../game/audio/movementAudio.js";
import { SHOWCASE_WORLD_HEIGHT, showcaseSpriteScale, showcaseOpaqueBounds, showcaseJumpMotion } from "./showcaseMotion.js";
import movementPhysics from "../../../shared/physics/movementPhysics.json";
import { getShowcaseKit } from "./showcaseKits.js";
import stageLayout from "../../../../public/assets/showcase/stage.json";

const Phaser = window.Phaser;
const PLATFORM_KEY = "showcase-platform";
const JUMP = showcaseJumpMotion();
const TERRAIN = "grass";
const TERRAIN_AUDIO = getTerrainConfig(TERRAIN);
const HUD_BAR_WIDTH = 52;
const RUN_SPEED = movementPhysics.maxSpeed;
const RUN_ANIMATION_RATE = 1;
const CANCELLED = Symbol("cancelled");
// Match-wide sounds the stage's movement and defeats play (preloadGameAssets).
const STAGE_SOUNDS = {
  "sfx-jump": "/assets/movement/jump.mp3",
  "sfx-dash": "/assets/movement/dash.mp3",
  "sfx-duck-transition": "/assets/movement/duck-transition.mp3",
  "sfx-death": "/assets/game-sounds/death.mp3",
  "sfx-respawn": "/assets/game-sounds/respawn.mp3",
};

// Presentation is decoration: a missing sound or effect never stops a routine.
function safely(action) {
  try { return action(); } catch (error) { console.warn("[showcase] effect skipped", error); }
}

export function createShowcaseStage(host) {
  let scene = null;
  let sceneReady;
  const sceneStarted = new Promise(resolve => { sceneReady = resolve; });
  let runId = 0;
  let fighters = [];
  let current = null;
  let combat = null;
  let view = null; // world-space layout of the current camera
  // Teardown for simulation and renderer instances.
  const cancelHooks = new Set();

  class ShowcaseScene extends Phaser.Scene {
    constructor() { super("character-showcase"); }
    preload() {
      for (const [type, config] of Object.entries(POWERUP_CATALOG)) {
        this.load.audio(`pu-touch-${type}`, `/assets/powerups/${config.assetDir}/touch.mp3`);
        if (config.tickVolume != null) this.load.audio(`pu-tick-${type}`, `/assets/powerups/${config.assetDir}/tick.mp3`);
      }
      this.load.image(PLATFORM_KEY, "/assets/showcase/platform.webp");
      for (const [key, url] of Object.entries(STAGE_SOUNDS)) this.load.audio(key, url);
      for (const sound of [...TERRAIN_AUDIO.steps, TERRAIN_AUDIO.landing]) {
        this.load.audio(sound.key, sound.files.map(file => `/assets/${file}`));
      }
    }
    create() {
      scene = this;
      scene._terrainType = TERRAIN;
      // Painted platform art, not pixel art: filter it smoothly.
      this.textures.get(PLATFORM_KEY).setFilter(Phaser.Textures.FilterMode.LINEAR);
      this.platform = this.add.image(0, 0, PLATFORM_KEY).setOrigin(0.5, 0).setDepth(RENDER_LAYERS.PLAYER - 5);
      // Same layer the match draws powerup and super auras on.
      this.auraGraphics = this.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
      bindGameAudio(this);
      this.events.on("postupdate", drawOverlays);
      sceneReady();
    }
  }

  const sharedContext = window.__BB_NAVIGATION__?.getAudioContext?.();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 160,
    transparent: true,
    pixelArt: true,
    antialias: false,
    roundPixels: true,
    banner: false,
    // Reuse the lobby's unlocked context so the first super is audible.
    audio: sharedContext ? { context: sharedContext } : {},
    input: false,
    physics: { default: "arcade", arcade: { gravity: { y: 0 } } },
    scale: { mode: Phaser.Scale.NONE },
    render: { powerPreference: "low-power" },
    scene: ShowcaseScene,
  });
  host.showcaseGame = game; // Debug handle for devtools.

  const resizeObserver = new ResizeObserver(() => layout());
  resizeObserver.observe(host);

  function drawOverlays() {
    if (!scene) return;
    scene.auraGraphics.clear();
    for (const fighter of fighters) {
      drawHud(fighter);
    }
  }

  function createHud(fighter, name) {
    const resolution = Math.max(1, Math.ceil(scene.cameras.main.zoom));
    const label = scene.add.text(0, 0, name, {
      fontFamily: "'Press Start 2P', monospace", fontSize: "7px", fill: "#ffffff", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5, 0).setDepth(RENDER_LAYERS.PLAYER_HUD + 2).setResolution(resolution);
    label.setShadow(1, 1, "rgba(0, 0, 0, 0.65)", 0, true, true);
    bindCanvasName(label, name);
    const healthText = scene.add.text(0, 0, "", {
      fontFamily: "'Press Start 2P', monospace", fontSize: "8px", color: "#FFFFFF", stroke: "#000000", strokeThickness: 4,
    }).setDepth(RENDER_LAYERS.PLAYER_HUD + 2).setResolution(resolution);
    const bar = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    const superBack = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    const superBar = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    const ammoBack = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD);
    const ammo = scene.add.graphics().setDepth(RENDER_LAYERS.PLAYER_HUD + 1);
    fighter.hud = { ammo, ammoBack, label, healthText, bar, superBack, superBar, parts: [ammo, ammoBack, label, healthText, bar, superBack, superBar] };
  }

  // Anchored like RemotePlayer.updateHealthBar / localPlayer.updateHealthBar.
  function drawHud(fighter) {
    const { sprite, hud } = fighter;
    if (!hud || !sprite.active) return;
    const hudX = playerAnchor(sprite, "top").x;
    const top = Number.isFinite(sprite._bbHudTopOffset) ? sprite.y + sprite._bbHudTopOffset
      : bodyBounds(sprite)?.top ?? sprite.y;
    const y = top - 20;
    hud.label.setPosition(hudX, top - (fighter.self ? 40 : 42));
    hud.healthText.setText(`${Math.max(0, Math.round(fighter.health))}`);
    hud.healthText.setPosition(hudX - hud.healthText.width / 2, y - 8);
    drawHealthBar(hud.bar, {
      x: hudX - HUD_BAR_WIDTH / 2, y, width: HUD_BAR_WIDTH, health: Math.max(0, fighter.health), maxHealth: fighter.maxHealth,
      color: fighter.team === "team1" ? 0xaebb50 : 0xb24035, teamGlowColor: fighter.team === "team1" ? 0x83dca6 : 0xe04a4e, isLocal: fighter.self,
    });
    drawAmmoChargeBar(hud.ammo, hud.ammoBack, { x: hudX - HUD_BAR_WIDTH / 2, y: y + 11, width: HUD_BAR_WIDTH,
      ammo: fighter.self && !fighter.defeated ? fighter.ammo : null });
    drawSuperChargeBar(hud.superBar, hud.superBack, {
      x: hudX - HUD_BAR_WIDTH / 2, y: y + (fighter.self ? 19 : 11), charge: fighter.charge, maxCharge: 1, player: sprite,
    });
  }

  // ---- fighters --------------------------------------------------------------

  function loadRoster(roster) {
    preloadForRoster(scene, roster);
    if (!scene.load.list.size) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const failed = [];
      const onError = file => { if (file.type === "atlas" || file.type === "json" || file.type === "image") failed.push(file.key); };
      scene.load.on("loaderror", onError);
      scene.load.once("complete", () => {
        scene.load.off("loaderror", onError);
        failed.length ? reject(new Error(`showcase assets failed: ${failed.join(", ")}`)) : resolve();
      });
      scene.load.start();
    });
  }

  function applyBodyOffset(fighter) {
    const { sprite, bodyConfig } = fighter;
    const extra = sprite.flipX ? bodyConfig.flipOffset || 0 : 0;
    const bodyWidth = bodyConfig.sourceUnits ? sprite.body.sourceWidth : sprite.body.width;
    sprite.body.setOffset(sprite.frame.realWidth / 2 - bodyWidth / 2 + (bodyConfig.offsetXFromHalf ?? 0) + extra,
      bodyConfig.offsetY);
  }

  // Built like RemotePlayer.createOpPlayer: same presentation, origin, body,
  // foot ring and bars, with health and super charge at the panel's level.
  function createFighter({ id, team, role, character, skinId, level, self, name }) {
    const textureKey = getTextureKey(character, skinId);
    const texture = scene.textures.get(textureKey);
    const idleFrame = texture.has("idle00") ? "idle00" : texture.getFrameNames()[0];
    const sprite = scene.physics.add.sprite(0, 0, textureKey, idleFrame);
    sprite._bbCharacter = character;
    sprite._bbSkinId = skinId || "";
    sprite._bbSkinTextureKey = textureKey;
    sprite._bbTeamColor = team === "team1" || self ? TEAM_GREEN : TEAM_RED;
    // Character code finds players by username (Gloop's catch, for one).
    sprite.username = id || name;
    const kit = getShowcaseKit(character);
    const art = idleArtBounds(sprite.texture);
    const visual = kit.visual || {};
    const matchPresentation = spritePresentation(character, sprite.texture);
    const body = matchPresentation.body;
    const bodyFeet = body.offsetY + sprite.frame.realHeight - body.heightShrink;
    const presentation = { ...matchPresentation,
      scale: showcaseSpriteScale(art, visual),
      // Ground the opaque art, including trimmed atlases, rather than leaving
      // its feet above/below the platform when the match collider differs.
      body: { ...body, sourceUnits: true, offsetY: body.offsetY + art.bottom - bodyFeet },
    };
    sprite.setScale(presentation.scale);
    sprite.setOrigin(presentation.originX, presentation.originY);
    bindPlayerOrigin(sprite, presentation);
    sprite._bbHudTopOffset = (art.top + art.height * (visual.bodyTop || 0) - sprite.displayOriginY) * presentation.scale;
    sprite.body.allowGravity = false;
    // Tweens place stage fighters; Arcade must never move them itself.
    sprite.body.moves = false;
    sprite.body.setSize(sprite.frame.realWidth - presentation.body.widthShrink,
      sprite.frame.realHeight - presentation.body.heightShrink);
    sprite.setDepth(RENDER_LAYERS.PLAYER);
    const maxHealth = getHealth(character, level);
    const fighter = {
      id, team, role, character, sprite, presentation, self, level, artHeight: art.height * (1 - (visual.bodyTop || 0)) * presentation.scale,
      artWidth: art.width * presentation.scale, homeX: 0, standY: 0,
      bodyConfig: presentation.body,
      maxHealth, health: maxHealth,
      name,
      chargePerHit: 1 / Math.max(1, getSuperChargeHits(character)),
      charge: 0, defeated: false, nextStepAt: 0, stepCursor: 0,
    };
    applyBodyOffset(fighter);
    fighter.ring = attachTeamFootRing(scene, sprite, { isAlly: team === "team1" && !self, isSelf: self });
    createHud(fighter, name);
    playSpriteAnimation({ scene, sprite, character, logical: "idle" });
    return fighter;
  }

  function face(fighter, direction) {
    fighter.sprite.setFlipX(direction < 0);
    applyBodyOffset(fighter);
  }

  // Put the body's bottom on the platform surface (world y = 0).
  function stand(fighter, x) {
    const { sprite } = fighter;
    sprite.setPosition(x, 0);
    // A new body keeps its unscaled size until Arcade's first step.
    sprite.body.updateBounds?.();
    const bounds = bodyBounds(sprite);
    if (bounds) sprite.y -= bounds.bottom;
    const { body } = sprite;
    body.updateFromGameObject?.();
    // As RemotePlayer does: a mid-frame body move must not be replayed as a
    // position delta by Arcade's postUpdate.
    body.prev?.copy?.(body.position);
    body.prevFrame?.copy?.(body.position);
    fighter.homeX = x;
    fighter.standY = sprite.y;
  }

  function clearStage() {
    for (const action of cancelHooks) safely(action);
    cancelHooks.clear();
    combat = null;
    // Let character code drop its listeners (sweeps, casts) before teardown.
    scene.events.emit("presentation:reset");
    scene.tweens.killAll();
    scene.time.removeAllEvents();
    const keep = new Set([scene.platform, scene.auraGraphics]);
    for (const child of [...scene.children.list]) if (!keep.has(child)) child.destroy();
    scene.auraGraphics.clear();
    fighters = [];
  }

  // Measure one stable idle frame, so a raised weapon or drifting effect in
  // another animation cannot change the fighter's size. Cache per skin texture.
  const artBounds = new Map();
  function idleArtBounds(texture) {
    if (artBounds.has(texture.key)) return artBounds.get(texture.key);
    const name = texture.has("idle00") ? "idle00" : texture.getFrameNames().find(name => /^idle/i.test(name)) || texture.getFrameNames()[0];
    const image = texture.getSourceImage();
    let pixels = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, 0, 0);
      pixels = context.getImageData(0, 0, image.width, image.height).data;
    } catch (_) {}
    const bounds = showcaseOpaqueBounds(texture.get(name), pixels, image.width);
    artBounds.set(texture.key, bounds);
    return bounds;
  }

  // ---- camera ----------------------------------------------------------------

  function layout() {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height || !scene) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const deviceWidth = Math.round(width * dpr);
    const deviceHeight = Math.round(height * dpr);
    if (game.scale.width !== deviceWidth || game.scale.height !== deviceHeight) {
      game.scale.resize(deviceWidth, deviceHeight);
      game.canvas.style.width = `${width}px`;
      game.canvas.style.height = `${height}px`;
    }
    const hero = fighters[0];
    if (!hero) return;
    // The same world frame gives every character and HUD the same screen
    // size. Only a narrow viewport/long name can require a wider camera.
    const tag = Math.max(HUD_BAR_WIDTH, ...fighters.map(fighter => fighter.hud?.label.width || 0));
    const span = Math.max(...fighters.map(f => f.homeX)) - Math.min(...fighters.map(f => f.homeX)) + tag + 24;
    const zoom = Math.min(deviceHeight / SHOWCASE_WORLD_HEIGHT, deviceWidth * 0.94 / span);
    const camera = scene.cameras.main;
    camera.setZoom(zoom);
    // The platform surface sits at 88% of the stage height.
    camera.centerOn(0, (deviceHeight * 0.5 - deviceHeight * 0.88) / zoom);
    const viewWidth = deviceWidth / zoom;
    const platformScale = Math.min(viewWidth * 0.9, 560) / stageLayout.platform.width;
    scene.platform.setScale(platformScale).setPosition(0, -stageLayout.platform.surfaceY * platformScale);
    view = {
      halfWidth: viewWidth / 2,
      // Runs and dashes stop where the name tag still fits on screen.
      runLimit: Math.max(0, Math.min(viewWidth / 2 - tag / 2 - 8, stageLayout.platform.width * platformScale * 0.4)),
      hop: JUMP.height,
    };
    const resolution = Math.max(1, Math.ceil(zoom));
    for (const fighter of fighters) {
      fighter.hud?.label.setResolution(resolution);
      fighter.hud?.healthText.setResolution(resolution);
    }
  }

  // ---- actions ---------------------------------------------------------------

  function director(id) {
    const alive = () => { if (id !== runId) throw CANCELLED; };
    const wait = ms => new Promise((resolve, reject) => {
      scene.time.delayedCall(ms, () => (id === runId ? resolve() : reject(CANCELLED)));
    });
    const tween = config => new Promise((resolve, reject) => {
      scene.tweens.add({ ...config, onComplete: () => (id === runId ? resolve() : reject(CANCELLED)) });
    });
    return { id, alive, wait, tween };
  }

  function play(fighter, logical) {
    playSpriteAnimation({ scene, sprite: fighter.sprite, character: fighter.character, logical });
  }

  function idlePose(fighter) {
    if (!fighter.sprite.anims.currentAnim?.key?.endsWith("-idle")) play(fighter, "idle");
  }

  function feet(fighter) {
    return playerAnchor(fighter.sprite, "feet");
  }

  function movementStep(fighter, direction) {
    const point = feet(fighter);
    const speedRatio = RUN_SPEED / movementPhysics.maxSpeed;
    safely(() => spawnRunDust(scene, point.x - direction * 10, point.y - 2, { direction, intensity: speedRatio }));
    if (scene.time.now < fighter.nextStepAt) return;
    fighter.nextStepAt = scene.time.now + 300;
    fighter.stepCursor = (fighter.stepCursor + 1) % TERRAIN_AUDIO.steps.length;
    safely(() => playPlayerSound(scene, fighter.sprite, TERRAIN_AUDIO.steps[fighter.stepCursor].key, {
      volume: footstepVolume(speedRatio, false, TERRAIN), rate: 0.94 + speedRatio * 0.14,
    }));
  }

  async function runTo(d, fighter, x) {
    d.alive();
    const { sprite } = fighter;
    const distance = Math.abs(x - sprite.x);
    if (distance < 1) return;
    face(fighter, x > sprite.x ? 1 : -1);
    play(fighter, "running");
    sprite.anims.timeScale = RUN_ANIMATION_RATE;
    const direction = x > sprite.x ? 1 : -1;
    const dust = scene.time.addEvent({
      delay: 140, loop: true,
      callback: () => movementStep(fighter, direction),
    });
    movementStep(fighter, direction);
    try {
      await d.tween({ targets: sprite, x, duration: (distance / RUN_SPEED) * 1000 });
    } finally {
      dust.remove();
      sprite.anims.timeScale = 1;
    }
  }

  // Use linear elapsed time; the trajectory itself supplies acceleration.
  async function hop(d, fighter) {
    d.alive();
    const { sprite } = fighter;
    const start = feet(fighter);
    safely(() => spawnJumpTakeoff(scene, start.x, start.y, { bodyWidth: sprite.body.width }));
    safely(() => playPlayerSound(scene, sprite, "sfx-jump", { volume: 0.5 }));
    play(fighter, "jumping");
    const progress = { elapsed: 0 };
    let falling = false;
    await d.tween({
      targets: progress, elapsed: JUMP.durationMs, duration: JUMP.durationMs, ease: "Linear",
      onUpdate: () => {
        const sample = JUMP.sample(progress.elapsed);
        sprite.y = fighter.standY - sample.height;
        if (!falling && sample.falling) { falling = true; play(fighter, "falling"); }
      },
    });
    sprite.y = fighter.standY;
    const land = feet(fighter);
    safely(() => spawnLandingImpact(scene, land.x, land.y, { impactVelocity: JUMP.sample(JUMP.durationMs).velocity, bodyWidth: sprite.body.width }));
    const landing = terrainLandingSound(TERRAIN, 0.5, scene);
    safely(() => playPlayerSound(scene, sprite, landing.key, { volume: landing.volume }));
    play(fighter, "idle");
  }

  async function dash(d, fighter, direction) {
    d.alive();
    const { sprite } = fighter;
    face(fighter, direction);
    play(fighter, directionalDashAnimation(fighter.character, { x: direction, y: 0 }));
    safely(() => spawnDashEffect(scene, sprite, direction, 0));
    safely(() => playDashSound(scene, true, sprite));
    const reach = movementPhysics.dashHorizontalSpeed * movementPhysics.dashDurationMs / 1000;
    const x = Phaser.Math.Clamp(sprite.x + direction * reach, -view.runLimit, view.runLimit);
    await d.tween({ targets: sprite, x, duration: movementPhysics.dashDurationMs + 140, ease: "Quad.easeOut" });
    play(fighter, "idle");
  }

  // Placed like the match's markers (RemotePlayer / localSocketEvents): just
  // above the body, layered under the bars so they stay readable.
  function showHealthChange(fighter, delta) {
    const { sprite } = fighter;
    const top = bodyBounds(sprite)?.top ?? sprite.y;
    spawnHealthMarker(scene, sprite.x, top - (fighter.self ? 16 : 18), delta, fighter.self
      ? { depth: 18, team: "ally", isSelf: true }
      : { depth: 11, team: "enemy" });
  }

  function showDefeat(fighter) {
    play(fighter, "dying");
    safely(() => spawnDeathBurst(scene, fighter.sprite));
    safely(() => playPlayerSound(scene, fighter.sprite, "sfx-death", { volume: 0.45 }));
  }

  function respawn(fighter) {
    if (!fighter.sprite.active) return;
    fighter.sprite.setPosition(fighter.homeX, fighter.standY);
    fighter.health = fighter.maxHealth;
    const state = combat?.session.players.get(fighter.id);
    if (state) { state.health = state.maxHealth; state.isAlive = true; state.effects = {}; state.activeEffects = {}; }
    fighter.charge = 0;
    fighter.defeated = false;
    face(fighter, fighter.facesX ?? 1);
    clearAction(fighter.sprite);
    play(fighter, "idle");
    safely(() => spawnSpawnBurst(scene, fighter.sprite));
    safely(() => playPlayerSound(scene, fighter.sprite, "sfx-respawn", { volume: 0.4 }));
  }

  // ---- routines --------------------------------------------------------------

  // Every animation in turn, on the spot or across the platform.
  async function animationsRoutine(d, hero) {
    const step = async action => { d.alive(); await action(); };
    await step(async () => { idlePose(hero); await d.wait(1300); });
    await step(async () => {
      await runTo(d, hero, view.runLimit);
      await runTo(d, hero, -view.runLimit);
      await runTo(d, hero, 0);
      face(hero, 1);
      idlePose(hero);
      await d.wait(250);
    });
    await step(async () => { await hop(d, hero); await d.wait(500); });
    await step(async () => {
      safely(() => playPlayerSound(scene, hero.sprite, "sfx-duck-transition", { volume: 0.5 }));
      play(hero, "ducking");
      await d.wait(1000);
      play(hero, "idle");
      await d.wait(300);
    });
    await step(async () => {
      await dash(d, hero, -1);
      await d.wait(300);
      await runTo(d, hero, 0);
      face(hero, 1);
      play(hero, "idle");
      await d.wait(300);
    });
    await step(async () => {
      combat.attack(hero);
      await d.wait(1100);
      idlePose(hero);
      await d.wait(500);
    });
    await step(async () => {
      combat.special(hero);
      // Let the actual ability finish, including the full Inferno / Rage.
      await d.wait(1200);
      while (Object.values(hero.status || {}).some(ms => ms > 0) ||
        (combat.session.players.get(hero.id)?.effects?.dravenInfernoUntil || 0) > combat.session.now) await d.wait(200);
      hero.sprite.y = hero.standY;
      idlePose(hero);
      await d.wait(400);
    });
    // Not every atlas has a defeat animation (Gloop's has none).
    const canFall = !!resolveSpriteAnimationKey({ scene, sprite: hero.sprite, character: hero.character, logical: "dying", fallback: "dying" })
      ?.endsWith("-dying");
    if (canFall) await step(async () => {
      hero.defeated = true;
      hero.health = 0;

      showDefeat(hero);
      await d.wait(1700);
      respawn(hero);
      await d.wait(900);
    });
  }

  function startRoutine(mode, onCycleComplete) {
    const d = director(++runId);
    const [hero] = fighters;
    const guard = promise => promise.catch(error => { if (error !== CANCELLED) console.warn("[showcase] routine failed", error); });
    combat = createShowcaseFight({ scene, fighters, halfWidth: Math.max(200, view.runLimit + 30),
      face, play, movementStep, showHealthChange, showDefeat, autoplay: mode === 'fight', initialCharge: current?.carriedCharge,
      onRoundEnd: carriedCharge => { if (current) stage.show({ ...current, carriedCharge }); },
    });
    cancelHooks.add(combat.dispose);
    if (mode === "animations") guard(animationsRoutine(d, hero).then(() => {
      d.alive();
      onCycleComplete();
    }));
  }

  // Resolves after the scene has drawn the new routine, so fading the canvas
  // in never reveals an empty or half-built frame.
  function nextRender() {
    return new Promise(resolve => {
      let frames = 0;
      const onRender = () => { if (++frames >= 2) { game.events.off("postrender", onRender); resolve(); } };
      game.events.on("postrender", onRender);
    });
  }

  async function prepare({ character, skinId, mode, level = 1 }) {
    // The loader advances on scene updates, so the loop runs while loading.
    game.loop.wake();
    await sceneStarted;
    const roster = showcaseRoster({ character, skinId, level, mode }).map(entry => ({ char_class: entry.character, selected_skin_id: entry.skinId }));
    for (const entry of roster) {
      for (const [key, url] of Object.entries(getShowcaseKit(entry.char_class).sounds || {})) {
        if (!scene.cache.audio.exists(key)) scene.load.audio(key, url);
      }
    }
    await loadRoster(roster);
    for (const entry of roster) setupFor(scene, entry.char_class);
    setupVariantAnimationsForRoster(scene, roster);
    return roster;
  }

  const stage = {
    // Loads a view's atlases and sounds without starting it.
    prepare,
    // Builds a view (`animations` or `fight`); true once its first frame is drawn.
    async show({ character, skinId, level = 1, mode, name = "You", onCycleComplete = () => {}, carriedCharge = {} }) {
      game.loop.wake();
      await sceneStarted;
      const request = { character, skinId, level, mode, name, onCycleComplete, carriedCharge };
      current = request;
      runId++;
      await prepare(request);
      if (current !== request) return false;

      clearStage();
      const roster = showcaseRoster({ character, skinId, level, mode, name });
      fighters = roster.map(entry => {
        const fighter = createFighter(entry);
        stand(fighter, entry.x);
        fighter.facesX = entry.team === 'team1' ? 1 : -1;
        face(fighter, fighter.facesX);
        return fighter;
      });
      scene._localPlayerAudioSprite = fighters[0].sprite;
      layout();
      startRoutine(mode, () => { if (current === request) onCycleComplete(); });
      await nextRender();
      return current === request;
    },
    hide() {
      runId++;
      current = null;
      if (scene) clearStage();
      game.sound?.stopAll?.();
      game.loop.sleep();
    },
    destroy() {
      runId++;
      if (scene) clearStage();
      resizeObserver.disconnect();
      game.destroy(true);
    },
  };
  return stage;
}
