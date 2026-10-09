# Level badge video prompts for Gemini Omni

These prompts animate the ten installed badges at `public/assets/levels/1.webp` through `10.webp`. Generate each badge separately with its own image attached. The source artwork, including its number, is the exact design reference. The prompts are for video candidates; the game currently displays the still WebP files.

## Setup and review

Google's [Gemini Omni Flash guide](https://ai.google.dev/gemini-api/docs/omni) recommends precise image-to-video motion, explicitly asking for a single continuous shot, and using the same image as both first and last frame for a loop. Its source syntax is `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1]`. Upload the relevant badge once as **Image1**, then paste the corresponding prompt below. If the interface asks for two frame uploads instead, upload the same badge as both frames. Ask for a roughly four-second clip with no audio, except the deliberately slower ten-second level 10 loop. The API currently offers 16:9 and 9:16 video, so keep the badge in the center square-safe area for later cropping; do not stretch the square source to fill a wide frame.

The level 5 example sets the shared look: the shield face brightens in place and its existing trim gives off a close, soft glow. Both dim back to the exact source appearance. No gleam, highlight band, or sparkle travels across a badge. Generally increase the glow's brightness and richness from level 1 to level 10; keep level 6 deliberately restrained with only a stationary glow. Preserve each palette, crisp pixel-art edges, and readable number. Keep the badge fixed and the background unlit. A few badges retain their distinct secondary motion.

Review each actual first/last frame and the wraparound: a loop instruction does not guarantee a seamless result. The current WebP badges have transparent backgrounds; Omni's documented video response is MP4, so verify background removal and alpha separately before considering a video for in-game use. Do not install a generated clip over the still assets without review.

## Level 1 — bronze ember

Source: `public/assets/levels/1.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 1 bronze shield with its small top stud in one continuous, silent, four-second loop. Keep the badge, ivory 1, its details, camera, center, and scale fixed. Give it a faint warm bronze glow on the face and border, the quietest glow of the set. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The stud holds a tiny stationary highlight. Keep the 1 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 2 — burnished bronze

Source: `public/assets/levels/2.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 2 bronze shield with gold top bar and two rivets in one continuous, silent, four-second loop. Keep the badge, ivory 2, its details, camera, center, and scale fixed. Give it a gentle gold-bronze glow over the face, bar, rivets, and rim, visibly fuller than level 1. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The bar and rivets brighten together, with no moving glints. Keep the 2 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 3 — verdant glow

Source: `public/assets/levels/3.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 3 green shield with gold leaves and a bottom diamond in one continuous, silent, four-second loop. Keep the badge, ivory 3, its details, camera, center, and scale fixed. Give it a modest green-and-gold glow across the face, leaves, and rim, richer than level 2. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The leaves remain perfectly still; the bottom diamond keeps a small stationary highlight. Keep the 3 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 4 — silver-blue radiance

Source: `public/assets/levels/4.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 4 blue shield with a silver crest and side plates in one continuous, silent, four-second loop. Keep the badge, ivory 4, its details, camera, center, and scale fixed. Give it a clear cool blue-and-silver glow across the face and metal, brighter than level 3. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The crest and side plates brighten together without a sweeping shine. Keep the 4 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 5 — gold-rim glow

Source: `public/assets/levels/5.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 5 crimson shield with gold crown, V-shaped rim, ruby, and ribbons in one continuous, silent, four-second loop. Keep the badge, ivory 5, its details, camera, center, and scale fixed. Give it a bright, soft warm glow on the crimson face and gold crown and rim, matching the supplied level 5 example. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The ruby stays completely unchanged in color and brightness; it does not pulse. The ribbon edges catch a little of the same stationary glow. Keep the 5 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 6 — still frosty glow

Source: `public/assets/levels/6.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Make a minimal, silent, four-second loop from this exact level 6 badge. Treat Image1 as a locked still image: the ivory 6, top diamond, side fins, shield outline, size, center, and crop remain in precisely the same position in every frame. The side fins are rigid decorative parts, not wings; they do not flap, flex, spread, or move. Do not zoom, scale, expand, tilt, pulse the badge, or animate any of its parts. Only add a thin, soft icy-blue glow immediately around the existing silver trim; its brightness rises slightly and falls once without growing wider. No snowflakes, sparkles, particles, falling objects, or other motion. The background stays exactly as Image1, with no new scene or background lighting. Begin and end on Image1's exact still appearance with the glow dimmed, for a clean loop. Use Image1 as both the first and last frame.
```

## Level 7 — royal jewel glow

Source: `public/assets/levels/7.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 7 burgundy shield with gold crown, rim, three pink jewels, and ribbons in one continuous, silent, four-second loop. Keep the badge, ivory 7, its details, camera, center, and scale fixed. Give it a rich burgundy-and-gold glow across the face and trim, stronger than level 6. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. At the glow peak, the jewels make one tiny center-left-right internal twinkle sequence; their shapes and positions never change. Keep the 7 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 8 — laurel radiance

Source: `public/assets/levels/8.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 8 green-and-gold laurel shield with an emerald in one continuous, silent, four-second loop. Keep the badge, ivory 8, its details, camera, center, and scale fixed. Give it a full warm gold glow on the face, rim, and both laurel branches, richer and broader than level 7. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The emerald holds one stationary highlight at the glow peak; the laurel branches stay still. Keep the 8 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

## Level 9 — violet flame glow

Source: `public/assets/levels/9.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 9 dark violet shield with gold horns, purple jewels, and two flames behind the crest in one continuous, silent, four-second loop. Keep the shield, ivory 9, gold horns, jewels, camera, center, and scale fixed; only the existing flames may move. Give it a deep violet-and-gold glow on the face, rim, horns, and jewels, stronger than level 8 but close to the badge. The face and existing trim brighten together in place, hold briefly, then dim smoothly; nothing sweeps or travels across the badge. The two existing flames make ONE gentle cycle: exact source shapes at 0 seconds, tips lift and brighten slightly at 2 seconds, then retrace the same path to their exact source shapes at 4 seconds. Their bases stay attached; no new tongues, smoke, or sparks. Ease to stillness at the loop seam. Keep the 9 readable, the pixel-art edges crisp, and the background unlit. Return the glow and every detail to Image1's exact appearance at the first/last-frame seam. No moving light band, floating glitter, camera motion, or cuts. Use Image1 as both the first and last frame.
```

If the generated flame still jumps at the seam, use its clean first half (source pose to slightly raised tips) and append that half in reverse, omitting the duplicate middle frame. The flames then return along the same path; check that the stationary glow also dims before the repeated join.

## Level 10 — champion glow and slow wing beat

Source: `public/assets/levels/10.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Make one continuous, silent, TEN-SECOND loop of this exact level 10 badge. Treat the source badge as a locked still image: the shield, crown, jewel, ivory 10, camera, framing, and overall outer bounds never move, grow, shrink, or zoom. Only the two short silver winglets make ONE extremely slow, tiny, synchronized hinge tilt, with their roots fixed to the shield. From 0 to 5 seconds each wing tip rises only a very small amount, staying inside the badge's original outer footprint; from 5 to 10 seconds both tips return along the identical path. No fast flapping, repeated beats, stretching, new feathers, or expanding wings. The close gold, purple, and silver glow brightens gradually WHILE the wings rise, peaks at exactly 5 seconds, and dims WHILE they lower; it never runs as a separate action. At 0 and 10 seconds the wing pose and glow match Image1 exactly, with no motion at the seam. Keep the 10 readable and pixel-art edges sharp. No traveling gleam, particles, background lighting, camera movement, or cuts. Use Image1 as both the first and last frame.
```

If Omni still expands the badge or adds extra beats, use only a clean five-second rising half **with its simultaneous glow**, then append that whole half in reverse, omitting the duplicate raised frame. If no generated half keeps the shield and wing roots fixed, animate the existing winglets and a glow overlay directly from the still asset for reliable geometry and timing.
