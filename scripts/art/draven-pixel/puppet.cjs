// Draven body as code: a palette plus one pixel map per body part, drawn back to
// front on a 64x64 logical canvas. `at` is the part's top-left in the rest pose,
// transcribed from public/assets/draven/body.webp (see pixels.cjs). Same format as
// scripts/art/sparrow-pixel/parts.cjs, rendered by scripts/art/pixel-rig/rig.cjs.
const SIZE = 64;

const PALETTE = {
  A: '#040213', // outline
  B: '#130c0d', // staff deep shadow
  C: '#1f0127', // magic deep
  D: '#0e1435', // robe deepest
  E: '#2e0137', // magic dark
  F: '#121a3f', // robe dark
  G: '#48161c', // staff shadow
  H: '#541c1b', // staff
  I: '#470b46', // grip shadow
  J: '#5a3a0a', // trim deep shadow
  K: '#4f104e', // grip mid
  L: '#2b2d5a', // robe mid
  M: '#5e0b63', // magic mid
  N: '#833920', // trim rust
  O: '#6b0776', // magic
  P: '#97401d', // trim shadow
  Q: '#423f74', // robe light
  R: '#fc0101', // ember
  S: '#454277', // robe highlight
  T: '#94422d', // staff light
  U: '#a5481a', // trim dark
  V: '#8a6944', // hem dust
  W: '#884375', // grip
  X: '#a05984', // grip light
  Y: '#fc9000', // trim
  Z: '#fda401', // trim light
  a: '#b66498', // grip highlight
  b: '#d746fc', // magic glow
  w: '#fff2ec', // spark white (effects only)
};

// Joint positions on the rest-pose canvas. Poses rotate parts around these.
const JOINTS = {
  waist: [27, 46], // the upper body leans around it
  neck: [26, 33],
  backShoulder: [20, 34],
  backWrist: [16, 45],
  frontShoulder: [34, 37],
  grip: [41, 39], // staff hand on the staff
  staffFoot: [38, 63],
  staffHead: [42, 25], // ember at the top of the staff
  hemTop: 46, // robe rows between this and the ground sway
  ground: 63,
};

// Back to front.
const PARTS = {
  robe: {
    at: [11, 46],
    rows: [
      '..........ASSLFFPYYYZA...',
      '..........ASLLFFYPYYYLA..',
      '..........ALLLFYYFPYYLA..',
      '.........AQLLFFYFLYPFLA..',
      '........AQLLLFYYFLYFFLA..',
      '........AZYYFFYFLLYFLLA..',
      '.......AZFFYYYYFLLYFLLA..',
      '.......AFSLFFYYFLLYFLLA..',
      '......ASSSLLFYFLLFYLLLA..',
      '.....ALSSLLFYYFFLFYLLLLA.',
      '.....LLSLLLLFYYFFFYLLLLA.',
      '...ALSSSLLLLLFYYYYFLLLLF.',
      '..AQSSSLLLSLLFFFYYFLLLLF.',
      '.AQSSSLLFQSLLFLLFFYYFLLF.',
      'ALVSSLLLLQQLLFQLFFFYYYYZ.',
      'AZYYFLFFQQLLFQQLLFFFYYYYF',
      'AAAYYYAQSLLFQQLLLLFFFFFFF',
      '...AAAAAAAAAAAAAAAAAAAA..',
    ],
  },
  torso: {
    at: [22, 33],
    rows: [
      'YFYZZZZZZA..',
      'FFFYZZZZFFA.',
      'FFZFFYYFFYQA',
      'AFLYFLLFYFLA',
      'AFLFZZLLYFFL',
      '.AFLNZFLFZFL',
      '.AFFLZZLFZFL',
      '..AFLFZFLFAF',
      '..AFLLZZLLA.',
      '.AYZFLFZFLA.',
      '.APYZPFZZFZA',
      'AFLYYYZZZZZA',
      'ASLFFYYYZZA.',
    ],
  },
  backArm: {
    at: [12, 32],
    rows: [
      '......AQSF',
      '.....AQQSL',
      '.....QSLLF',
      '.....SSLLA',
      '....ASLLLA',
      '...ASLLFA.',
      '..ASSLLA..',
      '..ASSLFA..',
      '.ASSLLA...',
      '.ASLLLA...',
      'ALLLLZZA..',
      'ALLLZFDA..',
      'ALZZFZZA..',
    ],
  },
  backHand: {
    at: [12, 45],
    rows: [
      'AZZAXXXXA',
      'AZAKXXKXA',
      'ABAXXKWA.',
      '..AXKKX..',
      '..AXAK...',
      '...A.A...',
    ],
  },
  hood: {
    at: [16, 20],
    rows: [
      '.........AAA.......',
      '.......AASSSA......',
      '......ASSSLLLA.....',
      '.....ASSSLZZZA.....',
      '.....ALLLLUFFZA....',
      '....ASLLLFFYFZA....',
      '...AASLLZFYYFFA....',
      'AAAASLLZFYYYFFAA...',
      'JZZAALLYFFYYFFYAA.A',
      'APYZZZAYYFFYFFYAZZA',
      '.AUYYZZAYFFFFFYAZYA',
      '.AUDDYZZDFYYFYDZZA.',
      '......ZZZZZDFDDZA..',
    ],
  },
  staff: {
    at: [34, 21],
    // Rows 36-41 are the shaft hidden under the hand, so the staff can slide
    // through the grip (pose.cjs `slide`).
    rows: [
      '.......H...',
      '.......HH..',
      '......HH.H.',
      '......H..H.',
      '..........H',
      '...........',
      '...........',
      '...........',
      '.....ATAHAA',
      '.....ATAHHA',
      '......AAATA',
      '......AATA.',
      '.......HHA.',
      '.......THA.',
      '.......THA.',
      '......ATH..',
      '......ATHA.',
      '......AHHA.',
      '......AHA..',
      '......AHA..',
      '......AHA..',
      '......AHA..',
      '......AHA..',
      '......AHA..',
      '.....ATH...',
      '.....ATH...',
      '.....ATH...',
      '.....AHH...',
      '.....AHH...',
      '.....AHH...',
      '.....ATG...',
      '.....ATA...',
      '.....ATA...',
      '....AHHA...',
      '....ATHA...',
      '....ATHA...',
      '.A..HTA....',
      '.A.AHHA....',
      '.A.AHHA....',
      '.A.ATHA....',
      '...ATA.....',
      '...AHA.....',
      'AAA.A......',
    ],
  },
  frontArm: {
    at: [34, 36],
    rows: [
      'AA....',
      'LQAAA.',
      'QQSZZ.',
      'LLLZZ.',
      'FLLYZ.',
      'AFFYY.',
      '.AAYYA',
      '...AA.',
    ],
  },
  grip: {
    at: [39, 36],
    rows: [
      'AATA.',
      'AXIXA',
      'AXIXA',
      'AXIIA',
      'AAIAA',
      'AAAA.',
    ],
  },
  magic: {
    at: [33, 15],
    rows: [
      '....AA.........',
      '..AAOOA........',
      '.AOOOOA........',
      'AOOEEbE........',
      'AEOEbEE........',
      '.AEEbEE........',
      '.AEEbEEE.KA....',
      '..AEEbEA..KIA..',
      '...EEbA..R.KIE.',
      '...AEEb.RR.KKbA',
      '....ACERRZR.bEA',
      '.....AEMRZRGbC.',
      '......AEKREEIA.',
      '.......AKKEbA..',
    ],
  },
  crystal: {
    at: [40, 8],
    rows: [
      '...A....',
      '..AOA...',
      '..AObA..',
      '.AOObOA.',
      '.AOEbOOA',
      'AEOEEbOO',
      'AbEEEbEO',
      'AEbEaEEA',
      '.AEbbEA.',
      '..AEbA..',
      'A..EbA..',
      'EA.AbA..',
      'EAA.A...',
    ],
  },
  shardLeft: {
    at: [35, 8],
    rows: [
      '...AA',
      '..AbA',
      '.AOEA',
      'AOOA.',
      'AMEA.',
      '.AA..',
    ],
  },
  shardRight: {
    at: [48, 13],
    rows: [
      'A...',
      'A...',
      '....',
      '....',
      '....',
      '....',
      'AOA.',
      'AOO.',
      'AbOA',
      '.CEA',
      '.AE.',
      '..A.',
    ],
  },
};

module.exports = { SIZE, PALETTE, JOINTS, PARTS };
