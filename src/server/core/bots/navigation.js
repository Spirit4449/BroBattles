const { characterBody } = require("../../../shared/duelGeometry");
const { bounds, stepBody } = require("./physics");
const movement = require("../../../shared/movementPhysics.json");
const graphs = new Map();
const DT = 1000 / 60;
const EDGE_STANCE_INSET = 14;
const EDGE_BRAKE_MIN_SPEED = 35;

function standOn(surface, character, x) {
  const b = characterBody(character);
  return { char_class: character, x, y: surface.top - b.halfHeight - b.offsetY,
    vx: 0, vy: 0, grounded: true, platformId: surface.id };
}

function buildGraph(geometry, character, modifiers = {}) {
  const key = `${geometry.mapId}:${character}:${modifiers.speedMult ?? 1}:${modifiers.jumpMult ?? 1}`;
  if (graphs.has(key)) return graphs.get(key);
  const surfaces = geometry.colliders.filter((r) => r.collision.up && r.right - r.left >= 12);
  const edges = new Map(surfaces.map((r) => [r.id, []]));
  for (const from of surfaces) {
    const body = characterBody(character);
    const margin = Math.min((from.right - from.left) / 3, body.halfWidth + 4);
    const span = from.right - from.left - margin * 2;
    const samples = Math.max(2, Math.min(12, Math.ceil(span / 120)));
    const starts = Array.from({ length: samples + 1 }, (_, i) => from.left + margin + span * i / samples);
    for (const x of starts) for (const direction of [-1, 0, 1]) for (const jump of [false, true]) {
      if (!direction && !jump) continue;
      const p = standOn(from, character, x - body.offsetX);
      let airborne = false;
      const frames = [];
      for (let i = 0; i < 150; i++) {
        const wallJump = !!p.wallSide && i * DT >= (p._nextWallJump || 0);
        const steer = wallJump ? (p.wallSide === "left" ? 1 : -1) : direction;
        const input = { direction: steer, jumpPressed: (jump && i === 0) || wallJump };
        frames.push({ ...input, x: p.x, y: p.y });
        p.flip = steer < 0;
        const result = stepBody(p, input, geometry, DT, i * DT, modifiers);
        if (!p.grounded) airborne = true;
        if (result.fell) break;
        if (p.grounded && airborne) {
          if (p.platformId !== from.id) {
            const list = edges.get(from.id);
            const edge = { to: p.platformId, takeoffX: x - body.offsetX, direction, jump, frames, duration: (i + 1) * DT };
            const existing = list.findIndex((e) => e.to === edge.to && e.jump === jump);
            // Keep a walking/drop alternative when a jump reaches the same platform.
            if (existing < 0) list.push(edge);
            else if (edge.duration < list[existing].duration) list[existing] = edge;
          }
          break;
        }
      }
    }
  }
  const graph = { surfaces, edges, body: characterBody(character) };
  // Bound modifier-specific cached graphs; default graphs are inexpensive to rebuild.
  if (graphs.size >= 96) graphs.delete(graphs.keys().next().value);
  graphs.set(key, graph);
  return graph;
}

function nearestSurface(graph, point) {
  return graph.surfaces.reduce((best, r) => {
    const x = Math.max(r.left, Math.min(r.right, point.x));
    const score = Math.abs(point.x - x) + Math.abs(point.y - r.top) * 1.5;
    return !best || score < best.score ? { surface: r, score } : best;
  }, null)?.surface;
}

function findRoute(graph, from, to, poisonY = Infinity, options = {}) {
  if (!from || !to) return null;
  if (from === to) return [];
  const queue = [{ id: from, route: [], cost: 0 }], visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const item = queue.shift();
    if (item.id === to) return item.route;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    for (const edge of graph.edges.get(item.id) || []) {
      if (options.blocked?.has(`${item.id}:${edge.to}`)) continue;
      const surface = graph.surfaces.find((s) => s.id === edge.to);
      if (!surface || surface.top >= poisonY - 25) continue;
      if (Number.isFinite(poisonY)) {
        const frameBottoms = edge.frames.map((f) => f.y + graph.body.offsetY + graph.body.halfHeight);
        const startBottom = frameBottoms[0] ?? -Infinity;
        const unsafeLine = poisonY - 15;
        if (startBottom < unsafeLine) {
          if (frameBottoms.some((bottom) => bottom >= unsafeLine)) continue;
        } else if (frameBottoms.some((bottom) => bottom > startBottom + 20)) {
          // A bot already caught by the rising poison may still take a route
          // that immediately climbs out, but must not dive farther into it.
          continue;
        }
      }
      const penalty = Math.max(0, Number(options.edgeCost?.(edge, item.id)) || 0);
      queue.push({ id: edge.to, route: [...item.route, edge], cost: item.cost + edge.duration + penalty });
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
    const result = stepBody(p, input, geometry, DT, now + i * DT, modifiers);
    if (result.fell || bounds(p).bottom >= poisonY - 25) return null;
    airborne ||= !p.grounded;
    if (airborne && p.grounded && i > 8) return { frames, end: p };
    if (!intent.jumpPressed && !airborne && i >= 32) return { frames, end: p };
  }
  return p.grounded ? { frames, end: p } : null;
}

function safeWalkDirection(player, direction, geometry) {
  if (!player.grounded) return direction;
  const b = bounds(player);
  const normal = characterBody(player.char_class, false);
  const flipped = characterBody(player.char_class, true);
  // Facing changes can shift asymmetric character hitboxes. Use the widest
  // possible footprint so turning around at a ledge cannot remove support.
  const envelopeLeft = player.x + Math.min(
    normal.offsetX - normal.halfWidth,
    flipped.offsetX - flipped.halfWidth,
  );
  const envelopeRight = player.x + Math.max(
    normal.offsetX + normal.halfWidth,
    flipped.offsetX + flipped.halfWidth,
  );
  const supports = geometry.colliders.filter(
    (r) =>
      r.collision.up &&
      envelopeRight > r.left &&
      envelopeLeft < r.right &&
      Math.abs(r.top - b.bottom) < 5,
  );
  const support = supports.find((r) => r.id === player.platformId) ||
    supports.sort(
      (a, c) =>
        Math.min(envelopeRight, c.right) - Math.max(envelopeLeft, c.left) -
        (Math.min(envelopeRight, a.right) - Math.max(envelopeLeft, a.left)),
    )[0];
  if (!support) return direction;

  if (envelopeRight > support.right - EDGE_STANCE_INSET) return -1;
  if (envelopeLeft < support.left + EDGE_STANCE_INSET) return 1;

  const velocity = Number(player.vx) || 0;
  const momentumDirection = Math.sign(velocity);
  if (momentumDirection && Math.abs(velocity) >= EDGE_BRAKE_MIN_SPEED) {
    const stoppingDistance =
      velocity * velocity / (2 * Math.max(1, Number(movement.dragGround) || 1));
    const momentumProbe = momentumDirection > 0
      ? envelopeRight + stoppingDistance + EDGE_STANCE_INSET
      : envelopeLeft - stoppingDistance - EDGE_STANCE_INSET;
    const momentumSupported =
      momentumProbe >= support.left && momentumProbe <= support.right;
    if (!momentumSupported && Math.sign(direction) !== -momentumDirection) {
      return -momentumDirection;
    }
  }

  if (!direction) return 0;
  const probeX = direction > 0
    ? envelopeRight + Math.abs(player.vx || 0) * 0.12 + 12
    : envelopeLeft - Math.abs(player.vx || 0) * 0.12 - 12;
  return probeX >= support.left && probeX <= support.right ? direction : -direction;
}
module.exports = { buildGraph, findRoute, nearestSurface, standOn, safeWalkDirection, previewManeuver };
