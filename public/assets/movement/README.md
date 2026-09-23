# Movement sound sources

- `step-1.*` through `step-3.*` come from
  [Kenney Impact Sounds](https://kenney.nl/assets/impact-sounds), licensed
  Creative Commons CC0.
- `landing.*` blends the mud and leaf recordings from TinyWorlds'
  [Different Steps](https://opengameart.org/content/different-steps-on-wood-stone-leaves-gravel-and-mud)
  CC0 pack with a quiet Kenney soft impact. It is tightly trimmed and faded so
  it reads as dirt/grass without a room-like tail.
- `fall-wind.mp3` is a level-balanced transcode of
  [wind whoosh loop](https://opengameart.org/content/wind-whoosh-loop) by
  SketchMan3, licensed Creative Commons CC0.
- `jump.mp3`, `wall-jump.mp3`, and `wall-slide.mp3` are level-balanced
  transcodes of the project's existing movement clips.

CC0 assets can be redistributed and used commercially without attribution.

- `dash.mp3` adapts [Whoosh Short 5.wav](https://freesound.org/people/Mellau/sounds/530448/)
  by Mellau. The public listing is CC BY-NC 4.0; the project owner confirmed
  separate permission for commercial use. Attribution: "Whoosh Short 5.wav"
  by Mellau, modified for Bro Battles. Source used: Freesound's HQ MP3 preview.
  Adaptation: blend 65% of the earlier bright dash adaptation (Mellau whoosh,
  rising pitch accent, falling Doppler note, and air tail) with 35% of the
  lighter filtered swish made from the same recording. Lengthen the bright
  layer without lowering its pitch, reduce its low end below 200 Hz, and
  shape the 550 ms mix with a 6 ms onset fade and 55 ms tail fade.
  Replace most of the opening pitch rise with the original recording's
  natural swish (filtered to 280 Hz–7 kHz), retaining a 6% hint of the earlier
  opening. Crossfade back into the bright tail from 130–230 ms.
  Lower the bright tail by three semitones without changing duration, blending
  into that pitch adjustment over the same 130–230 ms interval.
  The encoded mono result measures roughly -17.2 dBFS RMS and -1.9 dBFS peak;
  game playback volume remains 0.7 before distance attenuation.
  Keep the separate permission record with the game's licensing records
  before release.

- `stomp.mp3` adapts `thud2.wav` by Brian MacIntosh (BMacZero), from
  [Metal Impact Sounds](https://opengameart.org/content/metal-impact-sounds), CC0.
  Source: https://opengameart.org/sites/default/files/thud2.wav
  This replaces the earlier Kenney/synthesized mix with a different recorded thud.
  Processing: 80% playback rate, 30 Hz high-pass, 3.5 kHz low-pass, +5 dB bass
  at 120 Hz, +14 dB gain, 3:1 compression, peak limiting at 0.88, and a 160 ms
  tail fade. Duration: 720 ms. Game volume: 1.0 before distance attenuation.
