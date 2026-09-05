# Map terrain and footsteps

Set each map's `terrain` in `src/shared/maps.catalog.json`:

- `grass`: Lushy Peaks, Mangrove Meadow, Serenity. Four natural foot-on-grass steps and the soft “smush” landing.
- `hard`: Iron Junction / Bank Bust. The original three industrial footstep samples and a concrete-impact landing.

This is a map-wide material, not automatic texture detection. Missing or unknown materials safely fall back to `hard`.

To add another material, add a named entry to `src/shared/terrainAudio.json` with a label, `volumeScale`, `landing`, and a nonempty `steps` array. Sound entries need a unique `key` and `files` paths relative to `public/assets`. Add the files, then set the map's `terrain` to the new name. Preloading and selection use this registry automatically; no character-specific edits are needed. Keep asset licenses beside the files.

`footstepVolumeScale` is the master multiplier. Grass uses four individual foot contacts extracted from a real walking recording and normalized to −22 LUFS with a −4 dB true-peak ceiling. Its landing volume is independently reduced through `landing.volumeScale`. The untouched CC0 preview remains alongside the game-ready files. Speed-dependent pitch/volume and nonrepeating variants are retained.

The initial player spawn is marked for a silent landing. The marker survives an unfinished countdown drop and is consumed on the first grounded frame (or cleared on a deliberate jump). Later gameplay landings retain their normal audio. This only suppresses the landing sound, not spawn visuals or the parachute opening sound.

Tests: `node --test tests/movementAudio.test.js`.
