// Palette is the only per-bro styling input. Frame geometry is shared with all
// portraits so new body artwork never needs a hand-painted profile icon.
export const BRO_PORTRAIT_PALETTES = {
  ninja: { main: '#bb3349', highlight: '#ffd5cc', shadow: '#480f28' },
  thorg: { main: '#d29535', highlight: '#fff1b0', shadow: '#563019' },
  draven: { main: '#974adc', highlight: '#efd1ff', shadow: '#321747' },
  wizard: { main: '#347de0', highlight: '#d0f5ff', shadow: '#102e66' },
  huntress: { main: '#43aa77', highlight: '#dbffba', shadow: '#123f38' },
  gloop: { main: '#38bfd1', highlight: '#d1ffff', shadow: '#125268' },
};

// Fuller corner mosaics with individually shaded six-pixel cells. Adjacent
// cells vary in opacity so the corner never becomes one solid color block.
// Each corner has its own stable layout.
const CHROMA_CORNERS = [
  [[0, 0, .12], [6, 0, .24], [0, 6, .19], [6, 6, .08],
    [12, 0, .16], [24, 0, .1], [30, 0, .06], [6, 12, .14],
    [18, 6, .08], [0, 24, .12], [0, 30, .07], [12, 24, .06], [42, 0, .05]],
  [[0, 0, .2], [6, 0, .09], [0, 6, .1], [6, 6, .17],
    [18, 0, .13], [24, 0, .07], [12, 12, .09], [0, 18, .15],
    [6, 24, .08], [0, 36, .06], [30, 6, .05], [42, 0, .04]],
  [[0, 0, .09], [6, 0, .18], [0, 6, .22], [6, 6, .11],
    [12, 6, .07], [0, 12, .13], [18, 0, .14], [24, 0, .08],
    [0, 24, .1], [6, 30, .06], [24, 12, .05], [36, 0, .06], [0, 42, .04]],
  [[0, 0, .17], [6, 0, .08], [0, 6, .11], [6, 6, .23],
    [12, 0, .13], [6, 18, .1], [0, 24, .07], [24, 0, .12],
    [30, 6, .06], [18, 12, .05], [0, 36, .06], [42, 0, .04]],
];

export function buildPortraitChromaCells(color, corner = 0) {
  const cells = CHROMA_CORNERS[corner];
  return `<g fill="${color}" shape-rendering="crispEdges">${cells.map(([x, y, opacity]) =>
    `<rect x="${x}" y="${y}" width="6" height="6" opacity="${opacity}"/>`
  ).join('')}</g>`;
}

export function buildPortraitChromaTile(palette, corner = 0) {
  const transforms = ['', 'translate(48 0) scale(-1 1)', 'translate(0 48) scale(1 -1)', 'translate(48 48) scale(-1 -1)'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48"><g transform="${transforms[corner]}">${buildPortraitChromaCells(palette.main, corner)}</g></svg>`;
}

export function buildBroPortraitSvg(bodyUrl, palette) {
  const { main, highlight, shadow } = palette;
  // Embedded body data keeps this SVG self-contained when used as an <img>.
  const cornerDetails = [
    'translate(7 7)', 'translate(249 7) scale(-1 1)',
    'translate(7 249) scale(1 -1)', 'translate(249 249) scale(-1 -1)',
  ].map((transform, corner) => `<g transform="${transform}">${buildPortraitChromaCells(main, corner)}</g>`).join('');
  const rimAccents = [0, 180].map(angle => `
    <g transform="rotate(${angle} 128 128)">
      <path fill="${shadow}" d="M116 2H140V6H135V8H121V6H116Z"/>
      <path fill="${main}" fill-opacity=".75" d="M117 2H139V5H134V7H122V5H117Z"/>
      <path fill="${highlight}" fill-opacity=".38" d="M120 2H136V3.5H120Z"/>
      <path d="M43 4H54M202 4H213" fill="none" stroke="${highlight}" stroke-opacity=".24" stroke-width="1.5"/>
    </g>`).join('');
  return `<svg id="bro-portrait" xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
    <defs>
      <linearGradient id="rim" x2=".75" y2="1"><stop stop-color="${highlight}" stop-opacity=".6"/><stop offset=".45" stop-color="${main}" stop-opacity=".7"/><stop offset="1" stop-color="${shadow}"/></linearGradient>
      <radialGradient id="glow" cx=".5" cy=".5" r=".65"><stop stop-color="${main}" stop-opacity=".32"/><stop offset=".5" stop-color="${main}" stop-opacity=".12"/><stop offset="1" stop-color="${main}" stop-opacity="0"/></radialGradient>
      <clipPath id="portrait"><rect x="6" y="6" width="244" height="244" rx="18"/></clipPath>
    </defs>
    <rect width="256" height="256" rx="24" fill="#101018"/>
    <rect x="2" y="2" width="252" height="252" rx="22" fill="url(#rim)"/>
    <g clip-path="url(#portrait)">
      <path fill="#020504" d="M6 6H250V250H6Z"/>
      <path fill="url(#glow)" d="M6 6H250V250H6Z"/>
      ${cornerDetails}
    </g>
    <image href="${bodyUrl}" x="25" y="32" width="206" height="218" preserveAspectRatio="xMidYMax meet" clip-path="url(#portrait)"/>
    ${rimAccents}
  </svg>`;
}
