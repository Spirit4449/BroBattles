// Shared intentions use recent observations, never hidden enemy positions.
const { participantId } = require('../gameRoom/participants');
const hp = (p) => Math.max(0, Math.min(1, p.health / Math.max(1, p.maxHealth)));
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const active = (p) => p.isAlive && p.loaded && p.connected !== false;
const melee = (p) => ['thorg', 'draven'].includes(p.char_class);

function temperament(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return 0.35 + (hash % 101) / 250;
}

function updateTeamwork(brain, observed, now) {
  const { room, player } = brain;
  room._botTeamwork ||= new Map();
  let board = room._botTeamwork.get(player.team);
  if (!board) {
    board = { reports: new Map(), plans: new Map(), nextPlanAt: 0 };
    room._botTeamwork.set(player.team, board);
  }
  const allies = [...room.players.values()].filter((p) => p.team === player.team && active(p));
  const bots = allies.filter((p) => p.isBot).sort((a, b) => String(participantId(a)).localeCompare(String(participantId(b))));
  const id = participantId(player);
  if (observed) board.reports.set(id, observed);
  for (const [reporter, report] of board.reports) {
    if (!bots.some((p) => participantId(p) === reporter) || now - report.at > 900) board.reports.delete(reporter);
  }
  if (bots.length < 2) { board.plans.clear(); board.nextPlanAt = 0; return null; }
  const enemiesById = new Map();
  for (const report of board.reports.values()) {
    for (const enemy of report.enemies) {
      const previous = enemiesById.get(enemy.participantId);
      if (!previous || previous.at < report.at) enemiesById.set(enemy.participantId, { ...enemy, at: report.at });
    }
  }
  const enemies = [...enemiesById.values()];
  // Casualties and newly wounded teammates interrupt a plan immediately.
  const signature = allies.map((p) => `${participantId(p)}:${hp(p) < 0.4}`).sort().join('|') +
    '/' + enemies.map((p) => p.participantId).sort().join('|');
  if (now < board.nextPlanAt && board.signature === signature) return board.plans.get(id) || null;
  board.signature = signature;
  board.nextPlanAt = now + 2400;
  const previousPlans = board.plans;
  board.plans = new Map();
  for (const bot of bots) {
    const botId = participantId(bot);
    const friends = allies.filter((p) => p !== bot && distance(bot, p) < 650).length;
    const threats = enemies.filter((p) => distance(bot, p) < 650).length;
    const hurt = bot.lastDamagedAt > 0 && now - bot.lastDamagedAt < 1500;
    const previous = previousPlans.get(botId);
    const desired = Math.max(0.1, Math.min(0.95, temperament(botId) + (hp(bot) - 0.5) * 0.5 +
      Math.max(-2, Math.min(2, friends - threats)) * 0.09 - (hurt ? 0.15 : 0) +
      (enemies.some((p) => hp(p) < 0.35) ? 0.08 : 0)));
    const morale = previous ? previous.morale * 0.35 + desired * 0.65 : desired;
    board.plans.set(botId, { role: hp(bot) < 0.4 ? 'recover' : null, morale, assignedAt: now });
  }
  const available = () => bots.filter((p) => !board.plans.get(participantId(p)).role);
  const assign = (p, fields) => Object.assign(board.plans.get(participantId(p)), fields);
  const wounded = allies.filter((p) => hp(p) < 0.4 &&
    enemies.some((e) => distance(e, p) < 650)).sort((a, b) => hp(a) - hp(b))[0];
  if (wounded) {
    const defender = available().filter((p) => p !== wounded)
      .sort((a, b) => distance(a, wounded) - distance(b, wounded))[0];
    const threat = [...enemies].sort((a, b) => distance(a, wounded) - distance(b, wounded))[0];
    if (defender) {
      assign(defender, { role: 'defend', buddyId: participantId(wounded), targetId: threat.participantId });
      const recovery = board.plans.get(participantId(wounded));
      if (recovery) recovery.buddyId = participantId(defender);
    }
  }
  const center = { x: allies.reduce((n, p) => n + p.x, 0) / allies.length,
    y: allies.reduce((n, p) => n + p.y, 0) / allies.length };
  const target = [...enemies].sort((a, b) => (hp(a) * 300 + distance(a, center) * 0.3) -
    (hp(b) * 300 + distance(b, center) * 0.3))[0];
  const fighters = available();
  const confidence = fighters.reduce((n, p) => n + board.plans.get(participantId(p)).morale, 0) / Math.max(1, fighters.length);
  const push = !!target && !wounded && confidence > 0.58 && fighters.filter((p) => p.ammoState?.charges > 0).length >= 2;
  // Role persistence breaks ties, while health and morale can replace a leader.
  fighters.sort((a, b) => {
    const value = (p) => board.plans.get(participantId(p)).morale + (melee(p) ? 0.2 : 0) +
      (['vanguard', 'anchor'].includes(previousPlans.get(participantId(p))?.role) ? 0.08 : 0);
    return value(b) - value(a);
  });
  const leader = fighters.shift();
  if (leader) {
    const side = target ? (leader.x <= target.x ? -1 : 1) : 1;
    assign(leader, { role: push ? 'vanguard' : 'anchor', targetId: target?.participantId, side,
      anchor: { x: leader.x, y: leader.y } });
    // A pair attacks from opposite angles; with three, one stays near the lead.
    fighters.forEach((bot, i) => {
      const support = fighters.length > 1 && i === 0;
      assign(bot, { role: support ? 'support' : 'flank', buddyId: participantId(leader),
        targetId: target?.participantId, side: support ? side : -side });
      if (support || !board.plans.get(participantId(leader)).buddyId) {
        board.plans.get(participantId(leader)).buddyId = participantId(bot);
      }
    });
  }
  for (const plan of board.plans.values()) plan.strategy = wounded ? 'protect' : push ? 'push' : 'hold';
  return board.plans.get(id) || null;
}

function teamPosition(brain, target) {
  const plan = brain.teamPlan;
  if (!plan || !target || brain.retreating) return null;
  const buddy = [...brain.room.players.values()].find((p) => participantId(p) === plan.buddyId && active(p));
  const preferred = melee(brain.player) ? 160 : 340;
  if (plan.role === 'defend' && buddy) {
    const d = Math.max(1, distance(buddy, target));
    return { x: buddy.x + (target.x - buddy.x) / d * Math.min(140, d * 0.4), y: buddy.y, weight: 0.85 };
  }
  if (plan.role === 'support' && buddy) {
    return { x: buddy.x + (plan.side || 1) * 170, y: buddy.y, weight: 0.55 };
  }
  if (plan.role === 'flank') return { x: target.x + plan.side * preferred, y: target.y, weight: 0.8 };
  if (plan.role === 'vanguard') {
    const buddyReady = !buddy || distance(buddy, brain.player) < 550;
    return { x: target.x + plan.side * (buddyReady ? preferred * 0.7 : preferred * 1.35), y: target.y, weight: 0.55 };
  }
  if (plan.role === 'anchor') return { ...plan.anchor, weight: 0.45 };
  return null;
}

module.exports = { updateTeamwork, teamPosition };
