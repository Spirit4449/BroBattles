const { characterBody } = require("../../../shared/duelGeometry");
const { bounds, stepBody } = require("./physics");
const movement = require("../../../shared/movementPhysics.json");
const { SD_DAMAGE_PER_SEC } = require('../gameRoomConfig');
const graphs = new WeakMap();
const DT = 1000 / 60;
const EDGE_STANCE_INSET = 14;

function standOn(surface, character, x) {
  const b = characterBody(character);
  return { char_class: character, x, y: surface.top - b.halfHeight - b.offsetY,
    vx: 0, vy: 0, grounded: true, platformId: surface.id };
}

function buildGraph(geometry, character, modifiers = {}) {
  let cache = graphs.get(geometry);
  if (!cache) { cache = new Map(); graphs.set(geometry, cache); }
  const key = `${character}:${modifiers.speedMult ?? 1}:${modifiers.jumpMult ?? 1}`;
  if (cache.has(key)) return cache.get(key);
  const surfaces = geometry.colliders.filter((r) => r.collision.up && r.right - r.left >= 12);
  const edges = new Map(surfaces.map((r) => [r.id, []]));
  for (const from of surfaces) {
    const body = characterBody(character);
    const margin = Math.min((from.right - from.left) / 3, body.halfWidth + 4);
    const span = from.right - from.left - margin * 2;
    const samples = Math.max(2, Math.min(12, Math.ceil(span / 120)));
    const starts = Array.from({ length: samples + 1 }, (_, i) => from.left + margin + span * i / samples);
    for (const x of starts) for (const direction of [-1, 0, 1]) for (const jump of [false, true]) for (const wallClimb of [false, true]) {
      if (!direction && !jump) continue;
      const p = standOn(from, character, x - body.offsetX);
      if (!canStandAt(geometry, from, character, p.x)) continue;
      const travel = prepareTraversal(p, { direction, jump, wallClimb }, geometry, modifiers, 0);
      if (!travel) continue;
      const list = edges.get(from.id);
      const edge = { ...travel, takeoffX: p.x };
      const existing = list.findIndex((e) => e.to === edge.to && e.jump === jump &&
        e.direction === direction && Math.abs(e.takeoffX - edge.takeoffX) < 100);
      // Retain different approaches and walking/drop alternatives to jumps.
      if (existing < 0) list.push(edge);
      else if (edge.duration < list[existing].duration) list[existing] = edge;
    }
  }
  const graph = { surfaces, edges, body: characterBody(character), geometry, character };
  // Bound modifier-specific cached graphs; default graphs are inexpensive to rebuild.
  if (cache.size >= 48) cache.delete(cache.keys().next().value);
  cache.set(key, graph);
  return graph;
}

function nearestSurface(graph, point) {
  return graph.surfaces.reduce((best, r) => {
    const x = Math.max(r.left, Math.min(r.right, point.x));
    const score = Math.abs(point.x - x) + Math.abs(point.y - r.top) * 1.5;
    return !best || score < best.score ? { surface: r, score } : best;
  }, null)?.surface;
}

// Sudden death damages the player origin (not the feet). It is a travel
// cost, never a connectivity constraint: a submerged landing can save a life.
function poisonDamage(frames, duration, poisonY, poisonAt, startMs = 0) {
  if (!frames?.length || !Number.isFinite(poisonY)) return 0;
  const dt = duration / frames.length;
  return frames.reduce((damage, frame, i) => damage +
    (frame.y >= (poisonAt ? poisonAt(startMs + i * dt) : poisonY) ? SD_DAMAGE_PER_SEC * dt / 1000 : 0), 0);
}

function routePoisonDamage(player, point, route, poisonY, poisonAt, holdMs = 2000) {
  let damage = 0, elapsed = 0, previous = player;
  const walk = (next) => {
    const duration = Math.abs(next.x - previous.x) / movement.maxSpeed * 1000;
    damage += poisonDamage(Array.from({ length: 20 }, () => previous), duration, poisonY, poisonAt, elapsed);
    elapsed += duration;
    previous = next;
  };
  for (const edge of route || []) {
    const first = edge.frames[0];
    if (first) walk(first);
    damage += poisonDamage(edge.frames, edge.duration, poisonY, poisonAt, elapsed);
    elapsed += edge.duration;
    previous = edge.frames.at(-1) || previous;
  }
  walk(point);
  damage += poisonDamage(Array.from({ length: 20 }, () => point), holdMs, poisonY, poisonAt, elapsed);
  return damage;
}

function findRoute(graph, from, to, poisonY = Infinity, options = {}) {
  if (!from || !to) return null;
  const atGoal = (id, x) => id === to && (!graph.geometry || !Number.isFinite(options.goalX) || !Number.isFinite(x) ||
    canWalkBetween(graph.geometry, graph.surfaces.find((s) => s.id === id), graph.character, x, options.goalX));
  if (atGoal(from, options.startX)) return [];
  const queue = [{ id: from, route: [], cost: 0, elapsed: 0, x: options.startX }], visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const item = queue.shift();
    if (atGoal(item.id, item.x)) return item.route;
    // Reaching the same platform on the other side of a wall is a different
    // navigation state. Collapsing both landings prevents routes around blocks.
    const state = `${item.id}:${Number.isFinite(item.x) ? Math.round(item.x) : ''}`;
    if (visited.has(state)) continue;
    visited.add(state);
    for (const edge of graph.edges.get(item.id) || []) {
      const fromSurface = graph.surfaces.find((s) => s.id === item.id);
      if (graph.geometry && Number.isFinite(item.x) &&
          !canWalkBetween(graph.geometry, fromSurface, graph.character, item.x, edge.takeoffX)) continue;
      if (options.blocked?.has(edgeKey(edge, item.id)) || options.blocked?.has(`${item.id}:${edge.to}`)) continue;
      const surface = graph.surfaces.find((s) => s.id === edge.to);
      if (!surface) continue;
      const penalty = Math.max(0, Number(options.edgeCost?.(edge, item.id)) || 0);
      const approach = Number.isFinite(item.x) ? Math.abs(edge.takeoffX - item.x) / movement.maxSpeed * 1000 : 0;
      const exposure = poisonDamage(edge.frames, edge.duration, poisonY, options.poisonAt, item.elapsed + approach) +
        poisonDamage(Array.from({ length: 20 }, () => ({ y: fromSurface.top - graph.body.offsetY - graph.body.halfHeight })),
          approach, poisonY, options.poisonAt, item.elapsed);
      queue.push({ id: edge.to, route: [...item.route, edge], x: edge.landingX,
        cost: item.cost + approach + edge.duration + penalty + exposure * 4,
        elapsed: item.elapsed + approach + edge.duration });
    }
  }
  return null;
}

// A first-frame overlap with a ledge is not a usable landing. Include the
// braking/turning motion so a route ends on ground the bot can actually hold.
function settleLanding(player, geometry, modifiers, now, poisonY = Infinity) {
  const p = { ...player }, platformId = p.platformId, frames = [];
  for (let i = 0; i < 36; i++) {
    const direction = safeWalkDirection(p, 0, geometry);
    frames.push({ direction, jumpPressed: false, x: p.x, y: p.y });
    p.flip = direction < 0;
    const result = stepBody(p, { direction }, geometry, DT, now + i * DT, modifiers);
    if (result.fell || !p.grounded || p.platformId !== platformId) return null;
    if (!direction && Math.abs(p.vx) < 12) {
      const surface = geometry.colliders.find((s) => s.id === platformId);
      return canStandAt(geometry, surface, p.char_class, p.x) ? { frames, end: p } : null;
    }
  }
  return null;
}

function edgeKey(edge, from = edge.from) {
  return `${from}:${edge.to}:${Math.round(edge.takeoffX)}:${edge.direction}:${Number(edge.jump)}:${Number(edge.wallClimb)}`;
}

// Graph samples establish connectivity. Validate the chosen motion again from
// the actual takeoff state, including residual velocity and wall-jump timing.
function prepareTraversal(player, edge, geometry, modifiers, now, poisonY = Infinity) {
  const p = { ...player }, frames = [];
  let airborne = false;
  for (let i = 0; i < 150; i++) {
    const at = now + i * DT;
    const wallJump = edge.wallClimb && p.wallSide && at >= (p._nextWallJump || 0);
    const direction = wallJump ? (p.wallSide === 'left' ? 1 : -1) : edge.direction;
    const input = { direction, jumpPressed: (edge.jump && i === 0) || !!wallJump };
    frames.push({ ...input, x: p.x, y: p.y });
    p.flip = direction < 0;
    const result = stepBody(p, input, geometry, DT, at, modifiers);
    if (result.fell) return null;
    airborne ||= !p.grounded;
    if (p.grounded && (airborne || p.platformId !== player.platformId)) {
      if (p.platformId === player.platformId || (edge.to && p.platformId !== edge.to)) return null;
      const settlement = settleLanding(p, geometry, modifiers, now + (i + 1) * DT, poisonY);
      if (!settlement) return null;
      frames.push(...settlement.frames);
      return { ...edge, to: p.platformId, landingX: settlement.end.x, frames, duration: frames.length * DT };
    }
  }
  return null;
}

// Check optional hops/dodges with the real solver before committing to them.
// Walks brake at ledges; jumps must actually land within the preview window.
function previewManeuver(player, intent, geometry, modifiers, now, poisonY = Infinity) {
  const p = { ...player };
  const frames = [];
  let airborne = !p.grounded;
  for (let i = 0; i < 78; i++) {
    const direction = safeWalkDirection(p, intent.direction, geometry);
    const input = { direction, jumpPressed: i === 0 && !!intent.jumpPressed };
    frames.push({ ...input, x: p.x, y: p.y });
    p.flip = direction < 0;
    const result = stepBody(p, input, geometry, DT, now + i * DT, modifiers);
    if (result.fell) return null;
    airborne ||= !p.grounded;
    if (airborne && p.grounded && i > 8) {
      const settlement = settleLanding(p, geometry, modifiers, now + (i + 1) * DT, poisonY);
      return settlement ? { frames: [...frames, ...settlement.frames], end: settlement.end } : null;
    }
    if (!intent.jumpPressed && !airborne && i >= 32) return { frames, end: p };
  }
  return p.grounded ? { frames, end: p } : null;
}

// Use the same facing envelope for tactical destinations and ledge braking.
// Narrow platforms still have a stable center; opposing edge corrections must
// never alternate just because the sprite is wider than the available stance.
function walkLimits(surface, character, inset = EDGE_STANCE_INSET) {
  const a = characterBody(character), b = characterBody(character, true);
  const footprint = Math.max(a.offsetX + a.halfWidth, b.offsetX + b.halfWidth) - Math.min(a.offsetX - a.halfWidth, b.offsetX - b.halfWidth);
  inset = Math.min(inset, Math.max(0, (surface.right - surface.left - footprint) / 4));
  const left = surface.left - Math.min(a.offsetX - a.halfWidth, b.offsetX - b.halfWidth) + inset;
  const right = surface.right - Math.max(a.offsetX + a.halfWidth, b.offsetX + b.halfWidth) - inset;
  return left <= right ? { left, right } : { left: (left + right) / 2, right: (left + right) / 2 };
}

function canStandAt(geometry, surface, character, x) {
  return [false, true].every((flip) => {
    const body = bounds({ ...standOn(surface, character, x), flip });
    return !geometry.colliders.some((r) => r.id !== surface.id &&
      (r.collision.left || r.collision.right || r.collision.down) &&
      body.right > r.left + 1 && body.left < r.right - 1 &&
      body.bottom > r.top + 1 && body.top < r.bottom - 1);
  });
}

function canWalkBetween(geometry, surface, character, fromX, toX) {
  if (!surface) return false;
  const body = bounds(standOn(surface, character, fromX));
  const other = bounds(standOn(surface, character, toX));
  const left = Math.min(body.left, other.left), right = Math.max(body.right, other.right);
  return !geometry.colliders.some((r) => r.id !== surface.id &&
    (toX >= fromX ? r.collision.left : r.collision.right) &&
    body.bottom > r.top + 2 && body.top < r.bottom - 2 && right > r.left + 1 && left < r.right - 1);
}

function safeWalkDirection(player, direction, geometry) {
  if (!player.grounded) return direction;
  const body = bounds(player);
  const supports = geometry.colliders.filter((r) => r.collision.up && Math.abs(r.top - body.bottom) < 5);
  const support = supports.find((r) => r.id === player.platformId) ||
    supports.find((r) => body.right > r.left && body.left < r.right);
  if (!support) return direction;
  // Adjacent coplanar colliders are continuous ground, not separate ledges.
  const span = { left: support.left, right: support.right };
  for (let i = 0; i < supports.length; i++) for (const r of supports) {
    if (r.left <= span.right + 1 && r.right >= span.left - 1) {
      span.left = Math.min(span.left, r.left); span.right = Math.max(span.right, r.right);
    }
  }
  const limits = walkLimits(span, player.char_class);
  const velocity = Number(player.vx) || 0;
  const stopping = velocity * Math.abs(velocity) / (2 * movement.dragGround);
  const stopX = player.x + stopping;
  if (player.x < limits.left - 3 || player.x > limits.right + 3) {
    const dx = (limits.left + limits.right) / 2 - player.x;
    return Math.sign(velocity) === Math.sign(dx) && Math.abs(dx) <= Math.abs(stopping) + 3 ? 0 : Math.sign(dx);
  }
  // Release input to brake. Reversing at every probe turns a safe hold into a
  // two-position oscillation, particularly on Lushy's narrow side platforms.
  if ((direction > 0 && stopX >= limits.right - 3) ||
      (direction < 0 && stopX <= limits.left + 3)) return 0;
  return direction;
}
module.exports = { poisonDamage, routePoisonDamage, buildGraph, findRoute, prepareTraversal, edgeKey, nearestSurface, standOn, walkLimits, canStandAt, canWalkBetween, safeWalkDirection, previewManeuver };
