// In-process host for the same combat runtimes used by GameRoom. No sockets,
// accounts, rewards, or timers: callers advance a clock and consume events.
const characters = require('../characters');
const stats = require('../characters/characterStats');
const { characterBody } = require('../physics/characterBody');
const { FIXED_DT_MS } = require('../gameConstants');
const characterCombat = require('./runtime/characterCombatRegistry');
const actions = require('./runtime/characterActionRegistry');
const { requestSpecial } = require('./runtime/actions');
const { tickActiveAttacks } = require('./runtime/attackRuntimeManager');
const abilities = require('./runtime/abilityRuntimeManager');
const effects = require('./runtime/effects/effectManager');
const { applyPowerupToPlayer } = require('./runtime/effects/powerupApplication');
const damage = require('./runtime/damageResolver');
const validation = require('./runtime/combatValidation');
const { advanceAmmo } = require('./combat');

function createPreviewPlayer(entry) {
  const character = entry.character, level = entry.level || 1;
  const tuning = stats.getCharacterStats(character), body = characterBody(character);
  const maxHealth = stats.getHealth(character, level);
  return {
    participantId: entry.id, socketId: entry.id, name: entry.id, displayName: entry.name,
    char_class: character, team: entry.team, role: entry.role || 'featured', level, isBot: true,
    loaded: true, connected: true, isAlive: true, grounded: true, flip: entry.team !== 'team1',
    x: entry.x || 0, y: -body.offsetY - body.halfHeight, vx: 0, vy: 0,
    groundY: -body.offsetY - body.halfHeight,
    _lastWidth: body.displayWidth, _lastHeight: body.displayHeight,
    _bodyHalfWidth: body.halfWidth, _bodyHalfHeight: body.halfHeight,
    _bodyCenterOffsetX: body.offsetX, _bodyCenterOffsetY: body.offsetY,
    health: maxHealth, maxHealth, baseDamage: stats.getDamage(character, level),
    specialDamage: stats.getSpecialDamage(character, level),
    superCharge: entry.superCharge || 0, maxSuperCharge: stats.getSuperChargeHits(character),
    effects: {}, activeEffects: {}, _botActionSeq: 0, _botActionUntil: 0,
    ammoState: { capacity: tuning.ammoCapacity, charges: tuning.ammoCapacity,
      cooldownMs: tuning.ammoCooldownMs, reloadMs: tuning.ammoReloadMs, reloadTimerMs: 0, nextFireInMs: 0 },
  };
}

class PreviewSession {
  constructor(roster, { onEvent = () => {}, random = Math.random, halfWidth = 260 } = {}) {
    this.matchId = 'preview'; this.status = 'active'; this.FIXED_DT_MS = FIXED_DT_MS;
    // Nonzero epoch also preserves duplicate-hit windows on the first frame.
    this.now = 100000; this._simulationMono = 0; this._tickId = 0;
    this.combatClock = { now: () => this.now, mono: () => this._simulationMono };
    this.combatRandom = random; this.onEvent = onEvent;
    this.players = new Map(roster.map(entry => [entry.id, createPreviewPlayer(entry)]));
    this.geometry = { world: { x: -halfWidth, y: -600, width: halfWidth * 2, height: 850 },
      colliders: [{ left: -halfWidth, right: halfWidth, top: 0, bottom: 200, collision: { up: true } }] };
    this._scheduledActions = []; this._activeAttacks = [];
    this.io = { to: () => ({ emit: (type, payload) => this.emit(type, payload) }) };
    characterCombat.initialize(this);
  }
  onCombatError(error) { throw error; }
  emit(type, payload) { this.onEvent(type, payload); }
  scheduleAction(callback, delayMs, now = this.now) { this._scheduledActions.push({ callback, at: now + delayMs }); }
  handlePlayerAction(id, action) {
    const player = this.players.get(id);
    if (!player?.isAlive || this.status !== 'active') return false;
    if (characterCombat.ownsAction(this, player, action)) return characterCombat.requestAction(this, player, action);
    if (Math.max(player._controlLockUntil || 0, player._attackInterruptedUntil || 0) > this.now) return false;
    if (action.type !== characters.characterDefinitions[player.char_class]?.basicAction) return false;
    player.lastCombatAt = this.now;
    const result = actions.handleCharacterAction(this, player, action, this.now);
    if (!result?.handled) actions.broadcastAction(this, player, action, this.now);
    return true;
  }
  requestSpecial(id, payload) { return requestSpecial(this, id, payload); }
  handleHit(id, payload, options) { return damage.handleHit(this, id, payload, options); }
  _getAttackMaxDist(character, type) { return validation.getAttackMaxDist(character, type); }
  _recordCombatStat(player, delta) {
    if (!player) return;
    player.combatStats ||= {};
    for (const [key, value] of Object.entries(delta)) player.combatStats[key] = (player.combatStats[key] || 0) + value;
  }
  _broadcastHealthUpdate(player, details) { this.emit('health-update', { username: player.name, health: player.health, ...details }); }
  _maybeBroadcastHealth(player, now, details) { this._broadcastHealthUpdate(player, details); }
  _handlePlayerDeath(player, details) {
    if (!player.isAlive) return;
    player.isAlive = false; player.vx = player.vy = 0;
    player.activeEffects = {}; player.effects = {};
    this.emit('player:death', { username: player.name, ...details });
  }
  _applyPowerupToPlayer(player, type, now, params) { applyPowerupToPlayer(this, player, type, now, params); }
  applyKnockback(player, impulse) {
    player.vx = Number(impulse.amountX) || 0; player.vy = Number(impulse.amountY) || 0;
    player._previewImpulseUntil = this.now + 250; player.grounded = false;
    this.emit('player:knockback', { username: player.name, ...impulse });
  }
  broadcastSnapshot() {}
  _checkVictoryCondition() {}
  step(beforeCombat = () => {}) {
    if (this.status !== 'active') return;
    this.now += FIXED_DT_MS; this._simulationMono += FIXED_DT_MS; this._tickId++;
    const due = this._scheduledActions.filter(action => action.at <= this.now);
    this._scheduledActions = this._scheduledActions.filter(action => action.at > this.now);
    for (const action of due) action.callback();
    for (const player of this.players.values()) if (player.isAlive) advanceAmmo(player, FIXED_DT_MS);
    beforeCombat(this);
    abilities.tickActiveAbilities(this, this.now);
    tickActiveAttacks(this, this.now);
    characterCombat.tick(this);
    for (const player of this.players.values()) if (player.isAlive) effects.tickAll(player, this, this.now);
  }
  bootstrap() { return characterCombat.bootstrap(this); }
  dispose() {
    this.status = 'disposed'; characterCombat.dispose(this);
    this._scheduledActions.length = 0; this._activeAttacks.length = 0; this.onEvent = () => {};
  }
}
module.exports = { PreviewSession, createPreviewPlayer };
