# Bank Bust movement sounds

**Metal Footsteps** by **SoftDistortionFX**.
Source: https://freesound.org/people/SoftDistortionFX/sounds/398937/
License: Creative Commons Zero (CC0 / public domain)
https://creativecommons.org/publicdomain/zero/1.0/
Downloaded high-quality preview: https://cdn.freesound.org/previews/398/398937_5993580-hq.mp3

Three individual steps and a heavier landing impact are derived from this
recording. The source is pitched down (0.78x, 0.76x, 0.80x for steps; 0.70x
for landing), high-passed at 38 Hz, low-passed at 900 Hz, and boosted at 180 Hz
(+5 dB, Q 0.8). Short fades remove cut clicks. A synthesized descending sine
impact adds a bass thud: step fundamentals 82/77/86 Hz with a 28 Hz initial
sweep and 55 ms decay; landing 65 Hz with a 35 Hz sweep and 85 ms decay.
The bass layer starts at the source impact (0.10 seconds divided by pitch).
Source gain is 0.85; bass gain is 0.29 for steps and 0.40 for landing. Peaks
are capped at 0.85 by reducing gain only. Output is mono 44.1 kHz PCM 16-bit WAV.

| File | Source start (seconds) | Source duration (seconds) |
| --- | --- | --- |
| metal-step-1.wav | 64.04 | 0.58 |
| metal-step-2.wav | 65.40 | 0.58 |
| metal-step-3.wav | 68.80 | 0.58 |
| metal-land.wav | 66.58 | 0.76 |

Only Bank Bust footstep and hard-terrain landing keys use these samples,
for local and remote fighters. Existing gameplay cadence and playback mix remain.

Landing audibility revision: the landing instead uses 0.85x pitch, a 55 Hz
high-pass, a 2200 Hz low-pass and +7 dB at 180 Hz (Q 0.8), retaining more
of the audible impact. Its bass layer sweeps from 150 Hz to 105 Hz with an
85 ms decay and 0.45 gain; source gain is 2. The combined landing is peak
normalized to 0.95. This replaces the landing processing described above;
step processing is unchanged.

Deeper landing revision: the audibility revision is subsequently pitched down
by 0.75x, low-passed at 650 Hz, boosted +3 dB at 130 Hz (Q 0.8), and peak
normalized to 0.95. This softens the sharp impact and lowers the bass layer
from 105 Hz to roughly 79 Hz. Footsteps are unchanged.

Final thud revision: trim the previous landing to its impact onset
(0.10 / 0.85 / 0.75 seconds), retain that body at 0.23 gain, and layer a
120-to-72 Hz sine impact (18 ms sweep, 60 ms decay, 1.5 ms attack) at 0.85
gain. Output is 380 ms with a 35 ms end fade, peak normalized to 0.97.
Bank Bust landing playback has 2.2x gain, capped at full volume, for local
and remote players. Other modes keep their existing landing gain.

Crisper/louder revision: soft-saturate the previous thud with tanh(2.2x),
add a filtered noise contact transient (12 ms decay, 0.5 ms attack, 0.65
gain, one-pole smoothing coefficient 0.16, deterministic seed 398937), and
peak normalize to 0.98. Landing playback gain is now 3.2x, still capped at
full volume. The transient adds definition while retaining the low thud.

Volume adjustment: Bank Bust landing playback gain is now 2x (reduced from
3.2x), still capped at full volume. The sample itself is unchanged.

Further volume adjustment: Bank Bust landing playback gain is now 1.2x
(reduced from 2x). The sample itself is unchanged.
