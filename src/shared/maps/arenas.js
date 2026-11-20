const { DUEL_DEFAULT_VARIANT, isDuelFormation } = require("./duelVariants.js");
// Duel maps share a rotation across team sizes. Their arenaId preserves the
// authored world and camera profile independently of the match formation.
// Legacy variant arenas remain readable for existing documents and snapshots.
//
// Arenas share a default gameplay zoom range. A map profile can override
// it to fit its layout, as Sunset Bowl does.
const FOLLOW_ZOOM = Object.freeze({ minZoom: 1.4, maxZoom: 1.5 });
const ARENAS = require('./arenas.json');
const { modes } = require('../catalogs/gameModes.catalog.cjs');

const variants = new Map(modes.flatMap(mode => (mode.variants || []).map(v => [v.id, { mode, variant: v }])));
for (const id of Object.keys(ARENAS)) {
  if (!variants.has(id)) throw new Error(`arenas.json: ${id} is not a game mode variant`);
}

const resolved = new Map(Object.entries(ARENAS).map(([id, arena]) => {
  const { mode, variant } = variants.get(id);
  const camera = { ...FOLLOW_ZOOM, ...arena.camera };
  return [id, Object.freeze({
    modeId: mode.id, modeVariantId: id, label: `${mode.label} ${variant.label}`,
    teamCount: variant.teamCount || 2, playersPerTeam: variant.playersPerTeam || 1,
    world: Object.freeze({ ...arena.world }), camera: Object.freeze({ ...camera, zoom: camera.minZoom }),
  })];
}));

const duelArena = Object.freeze({ ...resolved.get(DUEL_DEFAULT_VARIANT), modeVariantId: 'duels', label: 'Duels', playersPerTeam: 2 });
resolved.set('duels', duelArena);

/** The arena for an authoring mode or a legacy match variant. */
function arenaFor(modeVariantId) {
  return resolved.get(String(modeVariantId)) || null;
}

/** The arena a map document is built for. */
function mapArena(map) {
  const arena = arenaFor(map?.modeVariantId);
  if (map?.modeVariantId !== 'duels') return arena;
  const profile = arenaFor(map.arenaId || DUEL_DEFAULT_VARIANT);
  return profile?.modeId === 'duels' ? { ...arena, world: profile.world, camera: profile.camera } : null;
}

/** Authoring modes offered by Map Studio. */
function arenaIds() {
  return [...resolved.keys()].filter(id => !isDuelFormation(id));
}

module.exports = { arenaFor, mapArena, arenaIds };
