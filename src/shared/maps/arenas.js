// Every map is built for exactly one game mode (a mode variant such as
// duels-2v2). That mode's arena in arenas.json fixes the world size and the
// match camera, so all maps of a mode play and frame alike; maps never
// override them. See docs/development/maps.md.
//
// camera: the follow camera's bounds; `zoom` is the reference zoom scenery is
// composed at; it eases between `maxZoom` with the player at or below
// climbY[1] and `minZoom` at or above climbY[0] (cameraDynamics.js).
const ARENAS = require('./arenas.json');
const { modes } = require('../catalogs/gameModes.catalog.json');

const variants = new Map(modes.flatMap(mode => (mode.variants || []).map(v => [v.id, { mode, variant: v }])));
for (const id of Object.keys(ARENAS)) {
  if (!variants.has(id)) throw new Error(`arenas.json: ${id} is not a game mode variant`);
}

const resolved = new Map(Object.entries(ARENAS).map(([id, arena]) => {
  const { mode, variant } = variants.get(id);
  return [id, Object.freeze({
    modeId: mode.id, modeVariantId: id, label: `${mode.label} ${variant.label}`,
    teamCount: variant.teamCount || 2, playersPerTeam: variant.playersPerTeam || 1,
    world: Object.freeze({ ...arena.world }), camera: Object.freeze({ ...arena.camera }),
  })];
}));

/** The arena for a mode variant id, or null when the mode has no arena yet. */
function arenaFor(modeVariantId) {
  return resolved.get(String(modeVariantId)) || null;
}

/** The arena a map document is built for. */
function mapArena(map) {
  return arenaFor(map?.modeVariantId);
}

/** Mode variants maps can be made for. */
function arenaIds() {
  return [...resolved.keys()];
}

module.exports = { arenaFor, mapArena, arenaIds };
