// Tiny pixel-art sprites drawn as crisp SVG rects. Each sprite is a list of
// equal-length rows; "." is transparent and other characters index the palette.
const INK = "#071019";

const SPRITES = {
  friends: {
    palette: { k: INK, w: "#eaf6ff", s: "#9cc9ea", b: "#4fa3e0", d: "#2c6aa0" },
    rows: [
      "......kkkk..",
      ".....kbbbbk.",
      ".kkk.kbbbbk.",
      "kwwwkkbbbbk.",
      "kwwwk.kkkk..",
      "kwwwk.kdddk.",
      ".kkk.kddddk.",
      "kwwwwkbbbbbk",
      "kwssskbbbbbk",
      "kwssswkddddk",
      "kwwwwwkkkkkk",
      "kkkkkkk.....",
    ],
  },
  chat: {
    palette: { k: INK, w: "#eaf6ff", d: "#2c6aa0" },
    rows: [
      ".kkkkkkkk.",
      "kwwwwwwwwk",
      "kwwdwdwdwk",
      "kwwwwwwwwk",
      ".kwwkkkkk.",
      ".kwk......",
      ".kk.......",
    ],
  },
  trash: {
    palette: { k: INK, g: "#cbd5e1", r: "#f87171", d: "#b91c1c" },
    rows: [
      "...kkkk...",
      "kkkkggkkkk",
      "kggggggggk",
      "kkkkkkkkkk",
      ".krdrdrdk.",
      ".krdrdrdk.",
      ".krdrdrdk.",
      ".krdrdrdk.",
      ".kkkkkkkk.",
    ],
  },
  invite: {
    palette: { k: INK, w: "#eaf6ff", g: "#4ade80" },
    rows: [
      "..kkk.....",
      ".kwwwk..g.",
      ".kwwwk.ggg",
      "..kkk...g.",
      ".kwwwk....",
      "kwwwwwk...",
      "kwwwwwk...",
      "kkkkkkk...",
    ],
  },
  check: {
    palette: { k: INK, g: "#4ade80" },
    rows: [
      ".......kk",
      "......kgk",
      ".kk..kgk.",
      "kgk.kgk..",
      ".kgkgk...",
      "..kgk....",
      "...k.....",
    ],
  },
  cross: {
    palette: { r: "#f87171" },
    rows: [
      "rr....rr",
      ".rr..rr.",
      "..rrrr..",
      "...rr...",
      "..rrrr..",
      ".rr..rr.",
      "rr....rr",
    ],
  },
  back: {
    palette: { w: "#eaf6ff" },
    rows: [
      "...w....",
      "..ww....",
      ".wwwwwww",
      "wwwwwwww",
      ".wwwwwww",
      "..ww....",
      "...w....",
    ],
  },
  heart: {
    palette: { r: "#fb7185", p: "#fecdd3", d: "#be123c" },
    rows: [
      ".rr.rr.",
      "rprrrrr",
      "rrrrrrr",
      ".rrrrd.",
      "..rrd..",
      "...d...",
    ],
  },
  envelope: {
    palette: { k: INK, w: "#eaf6ff", s: "#b8d6ee" },
    rows: [
      "kkkkkkkkkkkkkkkk",
      "kkwwwwwwwwwwwwkk",
      "kwkwwwwwwwwwwkwk",
      "kwwkwwwwwwwwkwwk",
      "kwwwkwwwwwwkwwwk",
      "kwwwwkkwwkkwwwwk",
      "kwwwwwwkkwwwwwwk",
      "kwwwwwwwwwwwwwwk",
      "kssssssssssssssk",
      "kssssssssssssssk",
      "kkkkkkkkkkkkkkkk",
    ],
  },
  controller: {
    palette: { k: INK, w: "#9fb6cc", r: "#fb7185", y: "#facc15" },
    rows: [
      "..kkkkkkkkkkkk..",
      ".kwwwwwwwwwwwwk.",
      "kwwkwwwwwwwwrwwk",
      "kwkkkwwwwwwywrwk",
      "kwwkwwwwwwwwywwk",
      "kwwwwwkkkkwwwwwk",
      "kwwwwk....kwwwwk",
      ".kkkk......kkkk.",
    ],
  },
};

export function pixelSprite(name, scale = 2, className = "") {
  const sprite = SPRITES[name];
  if (!sprite) return "";
  const height = sprite.rows.length;
  const width = sprite.rows[0].length;
  let rects = "";
  sprite.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const color = sprite.palette[row[x]];
      if (color) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${color}"/>`;
    }
  });
  return `<svg class="bb-pixel ${className}" viewBox="0 0 ${width} ${height}" width="${width * scale}" height="${height * scale}" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
}
