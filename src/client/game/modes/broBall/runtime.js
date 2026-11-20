import { ballRules as rules } from '../../../../shared/broBall';
import { createCometBow } from '../../scene/dash';
import { RENDER_LAYERS } from '../../scene/renderLayers';
import { spawnRespawnEffect } from '../../scene/respawnEffect';
import { prefersReducedMotion } from '../../../ui/domMotion';
import { createBallSprite, deformationAt } from './ballArt';
import { createBallEffects } from './effects';
import { createGoalNets, TEAM_COLORS } from './arena';
import { layerDepths } from '../../maps/sceneryRuntime';
import { createHangingPlatforms } from './hangingPlatforms';
import { createCrowd } from './crowd';
import { mapArena } from '../../../../shared/maps/arenas';
import { broBallMovementTerrain, createBroBallAudio, preloadBroBallAudio } from './audio';

const HEAT_MS = 1200;
const SKY_TOP = 0x1f3c91;

export { preloadBroBallAudio as preloadBroBallAssets };

const hitboxEdge = (map, id, edge) => {
  const box = map.layout.hitboxes.find(entry => entry.id === id);
  if (!box) return null;
  return edge === 'top' ? box.y - box.height / 2 : edge === 'bottom' ? box.y + box.height / 2
    : edge === 'left' ? box.x - box.width / 2 : box.x + box.width / 2;
};

// The grandstand art (stands.webp) and its generated source: the crowd sits on
// the sandstone ledges, measured in source px.
const STANDS = { width: 702, height: 234, sourceWidth: 2172, ledges: [182, 339, 497, 650], inset: 40 };

// The world lines the crowd sits on: a scroll-1 scenery layer is drawn at the
// camera bounds' centre plus its offset.
function crowdRows(map) {
  const layer = map.scenery?.layers?.find(entry => entry.id === 'stands');
  const camera = mapArena(map)?.camera;
  if (!layer || !camera || layer.scroll !== 1) return null;
  const width = STANDS.width * (layer.scale || 1), height = STANDS.height * (layer.scale || 1);
  const x = camera.x + camera.width / 2 + (layer.x || 0) - width / 2;
  const y = camera.y + camera.height / 2 + (layer.y || 0) - height / 2;
  const scale = width / STANDS.sourceWidth;
  return STANDS.ledges.map(ledge => ({
    y: y + ledge * scale, left: x + STANDS.inset * scale, right: x + (STANDS.sourceWidth - STANDS.inset) * scale,
  }));
}

export function createBroBallRuntime({ scene, Phaser, getGameData, getModeState, getLocalPlayer, onGoal, playerLookup }) {
  const map = getGameData()?.mapSnapshot?.map;
  const layout = map?.objectiveLayout?.broBall;
  if (!layout) return { render() {}, destroy() {} };

  const reduced = prefersReducedMotion();
  const { goals, kickoff } = layout;
  const floor = hitboxEdge(map, 'pitch-floor', 'top') ?? goals.team1.bottom;
  const roof = hitboxEdge(map, 'ceiling', 'bottom') ?? goals.team1.top - 250;
  const left = hitboxEdge(map, 'left-net-wall', 'left') ?? goals.team1.backX;
  const right = hitboxEdge(map, 'right-net-wall', 'right') ?? goals.team2.backX;
  const audio = createBroBallAudio(scene);
  scene._movementTerrainAt = broBallMovementTerrain;

  scene.cameras.main.setBackgroundColor(SKY_TOP);
  const nets = createGoalNets(scene, { goals, Phaser, reduced });
  const platforms = reduced ? null : createHangingPlatforms(scene._mapObjects);
  const rows = crowdRows(map);
  const crowd = rows ? createCrowd(scene, Phaser, {
    rows, left, right, goals, reduced, skyY: roof - 190, depth: layerDepths(map.scenery.layers).stands + 0.25,
  }) : null;
  const effects = createBallEffects(scene, Phaser, { depth: RENDER_LAYERS.PLAYER + 2, reduced, floor });
  const shadow = scene.add.graphics().setDepth(RENDER_LAYERS.WORLD + 1.5);
  const sphere = createBallSprite(scene, Phaser, rules.radius * 2);
  const ball = scene.add.container(kickoff.x, kickoff.y, [sphere.sprite]).setDepth(RENDER_LAYERS.BRO_BALL);
  const comet = reduced ? null : createCometBow(scene, ball.depth + 0.1, rules.radius + 8, rules.radius + 10)
    .setVisible(false);
  // A soft halo behind a heated or freshly kicked ball.
  const halo = scene.add.image(kickoff.x, kickoff.y, 'bro-ball-glow').setDepth(ball.depth - 0.5).setAlpha(0);

  let lastImpact = null, impact = null, previousReset = null;
  let dropSince = null;
  let state = { ...kickoff, vx: 0, vy: 0 };

  function sample(frame) {
    const b = frame.bState.ball;
    if (!b) return;
    const a = frame.aState.ball || b;
    // A goal and a kickoff are discontinuities in the visual timeline.
    const alpha = a.reset === b.reset ? frame.alpha : frame.alpha >= 1 ? 1 : 0;
    const latest = alpha < 1 ? a : b;
    state = { ...latest, x: a.x + (b.x - a.x) * alpha, y: a.y + (b.y - a.y) * alpha };
    if (previousReset !== latest.reset) {
      if (previousReset !== null) {
        dropSince = scene.time.now;
        effects.clearContactArcs();
        audio.kickoff();
      }
      previousReset = latest.reset;
      impact = null;
    }
    if (lastImpact === null) {
      lastImpact = latest.impacts.at(-1)?.seq || 0;
      return;
    }
    for (const event of latest.impacts) {
      if (event.seq <= lastImpact) continue;
      lastImpact = event.seq;
      handleImpact(event);
    }
  }

  function handleImpact(event) {
    const now = scene.time.now;
    const onTurf = event.kind === 'wall' && event.y >= floor - rules.radius - 2 && Math.sin(event.angle) < -0.9;
    audio.impact(event, onTurf, getGameData()?.yourTeam);
    nets.strike(event, now);
    if (event.kind === 'goal') {
      const team = event.defendingTeam === 'team1' ? 'team2' : 'team1';
      const goal = goals[event.defendingTeam];
      effects.celebrateGoal(goal.x, event.y, TEAM_COLORS[team],
        event.defendingTeam === 'team1' ? 1 : -1, kickoff.x);
      crowd?.celebrate(team);
      if (!reduced) {
        scene.cameras.main.shake(260, 0.006);
      }
      onGoal?.();
      return;
    }
    impact = { ...event, at: now };
    if (event.kind === 'super' || event.kind === 'smash') {
      if (!reduced) scene.cameras.main.shake(140, 0.0045);
    }
    if (['kick', 'super', 'smash'].includes(event.kind)) sphere.tumble(event.kind === 'kick' ? 6 : 9);
    if (event.kind === 'wall' && event.y >= floor - rules.radius - 2) effects.dust(event.x, event.strength);
    effects.burst(event);
    crowd?.react(event);
  }

  function render() {
    const now = scene.time.now;
    const dt = Math.min(0.05, (scene.game.loop.delta || 16.67) / 1000);
    audio.update(state, dt, !!getModeState()?.goal);
    const local = getLocalPlayer();
    if (local) local._dashCooldownMs = rules.dashCooldownMs;
    nets.render(now, state);
    crowd?.update(now, dt, state, getModeState()?.score);
    platforms?.update(playerLookup.all(), dt);

    const visible = !state.destroyed;
    ball.setVisible(visible);
    halo.setVisible(visible);
    shadow.clear();
    if (!visible) {
      comet?.setVisible(false);
      effects.update(dt);
      return;
    }
    const age = impact ? now - impact.at : Infinity;
    const pace = Math.hypot(state.vx, state.vy);
    const angle = impact?.angle || 0;
    const scale = reduced ? 1 : deformationAt(impact, age, rules.maxSpeed);
    const footprint = rules.radius * Math.hypot(Math.sin(angle) * scale, Math.cos(angle) / scale);
    const x = state.x;
    const y = state.y + rules.radius >= floor - 0.5 ? floor - footprint : Math.min(state.y, floor - footprint);
    if (comet) {
      const threshold = rules.dashSpeed + (rules.smashSpeed - rules.dashSpeed) * 0.25;
      const intensity = Math.min(1, Math.max(0, (pace - threshold) / (rules.smashSpeed - threshold)));
      comet.setVisible(intensity > 0);
      if (intensity > 0) {
        comet.setPosition(x, y).setRotation(Math.atan2(state.vy, state.vx)).setAlpha(intensity);
      }
    }
    // A fresh ball drops in with a sparkle trail.
    const dropGlow = dropSince == null ? 0 : Math.max(0, 1 - (now - dropSince) / 900);
    if (dropGlow > 0 && Math.random() < 0.7) effects.sparkle(x, y, 24 + Math.random() * 10);

    const power = Math.min(1, (impact?.strength || 0) / rules.smashSpeed);
    const heat = power * Math.max(0, 1 - age / HEAT_MS);
    sphere.paint({ dt, vx: state.vx, radius: rules.radius, heat: heat * 0.35 });
    effects.trail({ x, y, vx: state.vx, vy: state.vy }, pace, heat, dt);
    effects.update(dt, { x, y });
    const haloAlpha = heat * 0.95;
    halo.setPosition(x, y).setAlpha(haloAlpha).setScale(0.9 + heat * 0.8 + (reduced ? 0 : Math.sin(now / 60) * 0.06 * heat))
      .setTint(power > 0.7 ? 0xff8a1f : 0xffd84a);

    const height = Math.max(0, floor - y - rules.radius);
    shadow.fillStyle(0x1d2a1c, 0.5 / (1 + height / 110))
      .fillEllipse(x, floor - 2, Math.max(14, 44 - height * 0.05), 8);

    ball.setPosition(x, y).setRotation(angle).setScale(scale, 1 / scale);
    sphere.sprite.setRotation(-angle);
  }

  return {
    sample,
    render,
    onPlayerDeath: ({ x }) => crowd?.reactToDeath(x),
    onCountdownFight() {
      audio.kickoff(true);
      for (const fighter of playerLookup.all()) {
        if (fighter.visible) spawnRespawnEffect(scene, fighter, { silent: true });
      }
    },
    get rally() { return getModeState()?.rally ?? 0; },
    get goalPaused() { return !!getModeState()?.goal; },
    get playedWinningGoal() { return audio.playedWinningGoal; },
    destroy() {
      audio.destroy();
      scene._movementTerrainAt = null;
      nets.destroy();
      crowd?.destroy();
      platforms?.destroy();
      effects.destroy();
      comet?.destroy();
      for (const object of [shadow, ball, halo]) object.destroy();
      sphere.destroy();
    },
  };
}
