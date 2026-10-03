# Website artwork

Generated with built-in ImageGen using the shipped BB mode covers and fighter
portraits as visual references. Installed website assets live in
`public/assets/site/`; existing gameplay textures are preserved.

| Asset | Dimensions | Placement |
| --- | --- | --- |
| lushy-home-v2.webp | 1672 × 940 | Lushy Home backdrop, login and signup |
| mangrove-home.webp | 1600 × 900 | Mangrove Home backdrop, About map showcase |
| serenity-home.webp | 1600 × 900 | Serenity Home backdrop |
| bank-home.webp | 1600 × 900 | Bank Bust Home backdrop |
| about-hero.webp | 1600 × 900 | Desktop About hero |
| about-hero-mobile.webp | 900 × 900 | About hero at widths up to 650px |
| help-banner.webp | 1500 × 500 | Help, Feedback, Contact and My requests |
| welcome-news.webp | 1280 × 960 | Welcome news card and article |

Landscape assets also have 800 × 450 variants. About uses responsive `picture`
and `srcset` selection; its map showcase uses the smaller export. The revised
Lushy Home background uses its
native dimensions and lossless WebP on desktop and mobile, preserving every
generated pixel without downsampling. Its exact prompt and source are recorded
in `output/site-art/home-revision.json`. News and mode covers retain their 4:3 framing. Existing mode
covers, fighter portraits and support category icons remain the canonical art.
Legal pages retain their reading layout.

The lobby uses its original map backgrounds and fallback definitions. Its
first-paint script migrates previously cached website-art URLs back to the
original backgrounds. Generated website art is not used in the lobby.

Exact prompts, generation source paths, export settings and layout screenshots
are saved in `output/site-art/`. Run `export.py` there with Pillow to reproduce
the original exports from the retained generation sources. Original exports use
nearest-neighbor resizing and WebP quality 94, with no smoothing or palette
reduction. The Lushy revision is exported separately at native size with lossless
WebP; it is not processed by `export.py`.
