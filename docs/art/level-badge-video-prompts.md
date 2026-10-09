# Level badge video prompts for Gemini Omni

These prompts animate the ten installed badges at `public/assets/levels/1.webp` through `10.webp`. Generate each badge separately with its own image attached. The source artwork, including its number, is the exact design reference. The prompts are for video candidates; the game currently displays the still WebP files.

## Setup and review

Google's [Gemini Omni Flash guide](https://ai.google.dev/gemini-api/docs/omni) recommends precise image-to-video motion, explicitly asking for a single continuous shot, and using the same image as both first and last frame for a loop. Its source syntax is `[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1]`. Upload the relevant badge once as **Image1**, then paste the corresponding prompt below. If the interface asks for two frame uploads instead, upload the same badge as both frames. Ask for a roughly four-second clip with no audio. The API currently offers 16:9 and 9:16 video, so keep the badge in the center square-safe area for later cropping; do not stretch the square source to fill a wide frame.

Each prompt specifies a single stationary shot and a distinct, restrained path for glittering highlights across the badge. The traveling light should feel like a narrow, low-opacity sheen gliding smoothly over the existing art, with an occasional soft surface twinkle. Do not animate it as discrete square pixels, stepped flashes, or a string of moving dots. Keep the badge artwork itself pixel-sharp and stationary. Check the actual first/last frames and the wraparound before using a result: image generation may still drift, change a numeral, or add a backdrop. A loop instruction is a target, not a guarantee of a seamless file. The current WebP badges have transparent backgrounds; Omni's documented video response is MP4, so verify background removal and alpha separately before considering a video for in-game use. Do not install a generated clip over the still assets without review.

## Level 1 — copper diagonal

Source: `public/assets/levels/1.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 1 bronze pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Keep its center, size, outline, angle, and margins perfectly fixed; the ivory 1 stays readable. A quiet copper glitter travels diagonally from the top stud across the bronze rim and face to the lower point. A narrow, translucent sheen glides continuously over the surface, briefly touching part of the 1 without washing it out; a single soft twinkle stays attached to the stud. The light fades until the original appearance returns. Keep the badge art crisp and its flat stepped shading intact; no block-by-block glint motion, no floating glitter, bloom, camera movement, wobble, new ornament, cuts, or background scene. First and last frames match Image1 exactly. Use Image1 as both the first and last frame.
```

## Level 2 — rivet circuit

Source: `public/assets/levels/2.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 2 bronze pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Lock its center, scale, silhouette, and ivory 2 in place. A restrained gold glitter starts on the top bar, touches the left rivet, passes as tiny highlights across the bronze face and 2, then touches the right rivet and lower rim. Use one narrow, translucent traveling sheen with a couple of soft surface twinkles, never a sequence of lit square pixels; the rivets and bar never move or change shape. Return all highlights to the original bronze and gold shades by the end. Preserve chunky square pixels and number contrast. No floating sparkles, rays, bloom, camera motion, cuts, or background scene. First and last frames match Image1 exactly. Use Image1 as both the first and last frame.
```

## Level 3 — leaf-light trail

Source: `public/assets/levels/3.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 3 green pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Anchor the shield, gold leaves, bottom diamond, and ivory 3 at their source positions and sizes. A subtle leaf-gold glitter begins in the top leaf vein, then a few small green and gold highlights travel down both sides of the shield, briefly cross the 3, and finish at the bottom diamond. Let the light glide as a soft, narrow highlight rather than hopping between square pixels; no leaf sways or grows. All colors return to the original frame for the loop. Preserve dark outlines, stepped edges, and a limited flat palette. No floating particles, glow, camera movement, deformation, cuts, or background scene. Use Image1 as both the first and last frame.
```

## Level 4 — split silver glint

Source: `public/assets/levels/4.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 4 blue and silver pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Keep the badge centered and immobile at constant scale, with its ivory 4 and sharp outline intact. A cool silver glitter splits at the crest's top point and follows both upper edges toward the side plates; a few pale-blue highlights cross the blue face and 4 before the glints meet at the lower tip. Use one low-opacity, continuous sheen and at most one soft surface twinkle; avoid blocky flashes. Return to the source shades and exact first-frame layout by the end. Retain crisp staircase contours and flat colors. No ice particles, bloom, rotation, camera movement, cuts, or background scene. Use Image1 as both the first and last frame.
```

## Level 5 — ruby-to-rim shimmer

Source: `public/assets/levels/5.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 5 crimson and gold pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Pin its center, scale, gold crown, ribbons, and ivory 5 in place. A small ruby glint appears inside the top gem, then restrained warm highlights travel down the gold border, across the red face and part of the 5, and briefly touch both ribbon tips. The glimmer is a narrow, softly feathered sheen moving continuously, with one gentle surface twinkle; the gem and ribbons never change shape or move. Settle every highlight back to the original colors and framing at the end. Keep the underlying pixel art sharp and its flat shading intact; no blocky light steps. No rays, floating sparks, halo, camera movement, cuts, or background scene. Use Image1 as both the first and last frame.
```

## Level 6 — frosted cascade

Source: `public/assets/levels/6.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 6 icy blue pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Keep the shield, side fins, silver trim, and ivory 6 fixed in position and shape. A tiny blue-white glint begins inside the top diamond; a restrained frosted sheen descends smoothly through the silver shoulders, blue face, parts of the 6, and finally the lower point and side fins. The sheen is translucent and continuous, with one soft twinkle attached to the gem; no individual square pixels popping on and off. Nothing rotates, flaps, expands, or extends outside the badge; all facets return to their starting colors. Preserve hard pixel edges and compact silhouette. No snow, floating particles, bloom, camera motion, cuts, or background scene. First and last frames match Image1. Use Image1 as both the first and last frame.
```

## Level 7 — jewel sequence

Source: `public/assets/levels/7.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 7 burgundy and gold pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Lock the badge, ribbons, three pink jewels, and ivory 7 to their original positions, shapes, and scale. A subtle glittering sequence runs from the center jewel to the two side jewels, then down the gold shoulders, across small areas of the burgundy face and 7, and out along the lower rim and ribbon edges. The light glides continuously as a narrow translucent sheen with at most two gentle surface twinkles, without blocky flashes. The jewels stay rigid and all highlights return to the source colors by the end. Keep coarse pixels, dark outlines, and flat shading. No floating sparks, rays, camera motion, cuts, or background scene. First and last frames match Image1. Use Image1 as both the first and last frame.
```

## Level 8 — emerald laurel shimmer

Source: `public/assets/levels/8.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 8 green and gold pixel-art laurel shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Keep the shield, emerald, ivory 8, and both laurel branches completely still at constant scale. A tiny emerald glint starts at the top stone, then restrained gold glitter descends around the shield and climbs the paired laurel leaves from bottom to top; one or two green highlights briefly cross the face and 8. Keep the light as a smooth, low-opacity sheen with one or two soft surface twinkles, not a ladder of lit square pixels. The leaves never bend, grow, or detach, and every color returns to its starting shade. Preserve chunky pixel clusters and flat shading. No floating leaves, particles, bloom, camera movement, cuts, or background scene. First and last frames match Image1. Use Image1 as both the first and last frame.
```

## Level 9 — violet arc

Source: `public/assets/levels/9.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 9 dark violet and gold pixel-art shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Lock the shield, gold horns, central purple jewel, bottom jewel, violet flames, and ivory 9 to the same coordinates and size. A restrained purple glitter begins in the existing flame facets, arcs through the top jewel and gold horns, then traces tiny highlights across the dark face, the 9, and the lower jewel. Use a narrow, fluid sheen and one soft jewel twinkle instead of pixel-by-pixel flashes; the flames stay within their silhouette and emit no particles. Return all pixels to the original palette and silhouette at the end. Retain hard stepped edges. No smoke, floating sparks, strong glow, camera motion, cuts, or background scene. First and last frames match Image1. Use Image1 as both the first and last frame.
```

## Level 10 — crown and wing glints

Source: `public/assets/levels/10.webp`

```text
[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image1] Animate this exact level 10 gold and purple pixel-art champion shield in one unbroken, silent, four-second shot. The light moves fluidly across the badge while the original pixel-art edges stay sharp. Keep the crown, purple jewel, shield, ivory 10, and both short silver winglets perfectly fixed at the same scale and center. A small violet glint starts in the crown jewel; restrained gold highlights travel around the crown and shield rim while silver glints move outward through both winglets, and a few pale facets briefly cross the purple face and 10. Use one narrow, smoothly traveling sheen and one or two small soft twinkles on the badge surface, without square flashes. The winglets never flap or extend; all highlights settle back to the exact source colors. Preserve crisp square pixels and dark outlines. No floating particles, halos, rays, camera movement, cuts, or background scene. First and last frames match Image1. Use Image1 as both the first and last frame.
```
