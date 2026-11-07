// Duel maps share a rotation across team sizes. Their arenaId preserves the
// authored world and camera profile independently of the match formation.
// Legacy variant arenas remain readable for existing documents and snapshots.
//
// camera: the follow camera's bounds; `zoom` is the reference zoom scenery is
// composed at; it eases between `maxZoom` with the player at or below
// climbY[1] and `minZoom` at or above climbY[0] (cameraDynamics.js). Where the
// player sits in the view is shared by every arena, in screen pixels
// (FOLLOW_SCREEN_OFFSET in cameraDynamics.js), so it is not set here. Maps on
// one arena keep their main floor at the same height (duels-1v1: y 580) so the
// climb zoom and sudden-death poison behave alike on each.
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

const duelArena = Object.freeze({ ...resolved.get('duels-1v1'), modeVariantId: 'duels', label: 'Duels', playersPerTeam: 2 });
resolved.set('duels', duelArena);

/** The arena for an authoring mode or a legacy match variant. */
function arenaFor(modeVariantId) {
  return resolved.get(String(modeVariantId)) || null;
}

/** The arena a map document is built for. */
function mapArena(map) {
  const arena = arenaFor(map?.modeVariantId);
  if (map?.modeVariantId !== 'duels') return arena;
  const profile = arenaFor(map.arenaId || 'duels-1v1');
  return profile?.modeId === 'duels' ? { ...arena, world: profile.world, camera: profile.camera } : null;
}

/** Authoring modes offered by Map Studio. */
function arenaIds() {
  return [...resolved.keys()].filter(id => !['duels-1v1', 'duels-2v2'].includes(id));
}

module.exports = { arenaFor, mapArena, arenaIds };
