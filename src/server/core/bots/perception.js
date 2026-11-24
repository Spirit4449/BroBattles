const movement = require("../../../shared/physics/movementPhysics.json");
const { SERVER_TICK_HZ, FIXED_DT_MS } = require("../../../shared/gameConstants");
const { isPlaced } = require('../../../shared/combat/targetable.js');
const effects = require('../../../shared/combat/runtime/effects/effectManager.js');
const { participantId } = require('../gameRoom/participants');
const { bounds } = require('../physics/bodySolver');
const { botProfile } = require('../../../shared/combat/characterProfiles.js');
const { forecastThreats, shapeGap, shapeBounds } = require('./threatForecast');

const THREAT_RANGE = 1300;

// A threat is either a forecast (`steps`: the damage shapes each step of the
// next second, from threatForecast) or a straight shot (x, y, vx, vy, gravity,
// radius) for sources the forecast does not cover.
function threatShapes(threat, seconds) {
  if (threat.steps) return threat.steps[Math.floor(Math.max(0, seconds + (threat.ageS || 0)) / threat.stepS)] || [];
  const at = Math.max(0, seconds);
  return [{ kind: 'circle', radius: threat.radius,
    x: threat.x + threat.vx * at, y: threat.y + threat.vy * at + 0.5 * (threat.gravity || 0) * at * at }];
}
function threatGap(threat, seconds, rect) {
  let gap = Infinity;
  for (const shape of threatShapes(threat, seconds)) gap = Math.min(gap, shapeGap(shape, rect));
  return gap;
}
function shapeCenter(shape) {
  if (shape.kind === 'sweep' || shape.kind === 'capsule') return shape.b;
  if (shape.kind === 'rect') return { x: (shape.left + shape.right) / 2, y: (shape.top + shape.bottom) / 2 };
  return shape;
}

function observe(room, player, now) {
  const enemies = [...room.players.values()].filter((p) =>
    p !== player && p.team !== player.team && p.isAlive && isPlaced(p) &&
    !effects.isActive(p, 'invisibility', now) && Math.hypot(p.x - player.x, p.y - player.y) < 1600,
  ).map((p) => ({
    participantId: participantId(p), char_class: p.char_class, x: p.x, y: p.y,
    vx: p.vx || 0, vy: p.vy || 0, flip: !!p.flip, health: p.health, maxHealth: p.maxHealth,
    grounded: p.grounded, ducking: p.ducking === true,
    bodyHalfHeight: p._bodyHalfHeight,
    bodyCenterOffsetY: p._bodyCenterOffsetY,
    platformId: p.platformId, attack: p._visibleAttack && { ...p._visibleAttack },
  }));
  const projectiles = [];
  // Every attack, projectile and super whose runtime publishes its damage
  // shape, including windups about to release.
  const forecast = forecastThreats(room), ageS = Math.max(0, now - forecast.at) / 1000;
  for (const threat of forecast.threats) {
    if (threat.team === player.team) continue;
    const near = threat.steps.some((shapes) => shapes.some((shape) => {
      const c = shapeCenter(shape);
      return Math.hypot(c.x - player.x, c.y - player.y) < THREAT_RANGE;
    }));
    if (!near) continue;
    const first = threat.steps.find((shapes) => shapes.length)?.[0];
    projectiles.push({ ...shapeCenter(first), ownerId: threat.ownerId, steps: threat.steps, stepS: threat.stepS, ageS });
  }
  for (const shot of room.gameMode?.getBotThreats?.() || []) {
    if (shot.team === player.team || Math.hypot(shot.x - player.x, shot.y - player.y) > THREAT_RANGE) continue;
    projectiles.push(shot);
  }
  return { at: now, enemies, projectiles };
}

function incomingThreat(observed, player, now) {
  if (!observed) return null;
  const body = bounds(player), age = Math.min(0.6, Math.max(0, now - observed.at) / 1000);
  let closest = null;
  for (const attack of observed.projectiles) {
    for (let t = 0; t <= 0.7; t += 0.05) {
      const shift = (player.vx || 0) * t;
      const rect = { left: body.left + shift - 16, right: body.right + shift + 16, top: body.top - 12, bottom: body.bottom + 12 };
      if (threatGap(attack, age + t, rect) > 0) continue;
      if (!closest || t < closest.impactIn) {
        const shape = threatShapes(attack, age + t)[0];
        closest = { ...attack, ...(shape ? shapeCenter(shape) : {}), impactIn: t };
      }
      break;
    }
  }
  // Windups are public animations, so they can warn a bot before a projectile arrives.
  if (!closest) for (const enemy of observed.enemies) {
    const attack = enemy.attack;
    if (!attack || now - attack.at > Math.max(300, attack.startupMs + 150)) continue;
    const dx = player.x - enemy.x, dy = player.y - enemy.y;
    const facing = Math.cos(attack.angle);
    if (Math.sign(dx) !== Math.sign(facing) || Math.abs(dy) > 90) continue;
    const range = botProfile(enemy.char_class).melee ? 210 : 550;
    if (Math.hypot(dx, dy) < range) closest = { x: enemy.x, y: enemy.y, impactIn: 0.5, telegraph: true };
  }
  return closest;
}

function maneuverDanger(maneuver, observed, now, character) {
  const age = Math.max(0, now - observed.at) / 1000;
  let danger = 0;
  for (let i = 0; i < Math.min(42, maneuver.frames.length); i += 3) {
    const frame = maneuver.frames[i], body = bounds({ ...frame, char_class: character });
    for (const attack of observed.projectiles) {
      danger += Math.max(0, 70 - threatGap(attack, age + i / SERVER_TICK_HZ, body));
    }
    for (const enemy of observed.enemies) {
      if (enemy.attack && now - enemy.attack.at < 600) {
        danger += Math.max(0, 160 - Math.hypot(frame.x - enemy.x, frame.y - enemy.y)) * 0.25;
      }
    }
  }
  return danger;
}

// A stream of shots is a lane, not a set of separate projectiles: anywhere its
// shots sweep stays dangerous between volleys, at the stream's full strength.
// A lane is the grid of cells the shots' predicted paths cross. Cells are
// remembered briefly, so a pause in fire does not make the ground look safe.
const FIRE_LANE_MEMORY_MS = 1600;
const FIRE_LANE_MIN_SHOTS = 2;
const FIRE_LANE_LASTING_S = 0.8;
const FIRE_LANE_LOOKAHEAD_S = 0.5;
const FIRE_LANE_CELL = 24;
const cellKey = (cx, cy) => `${cx},${cy}`;
const fade = (cell, now) => cell.count * Math.max(0, 1 - (now - cell.at) / FIRE_LANE_MEMORY_MS);

// A straight shot's line ahead, and back to its shooter, whose line of fire it is.
function shotPath(shot, shooter) {
  const points = [];
  const speed = Math.hypot(shot.vx, shot.vy);
  if (shooter && speed) {
    const along = ((shot.x - shooter.x) * shot.vx + (shot.y - shooter.y) * shot.vy) / speed;
    if (along > 0) points.push({ x: shot.x - shot.vx / speed * along, y: shot.y - shot.vy / speed * along });
  }
  points.push({ x: shot.x, y: shot.y }, { x: shot.x + shot.vx * FIRE_LANE_LOOKAHEAD_S, y: shot.y + shot.vy * FIRE_LANE_LOOKAHEAD_S });
  return points;
}

function markBox(box, cells) {
  for (let cx = Math.floor(box.left / FIRE_LANE_CELL); cx <= Math.floor(box.right / FIRE_LANE_CELL); cx++)
    for (let cy = Math.floor(box.top / FIRE_LANE_CELL); cy <= Math.floor(box.bottom / FIRE_LANE_CELL); cy++) cells.add(cellKey(cx, cy));
}

function sweepCells(points, radius, cells) {
  const mark = (x, y) => markBox({ left: x - radius, right: x + radius, top: y - radius, bottom: y + radius }, cells);
  mark(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (FIRE_LANE_CELL / 2));
    for (let j = 1; j <= steps; j++) mark(a.x + (b.x - a.x) * j / steps, a.y + (b.y - a.y) * j / steps);
  }
}

function laneBounds(lane) {
  lane.left = lane.top = Infinity; lane.right = lane.bottom = -Infinity;
  for (const key of lane.cells.keys()) {
    const [cx, cy] = key.split(',').map(Number);
    lane.left = Math.min(lane.left, cx * FIRE_LANE_CELL); lane.right = Math.max(lane.right, (cx + 1) * FIRE_LANE_CELL);
    lane.top = Math.min(lane.top, cy * FIRE_LANE_CELL); lane.bottom = Math.max(lane.bottom, (cy + 1) * FIRE_LANE_CELL);
  }
  return lane;
}

function updateFireLanes(previous, observed, now) {
  const lanes = new Map();
  for (const [owner, lane] of previous || []) {
    const cells = new Map([...lane.cells].filter(([, cell]) => now - cell.at < FIRE_LANE_MEMORY_MS));
    if (cells.size) lanes.set(owner, laneBounds({ ...lane, cells }));
  }
  if (!observed) return lanes;
  const groups = new Map();
  for (const shot of observed.projectiles) {
    // Lobbed straight shots threaten a spot, not a lane; dodging prices those.
    if (!shot.steps && (shot.gravity || !(shot.vx || shot.vy))) continue;
    if (!groups.has(shot.ownerId)) groups.set(shot.ownerId, []);
    groups.get(shot.ownerId).push(shot);
  }
  for (const [owner, shots] of groups) {
    // One lasting damage area (an inferno) holds ground like a stream does.
    const lasting = shots.some((shot) => shot.steps?.filter((shapes) => shapes.length).length * shot.stepS >= FIRE_LANE_LASTING_S);
    if (shots.length < FIRE_LANE_MIN_SHOTS && !lasting) continue;
    const shooter = observed.enemies.find((enemy) => enemy.participantId === owner);
    const swept = new Set();
    for (const shot of shots) {
      if (shot.steps) forecastCells(shot, swept);
      else sweepCells(shotPath(shot, shooter), shot.radius, swept);
    }
    const lane = lanes.get(owner) || { cells: new Map() }, count = shots.length;
    for (const key of swept) {
      const old = lane.cells.get(key);
      if (!old || count >= fade(old, observed.at)) lane.cells.set(key, { count, at: observed.at });
    }
    lanes.set(owner, laneBounds({ ...lane, shots: shots.length, at: observed.at }));
  }
  return lanes;
}

// Every cell a forecast threat's damage shapes cover over the next second.
function forecastCells(threat, cells) {
  for (const shapes of threat.steps) for (const shape of shapes) {
    if (shape.kind === 'sweep' || shape.kind === 'capsule') sweepCells([shape.a, shape.b], shape.radius, cells);
    else { const box = shapeBounds(shape); if (box) markBox(box, cells); }
  }
}

// The strongest remembered cell each lane has under a body at `point`.
function fireLaneExposure(lanes, character, point, now) {
  if (!lanes?.size) return 0;
  const body = bounds({ ...point, char_class: character });
  let exposure = 0;
  for (const lane of lanes.values()) {
    if (body.right <= lane.left || body.left >= lane.right || body.bottom <= lane.top || body.top >= lane.bottom) continue;
    let densest = 0;
    for (let cx = Math.floor(body.left / FIRE_LANE_CELL); cx <= Math.floor(body.right / FIRE_LANE_CELL); cx++)
      for (let cy = Math.floor(body.top / FIRE_LANE_CELL); cy <= Math.floor(body.bottom / FIRE_LANE_CELL); cy++) {
        const cell = lane.cells.get(cellKey(cx, cy));
        if (cell) densest = Math.max(densest, fade(cell, now));
      }
    exposure += densest;
  }
  return exposure;
}

// Integrate exposure in shot-seconds along the walk to takeoff and the flight.
function walkExposure(lanes, character, fromX, point, now) {
  if (!lanes?.size || !Number.isFinite(fromX)) return 0;
  const distance = Math.abs(point.x - fromX);
  const samples = Math.ceil(distance / 32);
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const x = fromX + (point.x - fromX) * (i + 0.5) / samples;
    total += fireLaneExposure(lanes, character, { x, y: point.y }, now);
  }
  return samples ? total / samples * distance / movement.maxSpeed : 0;
}

function edgeExposure(lanes, character, fromX, edge, now) {
  const frames = edge?.frames;
  if (!lanes?.size || !frames?.length) return 0;
  let total = walkExposure(lanes, character, fromX, { x: edge.takeoffX, y: frames[0].y }, now);
  for (let i = 0; i < frames.length; i += 4) {
    total += fireLaneExposure(lanes, character, frames[i], now) * Math.min(4, frames.length - i) * FIXED_DT_MS / 1000;
  }
  return total;
}

module.exports = { observe, incomingThreat, maneuverDanger, threatShapes, updateFireLanes, fireLaneExposure, edgeExposure, walkExposure };
