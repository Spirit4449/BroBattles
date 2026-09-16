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

export function buildBroPortraitSvg(bodyUrl, palette) {
  const { main, highlight, shadow } = palette;
  // Embedded body data keeps this SVG self-contained when used as an <img>.
  // Restrained inner corner arcs follow the rounded rim. Only the top and
  // bottom get a small stepped accent, keeping decoration away from the body.
  const cornerDetails = [0, 90, 180, 270].map(angle => `
    <g transform="rotate(${angle} 128 128)">
      <path d="M12 34V25Q12 12 25 12H34" fill="none" stroke="${main}" stroke-opacity=".3" stroke-width="1.5" stroke-linecap="round"/>
    </g>`).join('');
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
    <image href="${bodyUrl}" x="25" y="24" width="206" height="218" preserveAspectRatio="xMidYMax meet" clip-path="url(#portrait)"/>
    ${rimAccents}
  </svg>`;
}
