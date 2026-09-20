# Reward sounds

## Angelic reveal cues

Source: [Mixkit choir SFX](https://mixkit.co/free-sound-effects/choir/), downloaded September 15, 2026. Public WAV downloads use `https://assets.mixkit.co/active_storage/sfx/{id}/{id}.wav`.

| File | Source | Edit | Minimum currency value |
| --- | --- | --- | --- |
| aura-soft.mp3 | Choir harp bless (657) | 1.15-second cut | 0 |
| aura-bless.mp3 | Choir harp bless (657) | 2.2-second cut | 400 coins / 20 gems |
| aura-radiant.mp3 | Choir bell bless (656) | 3-second cut | 1,500 coins / 75 gems |
| aura-divine.mp3 | Choir magic shine (658) | 4-second cut | 5,000 coins / 250 gems |
| aura-celestial.mp3 | Angelical choir (654) | 6-second cut | 10,000 coins / 500 gems |

Edits use a 25ms fade-in, 450ms fade-out, peak limiter, and stereo 128kbps MP3. Currency value is summed across bundle grants (1 gem = 20 coins for audio tier selection only). Unlocks have a radiant floor, skins/Bros and epic rarity a divine floor, legendary rarity a celestial floor.

## Super-not-ready feedback

`../../nosuper.mp3` is a 420ms feedback cue derived from `../../noammo.mp3`, reinforced with a synthesized low, falling thump. It is limited and kept short so it reads as a denied action rather than a super-ready reward.

## Wallet impacts

Existing coin-impact.wav and gem-impact.wav remain from [WobbleBoxx Workshop, Level up, power up, Coin get (13 Sounds)](https://opengameart.org/content/level-up-power-up-coin-get-13-sounds), CC0: Coin01.aif and Rise02.aif respectively. Original short 220ms edits are unchanged. Superseded reveal WAV alternatives have been removed.

One tick accompanies each arriving particle. Count = ceil(2 × (amount / unit)^0.63), limited to the amount and 96; unit is 50 coins or 2.5 gems. Launch spread grows from 150ms by 22ms per particle; all flights finish within 3.4 seconds. Voices reuse a bounded pool of eight per currency and obey SFX settings. Reduced-motion retains the existing immediate wallet update.

Preview reveals and representative wallet cascades at `/reward-sound-preview.html`.
