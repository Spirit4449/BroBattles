// Shared constants for the code-side Ninja: the palette every pose is drawn in
// and the grid the poses live on.
const SIZE = 88; // pose grid, in art pixels
const GROUND = 84; // first row below the soles
const FEET_X = 44; // column the stance is centred on: the sprite's horizontal anchor
const HEIGHT = 54; // standing height in art pixels, head to sole

const PALETTE = {
  k: '#111323', // outline
  D: '#2f2b30', // cloth shadow
  d: '#3e383d', // cloth
  g: '#5d545a', // cloth light
  s: '#fbb87f', // skin
  R: '#a00011', // scarf / sash shadow
  r: '#fc0419', // scarf / sash
  M: '#9d9d9c', // wraps shadow
  m: '#c8c7c4', // wraps
  w: '#fdfdfd', // eye glint
  B: '#22335c', // shuriken shadow
  b: '#3f66ad', // shuriken
  l: '#a9c3ec', // shuriken edge light
};
const RGB = Object.fromEntries(Object.entries(PALETTE).map(([ch, hex]) => [ch, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));

module.exports = { SIZE, GROUND, FEET_X, HEIGHT, PALETTE, RGB };
