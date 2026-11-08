import { basicAim, requestBasic } from "../../../shared/combat/combat";
import { isMovementSuppressed } from "../../../shared/combat/runtime/abilityRuntimeManager";
import { remoteAnimationLockUntil } from "../../game/characters/shared/animationState";
import { PreviewSession } from '../../../shared/combat/previewSession';
import { snapshotActive } from '../../../shared/combat/runtime/effects/effectManager';
import { CombatClock } from '../../../shared/characters/huntressReplication';
import { createCharacterNetworkAdapters } from "../../game/characters/networkRegistry";
import { handleRemoteAttack, getCharacterSocketEvents, getCharacterEffectTickSounds,
  applyCharacterPowerupFx, drawCharacterPowerupAura, playCharacterSound } from '../../game/characters';
import { performSpecial } from '../../game/characters/special';
import { createPowerupRenderer } from '../../game/powerups/powerupRenderer';
import { POWERUP_COLORS, createPowerupTickSounds } from '../../game/powerups/powerupConfig';
import { playPlayerSound } from '../../game/audio/playerAudio';
import { playHitFeedback } from '../../game/characters/shared/hitFeedback';
import { createShowcaseDirector, seededRandom } from './showcaseDirector';

// Presentation consumes match events. No damage, collision, ammo, status or
// ability timing is authored here.
export function createShowcaseFight({ scene, fighters, halfWidth, face, play, movementStep, showHealthChange, showDefeat, onRoundEnd, autoplay = true, initialCharge = {} }) {
  const byId = new Map(fighters.map(f => [f.id, f]));
  const wrappers = Object.fromEntries(fighters.map(f => [f.id, { opponent: f.sprite, username: f.id, character: f.character }]));
  const context = { localUsername: '', opponentPlayersRef: wrappers, teamPlayersRef: {}, findSprite: id => byId.get(id)?.sprite };
  const clock = new CombatClock();
  // Local simulation has no transport latency. Render at its exact clock,
  // including pauses, instead of estimating an offset from wall time.
  clock.now = () => session?._simulationMono || 0;
  const options = { clock, ensureEpoch: epoch => { if (clock.epoch !== epoch) clock.reset(epoch); } };
  const networks = createCharacterNetworkAdapters({ ...options, arrowLength: 28 });
  const characterEvents = new Map(getCharacterSocketEvents());
  const tickSounds = createPowerupTickSounds(getCharacterEffectTickSounds());
  let session, elapsed = 0, endedAt = null, presentationUntil = 0, disposed = false;
  scene._powerupVisuals = {}; scene._deathDropVisuals = {};
  const powerups = createPowerupRenderer({ scene, Phaser: window.Phaser, colors: POWERUP_COLORS,
    getUsername: () => '', getGameData: () => ({}), getLocalPlayer: () => null,
    getOpponentPlayers: () => wrappers, getTeamPlayers: () => ({}),
    getLatestPowerups: () => [], getLatestDeathDrops: () => [], getMapObjects: () => [], getDead: () => false,
    getLatestPlayerEffects: () => Object.fromEntries([...session.players.values()].map(p => [p.name, p.isAlive ? snapshotActive(p, session.now) : {}])),
    powerupCollectQueue: [], deathdropCollectQueue: [], shieldImpactQueue: [], socket: null,
    applyCharacterPowerupFx, drawCharacterPowerupAura,
  });
  scene._powerupAuraGraphics = scene.add.graphics().setDepth(31);
  scene._powerupFxGraphics = scene.add.graphics().setDepth(32);

  function receive(type, packet) {
    if (disposed) return;
    if (type === 'game:action') {
      const fighter = byId.get(packet.playerName);
      if (!fighter) return;
      if (networks.some(network => network.handlePacket(scene, packet, context))) return;
      if (packet.action.type === 'character-hit-confirm') {
        const victim = byId.get(packet.action.target);
        if (victim) playCharacterSound(scene, fighter.character, 'hit', {}, victim.sprite);
        return;
      }
      handleRemoteAttack(scene, fighter.character, packet.action, { opponent: fighter.sprite });
    } else if (type === 'player:special') {
      presentationUntil = scene.time.now + 3500;
      const fighter = byId.get(packet.username);
      if (!fighter) return;
      const allies = fighters.filter(f => f.team === fighter.team && f !== fighter).map(f => f.sprite);
      const enemies = fighters.filter(f => f.team !== fighter.team).map(f => f.sprite);
      performSpecial(fighter.character, scene, fighter.sprite, allies, enemies, fighter.id, null, false, packet.aim);
    } else if (type === 'health-update') {
      const fighter = byId.get(packet.username);
      const delta = packet.health - fighter.health;
      fighter.health = packet.health;
      if (delta) showHealthChange(fighter, delta);
      if (delta < 0) playHitFeedback(scene, fighter.sprite, { hitstopMs: packet.cause === 'combat' ? 45 : 15 });
    } else if (type === 'player:death') {
      const fighter = byId.get(packet.username);
      fighter.health = 0; fighter.defeated = true; showDefeat(fighter);
    } else if (type === 'powerup:tick') {
      const sound = tickSounds[packet.type];
      if (sound) playPlayerSound(scene, byId.get(packet.username)?.sprite, sound.key, sound.options);
    } else if (characterEvents.has(type)) {
      characterEvents.get(type)({ scene, findSprite: context.findSprite }, packet);
    }
  }
  session = new PreviewSession(fighters.map(f => ({ id: f.id, name: f.name, character: f.character, level: f.level, team: f.team, role: f.role, x: f.homeX, superCharge: initialCharge[f.id] || 0 })),
    { halfWidth, onEvent: receive, random: seededRandom(19) });
  scene.showcaseSession = session;
  const bootstrap = session.bootstrap();
  for (const network of networks) { network.configure(bootstrap[network.bootstrapKey]); network.attach(scene, context); }
  const direct = createShowcaseDirector(session, { halfWidth: halfWidth - 30 });
  function update(time, delta) {
    // Pause rather than fast-forward fights after a suspended/background tab.
    elapsed += Math.min(delta, 100);
    while (elapsed >= session.FIXED_DT_MS) {
      session.step(autoplay ? direct : () => {
        for (const f of fighters) {
          const p = session.players.get(f.id);
          if (!isMovementSuppressed(p, session.now)) { p.x = f.sprite.x; p.y = p.groundY + f.sprite.y - f.standY; }
          p.flip = f.sprite.flipX;
        }
      });
      elapsed -= session.FIXED_DT_MS;
    }
    for (const fighter of fighters) {
      const p = session.players.get(fighter.id), sprite = fighter.sprite;
      fighter.charge = p.superCharge / p.maxSuperCharge;
      fighter.ammo = p.ammoState;
      fighter.status = snapshotActive(p, session.now);
      if (autoplay || isMovementSuppressed(p, session.now)) sprite.setPosition(p.x, fighter.standY + p.y - p.groundY);
      sprite._powerupEffects = fighter.status;
      if (!p.isAlive || !autoplay) continue;
      face(fighter, p.flip ? -1 : 1);
      const moving = Math.abs(p.vx) > 10;
      // playSpriteAnimation respects an active action's lock.
      if (performance.now() >= remoteAnimationLockUntil(sprite)) play(fighter, !p.grounded ? (p.vy < 0 ? 'jumping' : 'falling') : moving ? 'running' : 'idle');
      if (moving && p.grounded && time >= (fighter.nextDustAt || 0)) {
        fighter.nextDustAt = time + 140; movementStep(fighter, Math.sign(p.vx));
      }
    }
    for (const network of networks) network.observe({ snapshotEpoch: session._snapshotEpoch, sentMono: performance.now(), tMono: session._simulationMono });
    powerups.renderPowerupsAndEffects();
    const teams = new Set([...session.players.values()].filter(p => p.isAlive && p.role !== 'bystander').map(p => p.team));
    if (autoplay && teams.size < 2) endedAt ??= time;
    // End clearly as a round, then rebuild; never heal a fighter mid-hit.
    if (endedAt !== null && time - endedAt > 2200 && time > presentationUntil) {
      // Keep earned charge between practice rounds, so low-ammo kits can
      // build their super across opponents without an artificial refill.
      const charge = Object.fromEntries([...session.players.values()].filter(p => p.role === 'featured').map(p => [p.name, p.superCharge]));
      dispose(); onRoundEnd(charge);
    }
  }
  scene.events.on('update', update);
  function dispose() {
    if (disposed) return;
    disposed = true; scene.events.off('update', update);
    for (const network of networks) network.reset();
    session.dispose();
    scene._powerupAuraGraphics?.destroy(); scene._powerupFxGraphics?.destroy();
    scene._powerupAuraGraphics = scene._powerupFxGraphics = null;
    delete scene.showcaseSession;
  }
  return { session, dispose,
    attack(fighter) {
      const p = session.players.get(fighter.id);
      const target = { ...p, x: p.x + (p.flip ? -200 : 200), vx: 0, vy: 0 };
      return requestBasic(session, p, target, { prediction: 0, aimError: 0 }, () => 0.5, session.now);
    },
    special(fighter) {
      const p = session.players.get(fighter.id);
      // The Animations tab explicitly selects a super, like a training reset.
      p.superCharge = p.maxSuperCharge;
      const aim = basicAim(p, { ...p, x: p.x + (p.flip ? -220 : 220) }, { prediction: 0 }, () => 0.5, session);
      return session.requestSpecial(p.participantId, { id: `demo:${++p._botActionSeq}`, aim });
    },
  };
}
