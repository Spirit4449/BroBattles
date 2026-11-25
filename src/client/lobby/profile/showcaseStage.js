import { getNavigation } from "../../lib/globals.cjs";
import { createShowcaseFight } from "./showcaseFight";
import { isMovementSuppressed } from "../../../shared/combat/runtime/abilityRuntimeManager";
import { showcaseRoster } from "./showcaseKit";
import { POWERUP_CATALOG } from "../../../shared/powerups";
// Phaser side of the character showcase (loaded on demand by
// characterShowcase.js once window.Phaser exists). One small game renders a
// single floating platform. Fighters are built like the game's remote players
// (presentation, origin, body, foot ring, health and super bars) and act
// through the real character presentation paths (see showcaseKits.js), so
// what plays here is what plays in a match.
import {
  preloadForRoster, setupFor, setupVariantAnimationsForRoster, getTextureKey, getEffectsClass, resolveAnimKey,
} from "../../game/characters/index.js";
import { spritePresentation, sizePlayerBody } from "../../game/characters/shared/spritePresentation.js";
import { bindPlayerOrigin, bodyBounds, playerAnchor } from "../../game/characters/shared/rig.js";
import { activeAction, playCharacterAnimation, clearAction, resetAirborneJumpAnimation, resolveSpriteAnimationKey } from "../../game/characters/shared/animationState.js";
import { playPlayerSound } from "../../game/audio/playerAudio.js";
import {
  MOVEMENT_VFX_CONFIG, runDustInterval, spawnHealthMarker, spawnJumpTakeoff, spawnLandingImpact, spawnRunDust, spawnDeathBurst, spawnSpawnBurst,
} from "../../game/scene/effects.js";
import { spawnDashEffect, playDashSound } from "../../game/scene/dash.js";
import { applyBodyFlipOffset, hudTopY } from "../../game/players/playerBodyGeometry";
import { cancelFighterCombat } from "../../game/players/fighterCombatCleanup";
import { attachTeamFootRing } from "../../game/players/teamFootRing.js";
import { createPlayerWorldHud, WORLD_HUD_WIDTH } from "../../game/scene/playerWorldHud";
import { attachEnemyBodyVisual } from "../../game/players/enemyBodyVisual";
import { releaseRendererContext, rendererContextOf } from "../../game/scene/releaseRenderer.js";
import { RENDER_LAYERS } from "../../game/scene/renderLayers.js";
import { bindGameAudio } from "../../site/preferences.js";
import { getHealth } from "../../../shared/characters/characterStats.js";
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
const RUN_SPEED = movementPhysics.maxSpeed;
const ARENA_WIDTH = 560;
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
  let destroyed = false;
  let loading = 0;
  let loadQueue = Promise.resolve();
  const readyVariants = new Set();
  let finishRender = null;
  let finishLoad = null;
  let view = null; // world-space layout of the current camera

  class ShowcaseScene extends Phaser.Scene {
    constructor() { super("character-showcase"); }
    preload() {
      for (const [type, config] of Object.entries(POWERUP_CATALOG)) {
        this.load.image(`pu-icon-${type}-webp`, `/assets/powerups/${config.assetDir}/icon.webp`);
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
      bindGameAudio(this);
      this.events.on("postupdate", drawOverlays);
      sceneReady();
      queueMicrotask(restWhenIdle);
    }
  }

  const sharedContext = getNavigation()?.getAudioContext?.();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: host,
    width: 320,
    height: 160,
    transparent: true,
    pixelArt: true,
    antialias: false,
    roundPixels: false,
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

  function drawOverlays(_time, delta) {
    if (!scene) return;
    if (fighters.length && current?.mode === "fight") frameFight(delta);
    for (const fighter of fighters) {
      fighter.effects?.update(delta, !!fighter.sprite._bbAnimationVelocity?.x, fighter.defeated);
      drawHud(fighter);
    }
  }

  function createHud(fighter, name) {
    fighter.hud = createPlayerWorldHud(scene, {
      username: name, role: fighter.self ? "self" : fighter.team === "team1" ? "ally" : "enemy",
      getPlayerEffects: () => fighter.status,
    });
  }

  function drawHud(fighter) {
    const { sprite, hud } = fighter;
    if (!sprite.active) return;
    hud.draw({
      sprite, headY: hudTopY(sprite, fighter.frame, fighter.presentation.body),
      health: fighter.health, maxHealth: fighter.maxHealth, dead: fighter.defeated,
      charge: fighter.charge, maxCharge: 1, ammo: fighter.ammo, visible: !fighter.defeated,
    });
  }

  // ---- fighters --------------------------------------------------------------

  function loadRoster(roster) {
    preloadForRoster(scene, roster);
    if (!scene.load.list.size) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const failed = [];
      const onError = file => { if (file.type === "atlas" || file.type === "json" || file.type === "image") failed.push(file.key); };
      const complete = () => {
        finishLoad = null;
        scene.load.off("complete", complete);
        scene.load.off("loaderror", onError);
        if (failed.length && !destroyed) reject(new Error(`showcase assets failed: ${failed.join(", ")}`));
        else resolve();
      };
      finishLoad = complete;
      scene.load.on("loaderror", onError);
      scene.load.once("complete", complete);
      scene.load.start();
    });
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
    if (sprite._bbTeamColor === TEAM_RED) attachEnemyBodyVisual(scene, sprite);
    const kit = getShowcaseKit(character);
    const art = current.mode === "animations" ? idleArtBounds(sprite.texture) : null;
    const visual = kit.visual || {};
    const presentation = spritePresentation(character, sprite.texture);
    sprite.setScale(presentation.scale);
    bindPlayerOrigin(sprite, presentation);
    sprite._bbHudTopOffset = presentation.hudTopOffset;
    sprite.body.allowGravity = false;
    sprite.body.moves = false;
    const frame = sprite.frame;
    sizePlayerBody(sprite, frame, presentation.body);
    sprite.setDepth(RENDER_LAYERS.PLAYER);
    const maxHealth = getHealth(character, level);
    const fighter = {
      id, team, role, character, skinId, sprite, presentation, frame, self, level,
      // Fit the solo camera to the artwork without changing gameplay units.
      cameraHeight: art ? Math.max(SHOWCASE_WORLD_HEIGHT, SHOWCASE_WORLD_HEIGHT * presentation.scale / showcaseSpriteScale(art, visual),
        (JUMP.height + art.height * presentation.scale + 52) / 0.88) : SHOWCASE_WORLD_HEIGHT,
      homeX: 0, standY: 0,
      maxHealth, health: maxHealth,
      name,
      charge: 0, defeated: false, nextStepAt: 0, stepCursor: 0,
    };
    applyBodyFlipOffset(sprite, frame, presentation.body);
    const Effects = getEffectsClass(character);
    if (Effects) fighter.effects = new Effects(scene, sprite);
    attachTeamFootRing(scene, sprite, { isAlly: team === "team1" && !self, isSelf: self, hidden: () => fighter.defeated });
    createHud(fighter, name);
    play(fighter, "idle");
    return fighter;
  }

  function face(fighter, direction) {
    fighter.sprite.setFlipX(direction < 0);
    applyBodyFlipOffset(fighter.sprite, fighter.frame, fighter.presentation.body);
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
    combat?.dispose();
    combat = null;
    // Let character code drop its listeners (sweeps, casts) before teardown.
    for (const fighter of fighters) {
      cancelFighterCombat(fighter.sprite);
      fighter.effects?.destroy();
      fighter.hud.destroy();
    }
    scene._localPlayerAudioSprite = null;
    scene.events.emit("presentation:reset");
    scene.tweens.killAll();
    scene.time.removeAllEvents();
    for (const child of [...scene.children.list]) if (child !== scene.platform) child.destroy();
    scene.sound.removeAll();
    fighters = [];
  }

  // Measure one stable idle frame, so a raised weapon or drifting effect in
  // another animation cannot change the fighter's size. Cache per skin texture.
  const artBounds = new Map();
  function idleArtBounds(texture) {
    if (artBounds.has(texture.key)) return artBounds.get(texture.key);
    const name = texture.has("idle00") ? "idle00" : texture.getFrameNames().find(name => /^idle/i.test(name)) || texture.getFrameNames()[0];
    const frame = texture.get(name);
    const image = texture.getSourceImage();
    let pixels = null;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = frame.cutWidth; canvas.height = frame.cutHeight;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.drawImage(image, -frame.cutX, -frame.cutY);
      pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    } catch (_) {}
    const bounds = showcaseOpaqueBounds({ cutX: 0, cutY: 0, cutWidth: frame.cutWidth, cutHeight: frame.cutHeight,
      x: frame.x, y: frame.y, rotated: frame.rotated }, pixels, frame.cutWidth);
    artBounds.set(texture.key, bounds);
    return bounds;
  }

  // ---- camera ----------------------------------------------------------------

  // Frame the combatants inside the actual preview panel. Keep the world and
  // platform fixed as the fighters close in, get knocked back, or rise to cast.
  function frameFight(delta) {
    const camera = scene.cameras.main;
    let left = Infinity, right = -Infinity, top = -110;
    for (const { sprite, hud } of fighters) {
      const margin = Math.max(WORLD_HUD_WIDTH, hud.playerName.width, sprite.body.width) / 2 + 16;
      left = Math.min(left, sprite.x - margin);
      right = Math.max(right, sprite.x + margin);
      const head = Number.isFinite(sprite._bbHudTopOffset)
        ? sprite.y + sprite._bbHudTopOffset : bodyBounds(sprite).top;
      top = Math.min(top, head - 55);
    }
    const floor = 0.76;
    const targetZoom = Math.min(camera.width / Math.max(SHOWCASE_WORLD_HEIGHT, right - left),
      camera.height / SHOWCASE_WORLD_HEIGHT, camera.height * (floor - 0.22) / -top);
    // Pull back immediately to keep everyone visible. Ease the tighter shot.
    const blend = Number.isFinite(delta) ? 1 - Math.exp(-delta / 240) : 1;
    const zoom = Math.min(targetZoom, camera.zoom + (targetZoom - camera.zoom) * blend);
    const halfWidth = camera.width / (2 * zoom);
    const middle = (left + right) / 2;
    const previous = view.centerX ?? middle;
    view.centerX = Phaser.Math.Clamp(previous + (middle - previous) * blend, right - halfWidth, left + halfWidth);
    camera.setZoom(zoom).centerOn(view.centerX, (0.5 - floor) * camera.height / zoom);
  }

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
    if (current?.mode === "fight") {
      const platformScale = ARENA_WIDTH / stageLayout.platform.width;
      scene.platform.setScale(platformScale).setPosition(0, -stageLayout.platform.surfaceY * platformScale);
      view = { runLimit: ARENA_WIDTH * 0.4 };
      frameFight();
      return;
    }
    const tag = Math.max(WORLD_HUD_WIDTH, hero.hud.playerName.width);
    const zoom = Math.min(deviceHeight / hero.cameraHeight, deviceWidth * 0.94 / (tag + 24));
    scene.cameras.main.setZoom(zoom).centerOn(0, -0.38 * deviceHeight / zoom);
    const viewWidth = deviceWidth / zoom;
    const platformWidth = Math.min(viewWidth * 0.9, ARENA_WIDTH);
    const scale = platformWidth / stageLayout.platform.width;
    scene.platform.setScale(scale).setPosition(0, -stageLayout.platform.surfaceY * scale);
    view = { runLimit: Math.max(0, Math.min(viewWidth / 2 - tag / 2 - 8, platformWidth * 0.4)) };
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

  function play(fighter, logical, dashDirection) {
    return playCharacterAnimation({ scene, sprite: fighter.sprite, character: fighter.character,
      skinId: fighter.skinId, logical, resolveAnimKey, dashDirection });
  }

  function idlePose(fighter) {
    if (!fighter.sprite.anims.currentAnim?.key?.endsWith("-idle")) play(fighter, "idle");
  }

  function feet(fighter) {
    return playerAnchor(fighter.sprite, "feet");
  }

  function movementStep(fighter, velocityX) {
    const speed = Math.abs(velocityX);
    if (speed <= MOVEMENT_VFX_CONFIG.runDustMinSpeed) return;
    const direction = Math.sign(velocityX);
    const speedRatio = Math.min(1, speed / MOVEMENT_VFX_CONFIG.runSpeedReference);
    const point = feet(fighter);
    if (scene.time.now >= (fighter.nextDustAt || 0)) {
      fighter.nextDustAt = scene.time.now + runDustInterval(speedRatio);
      safely(() => spawnRunDust(scene, point.x - direction * 10, point.y - 2, { direction, intensity: speedRatio }));
    }
    if (scene.time.now < fighter.nextStepAt) return;
    fighter.nextStepAt = scene.time.now + 300 / Math.max(0.15, speedRatio);
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
    const direction = x > sprite.x ? 1 : -1;
    sprite._bbAnimationVelocity = { x: direction * RUN_SPEED, y: 0 };
    play(fighter, "running");
    movementStep(fighter, direction * RUN_SPEED);
    try {
      await d.tween({ targets: sprite, x, duration: (distance / RUN_SPEED) * 1000,
        onUpdate: () => movementStep(fighter, direction * RUN_SPEED) });
    } finally {
      sprite._bbAnimationVelocity = { x: 0, y: 0 };
    }
  }

  // Use linear elapsed time; the trajectory itself supplies acceleration.
  async function hop(d, fighter) {
    d.alive();
    const { sprite } = fighter;
    const start = feet(fighter);
    safely(() => spawnJumpTakeoff(scene, start.x, start.y, { bodyWidth: sprite.body.width }));
    safely(() => playPlayerSound(scene, sprite, "sfx-jump", { volume: 0.5 }));
    resetAirborneJumpAnimation(sprite);
    sprite._bbAnimationVelocity = { x: 0, y: -JUMP.launch };
    play(fighter, "jumping");
    const progress = { elapsed: 0 };
    await d.tween({
      targets: progress, elapsed: JUMP.durationMs, duration: JUMP.durationMs, ease: "Linear",
      onUpdate: () => {
        const sample = JUMP.sample(progress.elapsed);
        sprite.y = fighter.standY - sample.height;
        sprite._bbAnimationVelocity.y = sample.velocity;
        play(fighter, sample.falling ? "falling" : "jumping");
      },
    });
    sprite._bbAnimationVelocity = { x: 0, y: 0 };
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
    play(fighter, "dashing", { x: direction, y: 0 });
    safely(() => spawnDashEffect(scene, sprite, direction, 0));
    safely(() => playDashSound(scene, true, sprite));
    const reach = movementPhysics.dashHorizontalSpeed * movementPhysics.dashDurationMs / 1000;
    const x = Phaser.Math.Clamp(sprite.x + direction * reach, -view.runLimit, view.runLimit);
    await d.tween({ targets: sprite, x, duration: movementPhysics.dashDurationMs + 140, ease: "Quad.easeOut" });
    play(fighter, "idle");
  }

  function showHealthChange(fighter, delta) {
    const { sprite } = fighter;
    const headY = hudTopY(sprite, fighter.frame, fighter.presentation.body);
    spawnHealthMarker(scene, sprite.x, fighter.hud.markerY(headY), delta, {
      team: fighter.team === "team1" ? "ally" : "enemy", isSelf: fighter.self,
    });
  }

  function showDefeat(fighter) {
    cancelFighterCombat(fighter.sprite);
    for (const part of fighter.hud.barsAndLabels) part.setVisible(false);
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
    for (const part of fighter.hud.barsAndLabels) part.setVisible(true);
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
      hero.demonstratingCombat = true;
      combat.attack(hero);
      await d.wait(1100);
      idlePose(hero);
      await d.wait(500);
    });
    await step(async () => {
      combat.special(hero);
      // A channel owns the pose. A lingering buff can accompany the run and dash.
      await d.wait(1200);
      while (hero.abilityMotion || activeAction(hero.sprite) ||
        isMovementSuppressed(combat.session.players.get(hero.id), combat.session.now)) await d.wait(200);
      await d.wait(600);
      idlePose(hero);
      hero.demonstratingCombat = false;
      await d.wait(400);
    });
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
      hero.sprite._ducking = true;
      play(hero, "ducking");
      await d.wait(1000);
      hero.sprite._ducking = false;
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
    const request = current;
    const guard = promise => promise.catch(error => { if (error !== CANCELLED) console.warn("[showcase] routine failed", error); });
    combat = createShowcaseFight({ scene, fighters, halfWidth: Math.max(200, view.runLimit + 30),
      face, play, movementStep, showHealthChange, showDefeat, autoplay: mode === 'fight', initialCharge: current?.carriedCharge,
      onRoundEnd: carriedCharge => {
        if (current === request) guard(stage.show({ ...request, carriedCharge }));
      },
    });
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
      const onRender = () => { if (++frames >= 2) finishRender(); };
      finishRender = () => {
        game.events.off("postrender", onRender);
        finishRender = null;
        resolve();
      };
      game.events.on("postrender", onRender);
    });
  }

  function restWhenIdle() {
    if (scene && !current && !loading && !destroyed) game.loop.sleep();
  }

  // Phaser has one loader per scene. Wait for its current batch even if two
  // views need the same atlas and its files are already in flight.
  function prepare({ character, skinId, mode, level = 1 }) {
    const roster = showcaseRoster({ character, skinId, level, mode });
    loading++;
    const batch = loadQueue.then(async () => {
      await sceneStarted;
      if (destroyed) return;
      game.loop.wake();
      const missing = roster.filter(f => !readyVariants.has(getTextureKey(f.character, f.skinId)))
        .map(f => ({ char_class: f.character, selected_skin_id: f.skinId }));
      if (!missing.length) return;
      for (const entry of missing) {
        for (const [key, url] of Object.entries(getShowcaseKit(entry.char_class).sounds || {})) {
          if (!scene.cache.audio.exists(key)) scene.load.audio(key, url);
        }
      }
      await loadRoster(missing);
      if (destroyed) return;
      for (const entry of missing) {
        if (!readyVariants.has(entry.char_class)) setupFor(scene, entry.char_class);
        readyVariants.add(entry.char_class);
      }
      setupVariantAnimationsForRoster(scene, missing);
      for (const entry of missing) readyVariants.add(getTextureKey(entry.char_class, entry.selected_skin_id));
    }).finally(() => { loading--; restWhenIdle(); });
    loadQueue = batch.catch(() => {});
    return batch;
  }

  const stage = {
    // Loads a view's atlases and sounds without starting it.
    prepare,
    // Builds a view (`animations` or `fight`); true once its first frame is drawn.
    async show({ character, skinId, level = 1, mode, name = "You", onCycleComplete = () => {}, carriedCharge = {} }) {
      if (destroyed) return false;
      finishRender?.();
      const request = { character, skinId, level, mode, name, onCycleComplete, carriedCharge };
      current = request;
      runId++;
      await prepare(request);
      if (current !== request) return false;

      clearStage();
      const roster = showcaseRoster({ character, skinId, level, mode, name });
      fighters = roster.map(entry => {
        const fighter = createFighter(entry);
        fighter.facesX = entry.team === 'team1' ? 1 : -1;
        face(fighter, fighter.facesX);
        stand(fighter, entry.x);
        return fighter;
      });
      scene._localPlayerAudioSprite = fighters[0].sprite;
      layout();
      startRoutine(mode, () => { if (current === request) onCycleComplete(); });
      await nextRender();
      return current === request;
    },
    hide() {
      if (destroyed) return;
      finishRender?.();
      runId++;
      current = null;
      if (scene) clearStage();
      restWhenIdle();
    },
    destroy() {
      destroyed = true;
      current = null;
      sceneReady();
      finishLoad?.();
      finishRender?.();
      runId++;
      if (scene) {
        clearStage();
        scene.sys.shutdown();
      }
      resizeObserver.disconnect();
      delete host.showcaseGame;
      const context = rendererContextOf(game);
      return new Promise(resolve => {
        game.events.once(Phaser.Core.Events.DESTROY, resolve);
        game.destroy(true);
        if (game.isRunning) game.loop.wake();
      }).then(() => releaseRendererContext(context));
    },
  };
  return stage;
}
