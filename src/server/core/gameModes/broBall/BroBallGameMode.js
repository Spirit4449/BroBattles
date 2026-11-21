const { BaseGameMode } = require('../BaseGameMode');
const { advanceBall } = require('./physics');
const { ballRules: rules, broBallField } = require('../../../../shared/broBall');
const { characterDefinitions } = require('../../../../shared/characters');
const { getResolvedCharacterSpecialConfig } = require('../../../../shared/characters/characterTuning');
const { getResolvedAttackDescriptor } = require('../../../../shared/combat/runtime/attackDescriptorResolver');
const characterCombat = require('../../../../shared/combat/runtime/characterCombatRegistry');
const { participantId } = require('../../../../shared/combat/runtime/participants');
const { respawnPlayer } = require('../../gameRoom/respawn');
const { correctPosition } = require('../../gameRoom/inputManager');

function kickWindowMs(character, special) {
  if (!special) {
    const attack = getResolvedAttackDescriptor(characterDefinitions[character]?.basicAction);
    const startup = attack?.actionFlow?.startupMs || 0;
    const activeEnd = (attack?.runtime?.windupMs || 0) + (attack?.runtime?.activeWindowMs || 0);
    return Math.max(startup + rules.kickWindowMs, activeEnd);
  }

  const config = getResolvedCharacterSpecialConfig(character);
  if (character === 'ninja') return (config.swarm.count - 1) * config.swarm.releaseMs + rules.kickWindowMs;
  const startup = config.inferno?.firstDamageDelayMs ||
    config.hook?.castDelayMs || 0;
  return startup + rules.kickWindowMs;
}

class BroBallGameMode extends BaseGameMode {
  usesModeClock = true;

  get isPractice() {
    return this.room.matchData.editorSoloPlaytest === true;
  }

  get layout() {
    return this.room.mapSnapshot.map.objectiveLayout.broBall;
  }

  get field() {
    if (this._field?.geometry !== this.room.geometry) {
      this._field = { geometry: this.room.geometry, ...broBallField(this.room.geometry, this.layout) };
    }
    return this._field;
  }

  createRoomState() {
    return {
      ball: { ...this.layout.kickoff, vx: 0, vy: 0 },
      reset: 0,
      impactSequence: 0,
      impacts: [],
      score: { team1: 0, team2: 0 },
      playerGoals: {},
      phase: 'regulation',
      remainingMs: rules.regulationMs,
      goal: null,
    };
  }

  onStart() {
    this.previousBodies = new Map();
    this.kicks = new Map();
  }

  getMatchDurationMs() {
    return rules.regulationMs;
  }

  supportsSuddenDeath() {
    return false;
  }

  onPlayerDeath(player) {
    this.kicks?.delete(participantId(player));
    this.previousBodies?.delete(participantId(player));
    return { shouldCheckVictory: false };
  }

  getRespawnPlan(player) {
    return { enabled: true, delayMs: rules.respawnMs, position: this.room.spawnStateFor(player) };
  }

  isCombatPaused() {
    return !!this.getModeState().goal;
  }

  // Client actions name the rally they were aimed in, so one sent before a
  // kickoff cannot land after it. Bots act on the server's live state.
  acceptsCombatInput(data, player = null) {
    const state = this.getModeState();
    return !state.goal && (player?.isBot === true || data?.broBallRally === state.reset);
  }

  getBotObjective(player) {
    return {
      ...super.getBotObjective(player),
      targetTeam: player?.team === 'team1' ? 'team2' : 'team1',
      target: { id: 'ball', type: 'ball', ...this.getModeState().ball },
    };
  }

  canKick(player) {
    return this.room._loopRunning && !this.getModeState().goal && this.kicks && player.connected !== false &&
      player.loaded && player.isAlive && !(player._controlLockUntil > Date.now());
  }

  armKick(player, special, windowMs) {
    const id = participantId(player);
    this.kicks.set(id, {
      special,
      untilTick: this.room.tickId + Math.ceil(windowMs / this.room.FIXED_DT_MS),
      interruptSeq: player._attackInterruptSeq || 0,
      consume: () => this.kicks.delete(id),
    });
  }

  // Give a close-range kick from input time through the active swing or release.
  onAttackAccepted(player, _data, special = false) {
    if (this.canKick(player)) this.armKick(player, special, kickWindowMs(player.char_class, special));
  }

  // Bots kick without firing an attack, at about the rate people can attack.
  botKick(player) {
    const now = Date.now();
    if (!this.canKick(player) || now < (player._broBallKickAt || 0) + rules.botKickCooldownMs) return false;
    player._broBallKickAt = now;
    this.armKick(player, false, rules.kickWindowMs);
    return true;
  }

  pushImpact(kind, impact) {
    const state = this.getModeState();
    state.impacts.push({ seq: ++state.impactSequence, kind, ...impact, expires: this.room.tickId + 24 });
    if (state.impacts.length > 8) state.impacts.shift();
  }

  sampleBodies(now) {
    const current = new Map();
    const dt = this.room.FIXED_DT_MS / 1000;
    const bodies = [];
    for (const player of this.room.players.values()) {
      if (!player.isAlive || !player.loaded || player.connected === false ||
          !Number.isFinite(player.x) || !Number.isFinite(player.y)) continue;
      const id = participantId(player);
      const x = player.x + (player._bodyCenterOffsetX || 0);
      const width = player._bodyHalfWidth || 26;
      const halfHeight = player._bodyHalfHeight || 42;
      // Sweep from the previous feet so the hitbox expanding upward doesn't
      // count as player travel.
      const feet = player.y + (player._bodyCenterOffsetY || 0) + halfHeight;
      const previous = this.previousBodies.get(id) || { x, feet, halfHeight };
      const dx = x - previous.x, dy = feet - previous.feet;
      // Accepted position packets can cover multiple steps. Sweep that travel,
      // but cap the velocity used to impart momentum to the ball.
      const locked = player._controlLockUntil > now;
      const acceptedDash = player._dashUntil > 0 && player.dashSeq !== player._broBallDashSeq;
      const chasing = dx * player.dashX + dy * player.dashY > 0;
      const dashLive = now < player._dashUntil || (chasing && now < player._dashUntil + rules.dashGraceMs);
      const facing = player.flip ? -1 : 1;
      const dash = !locked && acceptedDash && dashLive
        ? { x: player.dashX, y: player.dashY, facing } : null;
      let kick = this.kicks.get(id);
      if (kick && (locked || kick.untilTick < this.room.tickId ||
          kick.interruptSeq !== (player._attackInterruptSeq || 0))) {
        kick.consume();
        kick = null;
      }
      current.set(id, { x, feet, halfHeight });
      bodies.push({
        id, dash, kick, facing, team: player.team, name: player.name,
        standingUp: halfHeight > previous.halfHeight,
        consumeDash: () => { player._broBallDashSeq = player.dashSeq; },
        left: previous.x - width, right: previous.x + width,
        top: previous.feet - halfHeight * 2, bottom: previous.feet,
        vx: dx / dt, vy: dy / dt,
      });
    }
    this.previousBodies = current;
    return bodies.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  tick(now) {
    if (this.room.status !== 'active') return;
    const state = this.getModeState();
    if (state.goal) {
      if (now >= state.goal.until) {
        if (state.goal.winner && !this.isPractice) {
          this.finish(state.goal.winner);
        } else {
          this.resetKickoff(now);
        }
      } else {
        this.advanceScoredBall(state);
      }
      return;
    }

    const dtMs = this.room.FIXED_DT_MS;
    while (state.impacts.length && state.impacts[0].expires < this.room.tickId) state.impacts.shift();
    if (!this.isPractice) state.remainingMs = Math.max(0, state.remainingMs - dtMs);
    for (const player of this.room.players.values()) player._dashCooldownMs = rules.dashCooldownMs;
    const bodies = this.sampleBodies(now);
    const defendingTeam = advanceBall(state.ball, dtMs / 1000, this.field, bodies,
      (kind, impact) => this.pushImpact(kind, impact));
    if (defendingTeam) {
      this.scoreGoal(defendingTeam, now);
      return;
    }
    this.checkClock();
  }

  scoreGoal(defendingTeam, now) {
    const state = this.getModeState();
    const team = defendingTeam === 'team1' ? 'team2' : 'team1';
    state.score[team]++;
    const touch = state.ball.lastTouch;
    if (touch?.team === team && touch.name) {
      state.playerGoals[touch.name] = (state.playerGoals[touch.name] || 0) + 1;
    }
    const winner = !this.isPractice && (state.score[team] >= rules.scoreLimit || state.phase === 'overtime')
      ? team : null;
    state.goal = {
      defendingTeam, team, until: now + rules.goalPauseMs, winner,
    };
    const { x, y, vx, vy } = state.ball;
    this.pushImpact('goal', { defendingTeam, winner, x, y, strength: Math.hypot(vx, vy) });
    for (const player of this.room.players.values()) player.vx = player.vy = 0;
    this.room.broadcastSnapshot();
    this.room.broadcastWorldState();
  }

  advanceScoredBall(state) {
    const { ball, goal } = state;
    if (ball.destroyed) return;
    advanceBall(ball, this.room.FIXED_DT_MS / 1000, this.field, [],
      (kind, impact) => this.pushImpact(kind, impact), this.field.goals[goal.defendingTeam]);
    if (ball.vx === 0 && ball.vy === 0) {
      ball.destroyed = true;
      this.room.broadcastSnapshot();
    }
  }

  clearRally() {
    const room = this.room;
    room.activeAttacks = [];
    room._scheduledActions.length = 0;
    characterCombat.dispose(room);
    room.damageHitboxes?.clear();
    this.kicks.clear();
    this.previousBodies.clear();
    for (const p of room.players.values()) {
      clearTimeout(p._respawnTimeout);
      p._respawnTimeout = null;
    }
  }

  resetKickoff(now) {
    const state = this.getModeState();
    this.clearRally();
    state.reset++;
    // A free drop from high over the centre, drifting a little to one side.
    state.ball = { ...this.layout.kickoff, vx: (Math.random() * 2 - 1) * rules.kickoffDrift, vy: 0 };
    state.goal = null;
    state.impacts = [];
    for (const p of this.room.players.values()) {
      respawnPlayer(this.room, p, { position: this.room.spawnStateFor(p), kickoff: true }, now);
      correctPosition(this.room, p, p._lastPositionSeq, { reason: 'kickoff', grounded: p.grounded, vx: 0, vy: 0 });
    }
    this.checkClock();
    this.room.broadcastSnapshot();
    this.room.broadcastWorldState();
  }

  checkClock() {
    const state = this.getModeState();
    if (this.isPractice || state.remainingMs > 0) return;
    const { team1, team2 } = state.score;
    if (team1 !== team2) {
      this.finish(team1 > team2 ? 'team1' : 'team2');
    } else if (state.phase === 'regulation') {
      state.phase = 'overtime';
      state.remainingMs = rules.overtimeMs;
    } else {
      this.finish(null);
    }
  }

  finish(winnerTeam) {
    this.room.finishGame(winnerTeam, { broBallScore: { ...this.getModeState().score } });
  }

  buildMovementState() {
    const state = this.getModeState();
    return {
      x: Math.round(state.ball.x * 10) / 10,
      y: Math.round(state.ball.y * 10) / 10,
      vx: Math.round(state.ball.vx),
      vy: Math.round(state.ball.vy),
      destroyed: !!state.ball.destroyed,
      reset: state.reset,
      impacts: state.impacts.map(({ expires, ...impact }) => impact),
    };
  }

  buildModeState() {
    const state = this.getModeState();
    return {
      type: this.modeId,
      score: { ...state.score },
      playerGoals: { ...state.playerGoals },
      phase: state.phase,
      goal: state.goal?.team || null,
      remainingMs: Math.ceil(state.remainingMs),
      rally: state.reset,
      practice: this.isPractice,
    };
  }
}

module.exports = { BroBallGameMode };
