const defaults = require('./maps').mapDefaults;
const { geometryFromMap, variantKey } = require('./mapDocument');
const { resolveLanding } = require('./spawnPlacement');
const frames = require("./characters/index.js").characterFrames;
const { getCharacterStats } = require("./characterStats.js");
const { getResolvedCharacterBodyConfig } = require("./characterTuning.js");
function getDuelGeometry(mapId, variant = '1v1', snapshot = null) {
  const data = snapshot || defaults.find(d => d.id === Number(mapId))?.variants[variantKey(variant)];
  return data ? geometryFromMap(data, Number(mapId)) : null;
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
