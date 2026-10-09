const defaults = require('../maps').mapDefaults;
const { geometryFromMap } = require('../maps/mapDocument');
const { resolveLanding } = require('./spawnPlacement');
const { characterBody } = require('./characterBody');
function getDuelGeometry(mapId, snapshot = null) {
  const data = snapshot || defaults.find(d => d.id === Number(mapId));
  return data ? geometryFromMap(data, Number(mapId)) : null;
}

// A map has one spawn slot per player its mode allows on each team.
function spawnForParticipant(geometry, player, index) {
  const choices = geometry.spawns.players[player.team];
  const point = choices?.[Math.min(index, choices.length - 1)];
  const anchor = geometry.anchors[point?.anchorId];
  const body = characterBody(player.char_class, player.flip);
  const landing = resolveLanding(point, anchor, geometry.colliders, body);
  return { x: landing.x - body.offsetX,
    y: landing.y - body.offsetY - body.halfHeight };
}

module.exports = { getDuelGeometry, characterBody, spawnForParticipant };
