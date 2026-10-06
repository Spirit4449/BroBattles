export const RENDER_LAYERS = Object.freeze({
  // Map scenery: back layers stack upward from here, behind the arena.
  SCENERY_BACK: -1000,
  WORLD: 0,
  GAME_OBJECTS: 10,
  POWERUPS: 20,
  PLAYER: 30,
  // Foreground scenery, front light rays and dust: over fighters, under their HUD.
  SCENERY_FRONT: 33,
  PLAYER_HUD: 40,
  RETICLES: 50,
  ATTACKS: 60,
  POISON: 70,
  MOBILE_CONTROLS: 10000,
});
