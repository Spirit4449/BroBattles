// Bundle current portraits so previews update with the application build.
// These are small copies of each body.webp (scripts/art/build-portraits.cjs);
// the full-size art added ~2.5 MB of base64 to every bundle that imports this.
import { BRO_PORTRAIT_PALETTES, buildBroPortraitSvg } from "./broPortrait.mjs";
import body0 from "../../../public/assets/ninja/portrait.webp?portrait";
import body1 from "../../../public/assets/ninja/skins/ninja-arena-sovereign/portrait.webp?portrait";
import body2 from "../../../public/assets/thorg/portrait.webp?portrait";
import body5 from "../../../public/assets/draven/portrait.webp?portrait";
import body6 from "../../../public/assets/ozzy/portrait.webp?portrait";
import body7 from "../../../public/assets/sparrow/portrait.webp?portrait";
import body8 from "../../../public/assets/gloop/portrait.webp?portrait";
import body9 from "../../../public/assets/gloop/skins/gloop-amethyst/portrait.webp?portrait";

const bodies = {
  "/assets/ninja/body.webp": body0,
  "/assets/ninja/skins/ninja-arena-sovereign/body.webp": body1,
  "/assets/thorg/body.webp": body2,
  "/assets/draven/body.webp": body5,
  "/assets/ozzy/body.webp": body6,
  "/assets/sparrow/body.webp": body7,
  "/assets/gloop/body.webp": body8,
  "/assets/gloop/skins/gloop-amethyst/body.webp": body9,
};

export function resolveBodyPortrait(url) {
  return bodies[url] || url;
}

const framedPortraits = new Map();

export function buildFramedBodyPortrait(character, url) {
  const key = `${character}:${url}`;
  if (!framedPortraits.has(key)) {
    const palette = BRO_PORTRAIT_PALETTES[character] || BRO_PORTRAIT_PALETTES.ninja;
    const svg = buildBroPortraitSvg(resolveBodyPortrait(url), palette);
    framedPortraits.set(key, `data:image/svg+xml,${encodeURIComponent(svg).replace(/'/g, "%27")}`);
  }
  return framedPortraits.get(key);
}
