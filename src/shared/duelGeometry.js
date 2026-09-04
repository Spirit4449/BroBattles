const maps = require("./duelMaps.json");
const bankGeometry = require('./bankSpawnGeometry.json');
const { resolveLanding } = require('./spawnPlacement');
const frames = require("./characterFrames.json");
const { getCharacterStats } = require("../lib/characterStats.js");
const { getResolvedCharacterBodyConfig } = require("../lib/characterTuning.js");
const cache = new Map();

function getDuelGeometry(mapId) {
  if (cache.has(Number(mapId))) return cache.get(Number(mapId));
  const data = Number(mapId) === 4 ? bankGeometry : maps[mapId];
  if (!data) return null;
  const platforms = data.layout.platforms.map((p, i) => {
    const size = data.textureSizes[p.textureKey];
    const sx = Math.abs(p.scaleX || 1), sy = Math.abs(p.scaleY || 1);
    const left = p.x - size.width * sx / 2 + (p.body?.offsetX || 0) * sx;
    const top = p.y - size.height * sy / 2 + (p.body?.offsetY || 0) * sy;
    return { id: `p${i}`, x: p.x, y: p.y, left, top,
      right: left + (p.body?.width || size.width * sx), bottom: top + (p.body?.height || size.height * sy),
      enabled: p.collisionEnabled !== false, collision: { up: true, down: true, left: true, right: true } };
  });
  const hitboxes = data.layout.hitboxes.map((p, i) => ({ id: `h${i}`, x: p.x, y: p.y,
    left: p.x - p.width / 2, right: p.x + p.width / 2,
    top: p.y - p.height / 2, bottom: p.y + p.height / 2, enabled: true,
    collision: { up: true, down: true, left: true, right: true, ...p.collision } }));
  const anchors = Object.fromEntries(Object.entries(data.anchors).map(([name, ref]) => [name, (ref.kind === "platform" ? platforms : hitboxes)[ref.index]]));
  const geometry = { mapId: Number(mapId), world: data.bounds.world, spawns: data.spawns,
    anchors, colliders: [...platforms, ...hitboxes].filter((p) => p.enabled) };
  cache.set(Number(mapId), geometry);
  return geometry;
}

function characterBody(character, flip = false) {
  const frame = frames[character] || frames.ninja;
  const stats = getCharacterStats(character) || getCharacterStats("ninja");
  const cfg = getResolvedCharacterBodyConfig(character);
  const scale = stats.spriteScale || 1;
  const width = Math.max(4, frame.w - cfg.widthShrink) * scale;
  const height = Math.max(4, frame.h - cfg.heightShrink) * scale;
  return { width, height, halfWidth: width / 2, halfHeight: height / 2,
    offsetX: width * (1 - scale) / 2 + ((cfg.offsetXFromHalf || 0) + (flip ? cfg.flipOffset || 0 : 0)) * scale,
    offsetY: (cfg.offsetY || 0) * scale - frame.h * scale / 2 + height / 2,
    displayWidth: frame.w * scale, displayHeight: frame.h * scale };
}

function spawnForParticipant(geometry, player, index, teamSize) {
  const team = geometry.spawns.players[player.team];
  const choices = team?.[Math.max(1, Math.min(3, teamSize))] || team?.[3];
  const point = choices?.[Math.min(index, choices.length - 1)];
  const anchor = geometry.anchors[point?.anchorId];
  const body = characterBody(player.char_class, player.flip);
  const landing = resolveLanding(point, anchor, geometry.colliders, body);
  return { x: landing.x - body.offsetX,
    y: landing.y - body.offsetY - body.halfHeight };
}

module.exports = { getDuelGeometry, characterBody, spawnForParticipant };
