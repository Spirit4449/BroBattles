# Bank Bust footstep

**Metal Footstep 3.wav** by **morganpurkis**.
Source: https://freesound.org/people/morganpurkis/sounds/384656/
License: Creative Commons Attribution 4.0 (CC BY 4.0)
https://creativecommons.org/licenses/by/4.0/
Downloaded high-quality preview: https://cdn.freesound.org/previews/384/384656_5937039-hq.mp3

`metal-step.wav` is the preview decoded to PCM WAV. Format conversion only;
no EQ, trimming, synthesis, normalization or pitch shifting was applied.
The three existing footstep keys select this sample. Gameplay cadence and
playback mix are retained. Keep this attribution with redistributed assets.

Conversion:

```sh
ffmpeg -i 384656_5937039-hq.mp3 -c:a pcm_s16le metal-step.wav
```

Only footsteps use a mode-specific sample. Other movement uses shared assets,
including the original falling wind at its reduced runtime gain.
