import { ballRules as rules } from '../../../../shared/broBall';
import { clamp01 } from '../../../../shared/math.js';
import { playerAudioListener } from '../../audio/playerAudio';

const BALL_SOUND_GAIN = 1.15;

// Bring alternate samples to the same level before applying impact strength
// and distance. Leave the goal sting ahead of the crowd and rebound layers.
const impactSampleGain = {
  touch: 0.32,
  bounce: 0.24, 'bounce-2': 0.30,
  rebound: 0.37,
  kick: 0.60, 'kick-2': 0.32,
};

const impacts = {
  body: { clips: ['touch'], gain: 0.72 },
  turf: { clips: ['bounce', 'bounce-2'], gain: 0.86 },
  wall: { clips: ['rebound'], gain: 0.94 },
  kick: { clips: ['kick', 'kick-2'], gain: 0.96 },
  super: { clips: ['kick', 'kick-2'], gain: 0.96 },
  smash: { clips: ['kick', 'kick-2'], gain: 1 },
};

const key = name => `bro-ball-${name}`;

export function preloadBroBallAudio(scene, staticPath) {
  const names = new Set(['kickoff-whistle', 'final-whistle', 'goal-celebration', 'goal-victory', 'stands-applause', 'shot-swish']);
  for (const { clips } of Object.values(impacts)) {
    for (const clip of clips) names.add(clip);
  }
  for (const name of names) scene.load.audio(key(name), `${staticPath}/bro-ball/${name}.mp3`);
  for (const name of ['stands-crowd', 'roll']) {
    scene.load.audio(key(name), ['ogg', 'mp3'].map(ext => `${staticPath}/bro-ball/${name}.${ext}`));
  }
}

function ballMix(scene, source) {
  const listener = playerAudioListener(scene);
  if (!listener) return { gain: BALL_SOUND_GAIN, pan: 0 };
  const dx = source.x - listener.x;
  const distance = Math.hypot(dx, source.y - listener.y);
  // The objective stays audible across the pitch, including beyond the camera edge.
  return {
    gain: BALL_SOUND_GAIN * (0.46 + 0.54 / (1 + (distance / 575) ** 2)),
    pan: Math.max(-0.6, Math.min(0.6, dx / 950)),
  };
}

const timberIds = new Set(['platform-left', 'platform-right', 'wall-log-left', 'wall-log-right']);

function surfaceAt(scene, left, right, feet, tolerance) {
  return scene._mapObjects?.find(({ body }) => body?.enable && body.checkCollision?.up !== false &&
    left < body.right && right > body.left && Math.abs(feet - body.top) <= tolerance);
}

export function broBallMovementTerrain(scene, fighter, position) {
  const body = fighter?.body;
  if (!body) return;
  let { left, right, bottom } = body;
  // Replicated movement cues can arrive while the drawn body is still in the air.
  // Test the snapshot position with the same offsets Arcade uses for the body.
  if (Number.isFinite(position?.x) && Number.isFinite(position?.y) && body.offset) {
    left = position.x + fighter.scaleX * (body.offset.x - fighter.displayOriginX);
    right = left + body.width;
    bottom = position.y + fighter.scaleY * (body.offset.y - fighter.displayOriginY) + body.height;
  }
  const support = surfaceAt(scene, left, right, bottom, 8);
  const id = support?._mapObjectId;
  if (timberIds.has(id)) return 'wood';
  if (id && id !== 'pitch-floor') return 'hard';
}

export function createBroBallAudio(scene) {
  let crowd;
  let crowdGain = 0;
  let roll;
  let rollGain = 0;
  let lastApplause = -Infinity;
  let excitedUntil = 0;
  let playedWinningGoal = false;
  const playable = () => !document.hidden && !scene.sound?.locked && !scene._battleEnded;
  const play = (name, volume, rate = 1) =>
    playable() && scene.sound?.play(key(name), { volume, rate });

  function updateLoop(sound, name, volume, rate = 1, pan = 0) {
    if (volume < 0.004) {
      if (sound?.isPlaying) sound.stop();
      return sound;
    }
    if (!sound && scene.cache.audio.exists(key(name))) {
      sound = scene.sound.add(key(name), { loop: true });
    }
    if (sound?.isPlaying) {
      sound.setVolume(volume);
      sound.setRate(rate);
      sound.setPan?.(pan);
    } else {
      sound?.play({ volume, rate, pan });
    }
    return sound;
  }

  function stopRoll() {
    roll?.stop();
    rollGain = 0;
  }

  function stopLoops() {
    stopRoll();
    crowd?.stop();
    crowdGain = 0;
  }

  scene.events.on('pause', stopLoops);
  scene.game.events.on('blur', stopLoops);

  return {
    impact(event, onTurf, yourTeam) {
      if (!playable()) return;
      const time = scene.time.now;
      const { gain: ballGain, pan } = ballMix(scene, event);
      const kind = event.kind === 'wall' && onTurf ? 'turf' : event.kind === 'strike' ? 'kick' : event.kind;
      const soundKind = kind === 'goal' || kind === 'post' ? 'wall' : kind;
      const { clips, gain } = impacts[soundKind] || impacts.body;
      const strength = clamp01(event.strength / (kind === 'body' ? rules.kickSpeed : rules.dashSpeed));
      const rate = 1.08 - 0.22 * strength + (event.seq % 3 - 1) * 0.04;
      const clip = clips[event.seq % clips.length];
      const volume = clamp01(gain * ballGain * (0.40 + 0.60 * Math.sqrt(strength))) * impactSampleGain[clip];
      scene.sound?.play(key(clip), {
        // Keep the spatial rebound under the celebration's opening hit.
        volume: kind === 'goal' ? volume * 0.38 : volume, rate, pan,
      });
      if (kind === 'goal') {
        stopRoll();
        playedWinningGoal = !!event.winner && event.winner === yourTeam && play('goal-victory', 0.24) === true;
        if (!playedWinningGoal) play('goal-celebration', 0.25);
        if (event.winner) play('final-whistle', 0.14);
        lastApplause = time;
        excitedUntil = time + 4100;
        scene._bgmEnvelope?.fade(0.15, 75);
        return;
      }
      const powered = kind === 'super' || kind === 'smash';
      if (powered || (kind === 'kick' && event.strength >= rules.superKickSpeed)) {
        scene.sound?.play(key('shot-swish'), { volume: 0.19 * ballGain, rate, pan });
      }
      if (powered || kind === 'post') {
        excitedUntil = Math.max(excitedUntil, time + 1900);
        if (time - lastApplause > 8500) {
          play('stands-applause', kind === 'post' ? 0.10 : 0.15);
          lastApplause = time;
        }
      }
    },

    kickoff(opening = false) {
      stopRoll();
      if (opening) {
        play('stands-applause', 0.19);
        lastApplause = scene.time.now;
        excitedUntil = lastApplause + 2200;
      } else {
        play('kickoff-whistle', 0.19, 1.04);
        scene._bgmEnvelope?.fade(1, 850);
      }
    },

    update(ball, dt, goalPaused) {
      if (!playable()) {
        stopLoops();
        return;
      }
      const excitement = clamp01((excitedUntil - scene.time.now) / 1900);
      const crowdTarget = 0.052 + excitement * 0.021 + (goalPaused ? 0.012 : 0);
      crowdGain += (crowdTarget - crowdGain) * (1 - Math.exp(-dt * 7));
      crowd = updateLoop(crowd, 'stands-crowd', crowdGain);
      if (goalPaused || ball.destroyed) {
        stopRoll();
        return;
      }

      const supported = Math.abs(ball.vy) <= rules.settleSpeed &&
        surfaceAt(scene, ball.x - 2, ball.x + 2, ball.y + rules.radius, 7);
      const rollingPace = supported ? clamp01(Math.abs(ball.vx) / rules.kickSpeed) : 0;
      const { gain, pan } = ballMix(scene, ball);
      const rollTarget = gain * 0.075 * Math.sqrt(rollingPace);
      rollGain += (rollTarget - rollGain) * (1 - Math.exp(-dt * 20));
      roll = updateLoop(roll, 'roll', rollGain, 0.67 + rollingPace * 0.70, pan);
    },

    get playedWinningGoal() { return playedWinningGoal; },

    destroy() {
      scene.events.off('pause', stopLoops);
      scene.game.events.off('blur', stopLoops);
      stopLoops();
      roll?.destroy();
      crowd?.destroy();
    },
  };
}
