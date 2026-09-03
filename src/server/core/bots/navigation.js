const { characterBody } = require("../../../shared/duelGeometry");
const { bounds, stepBody } = require("./physics");
const graphs = new Map();
const DT = 1000 / 60;

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
    const starts = [from.left + margin, (from.left + from.right) / 2, from.right - margin];
    for (const x of starts) for (const direction of [-1, 1]) for (const jump of [false, true]) {
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
          if (p.platformId !== from.id && !edges.get(from.id).some((e) => e.to === p.platformId)) {
            edges.get(from.id).push({ to: p.platformId, takeoffX: x - body.offsetX, direction, jump, frames, duration: (i + 1) * DT });
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

function findRoute(graph, from, to, poisonY = Infinity) {
  if (!from || !to || from === to) return [];
  const queue = [{ id: from, route: [], cost: 0 }], visited = new Set();
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const item = queue.shift();
    if (item.id === to) return item.route;
    if (visited.has(item.id)) continue;
    visited.add(item.id);
    for (const edge of graph.edges.get(item.id) || []) {
      const surface = graph.surfaces.find((s) => s.id === edge.to);
      if (!surface || surface.top >= poisonY - 25) continue;
      if (Number.isFinite(poisonY) && edge.frames.some((f) => f.y + graph.body.offsetY + graph.body.halfHeight >= poisonY - 15)) continue;
      queue.push({ id: edge.to, route: [...item.route, edge], cost: item.cost + edge.duration });
    }
  }
  return null;
}

function safeWalkDirection(player, direction, geometry) {
  if (!player.grounded || !direction) return direction;
  const b = bounds(player);
  const probeX = player.x + b.offsetX + direction * (b.halfWidth + Math.abs(player.vx || 0) * 0.12 + 12);
  const supported = geometry.colliders.some((r) => r.collision.up && probeX >= r.left && probeX <= r.right && Math.abs(r.top - b.bottom) < 5);
  return supported ? direction : 0;
}
module.exports = { buildGraph, findRoute, nearestSurface, standOn, safeWalkDirection };
