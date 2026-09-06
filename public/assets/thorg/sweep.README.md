# Thorg full sweep audio

`sweep.wav` is a 700 ms, 48 kHz stereo PCM mix for the entire attack:
140 ms windup, 460 ms active swing, and 100 ms recovery. Play it once when
the attack begins, at normal rate. Its quiet opening builds into the active
sweep and fades through recovery; do not delay it until the hit window.

Sources:

- The project's existing `swoosh.mp3`, kept unchanged. The main layer uses
  pitch-preserving time stretching (`atempo=0.67`), with a quieter duplicate
  pitched down 12%, low-passed at 1100 Hz, and delayed 45 ms for weight.
  This derivative retains the existing source's licensing; no new license
  is asserted for that source.
- `../movement/fall-wind.mp3`, a quiet high-passed air bed, from
  [wind whoosh loop](https://opengameart.org/content/wind-whoosh-loop)
  by SketchMan3 (CC0), as documented in `../movement/README.md`.

The mix uses 25–120 ms entrance fades and 100–140 ms exit fades. There is
no impact layer, so misses sound appropriate and hit sounds can play
independently. No new sound downloads or paid generation were used.

Verification with FFprobe/FFmpeg: exactly 0.700000 seconds, 134,478 bytes,
mean level -19.6 dBFS, peak -3.3 dBFS, and no interior silence below -40 dB
lasting 15 ms. The final 25 ms crosses below -40 dB as an intentional fade.
The 600–650 ms recovery section remains audible at -26.3 dBFS RMS.
