// Ozzy body as code: a palette plus one pixel map per body part, drawn back to
// front on a 64x64 logical canvas. `at` is the part's top-left in the rest pose,
// split from the transcription of public/assets/ozzy/body.webp (pixels.cjs).
// Same format as scripts/art/sparrow-pixel/parts.cjs, rendered by
// scripts/art/pixel-rig/rig.cjs. Parts marked poseOnly draw only when a pose
// lists them: the striding legs and the satchel the book becomes in action.
const SIZE = 64;

const PALETTE = {
  A: '#010204', // eye / deepest
  B: '#090b1b', // outline
  C: '#2a1911', // wood deep shadow
  D: '#221c4b', // trousers / sleeve shadow
  E: '#472b19', // wood shadow
  F: '#2a2257', // crystal shadow
  G: '#593721', // wood mid
  H: '#481f4a', // robe trim shadow
  K: '#3c2876', // cloak shadow
  M: '#652161', // robe deep
  N: '#764d36', // wood
  Q: '#7c2374', // coat shadow
  R: '#6933bd', // cloak
  S: '#a3379c', // robe
  T: '#b08669', // skin shadow
  W: '#b0adad', // beard shadow
  X: '#4ad0fa', // crystal
  Z: '#fdcf7a', // skin / gold trim
  b: '#fddc9d', // skin light
  d: '#f1f2f2', // beard / pages
};

// Joint positions on the rest-pose canvas. Poses rotate parts around these.
const JOINTS = {
  waist: [31, 44], // the upper body leans around it
  neck: [31, 33],
  nearShoulder: [24, 31], // staff arm
  nearWrist: [16, 30], // the fist on the staff
  farShoulder: [38, 36], // open-palm arm
  palm: [47, 35],
  book: [45, 28],
  grip: [16, 29], // staff in the fist
  staffHead: [16, 16], // crystal
  staffFoot: [16, 63],
  hip: [35, 46], // template leg (thigh/shin), facing right
  knee: [36, 57],
  hipBack: [28, 46], // rest-pose rear leg
  coatBackTop: [30, 45],
  coatFrontTop: [35, 45],
  ground: 63,
};

const PARTS = {
  legL: {
    at: [20, 48],
    rows: [
      '...........D',
      '..........DD',
      '.........DDD',
      '........DDB.',
      '..BK....DB..',
      '.BKK...DDB..',
      'BKKKDDDDB...',
      'B......B....',
    ],
  },
  bootL: {
    at: [17, 55],
    rows: [
      '....BKKDDB',
      '...BEECCB.',
      '...BEECCB.',
      '...BECCCB.',
      '...EECCB..',
      '...ECCC...',
      '..BCCCB...',
      'BEECCCB...',
      'BCCCCCB...',
    ],
  },
  farArm: {
    at: [38, 33],
    rows: [
      'B..........BB',
      'KB......BBBZB',
      'DKB....BZGZTB',
      'KKKBBBBZZGZB.',
      'DDKKDDDTTTB..',
      'DDDDDDDBBB...',
      'BBBBB........',
    ],
  },
  book: {
    at: [39, 22],
    rows: [
      '....ddE..B...',
      '....WWdBBdB..',
      '...BWWddBdBdB',
      '.BWWWdWdWdWdE',
      'BEEEGddWddWEE',
      'BECCCCEEEECB.',
      'BECCCCCCEEB..',
      'BECCCCCCECB..',
      'BECCCCCEECB..',
      '.ECCCCEECB...',
      '....BEECB....',
      '.....BBB.....',
    ],
  },
  torso: {
    at: [23, 29],
    rows: [
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHHZRR',
      'KKKRRRKZHSHSTRK',
      'KKBKRRKZHSHSGKK',
      'KKBKKKZHSSHSGKB',
      'KKKZKZZHSSHSTZB',
      '...BHHSSSHSSMB.',
      '...BSSSSSHSSMB.',
      '....CCSSSTTTM..',
      '...BCECCCTCTCB.',
      '..BSSSBBCTCTCB.',
      '.BSSSSQQBTTTBBB',
    ],
  },
  satchel: {
    poseOnly: true,
    at: [25, 36],
    rows: [
      'BBBBBBB',
      'BECCCdB',
      'BCCCCdB',
      'BCECCdB',
      'BCCCCdB',
      'BECCEdB',
      'BBBBBBB',
    ],
  },
  legR: {
    at: [32, 45],
    rows: [
      'DDC...',
      'DD....',
      'DD....',
      'DDD...',
      'DKK...',
      'DKKD..',
      'DDKDD.',
      '.DKKDD',
      '.BDKKD',
      '..BKKD',
    ],
  },
  bootR: {
    at: [33, 55],
    rows: [
      '.BKECB....',
      '.BECCB....',
      '.BECCB....',
      '.BECCB....',
      '.EECCB....',
      '.EECCB....',
      'BEECCEBB..',
      'BECCCCCCEB',
      'BBBBBBBBBB',
    ],
  },
  thigh: {
    poseOnly: true,
    at: [33, 45],
    rows: [
      'DDDKK',
      'DDDKK',
      'DDKKK',
      'DDKKD',
      'DDKKD',
      '.DKKD',
      '.DKKD',
      '.DKKD',
      '.DKKD',
      '.DKKD',
      '.DKKD',
      '.DKKD',
      '.KKD.',
    ],
  },
  // Action-pose legs run 2px longer in thigh and shin than the rest pose's,
  // for the legacy run's long strides; the coat hides the difference.
  shin: {
    poseOnly: true,
    at: [33, 55],
    rows: [
      '..KD.',
      '..KKD',
      '.BKEC',
      '.BECC',
      '.BECC',
      '.BECC',
      '.BECC',
      '.BECC',
      '.EECC',
      '.EECC',
    ],
  },
  // The boot's foot, posed apart from the shin so a planted foot stays flat.
  foot: {
    poseOnly: true,
    at: [33, 64],
    rows: [
      '.EECCB....',
      'BEECCEBB..',
      'BECCCCCCEB',
      'BBBBBBBBBB',
    ],
  },
  coatBack: {
    at: [18, 45],
    rows: [
      '.....BSSSSSQQQ',
      '....BSSSSSQQQB',
      '..BBSSSSSSQQQB',
      '.BSSSSSSSQQQB.',
      'BQSSSSSSQQQB..',
      'BQSSSSSQQQB...',
      '.BBBBBQQQQ....',
      '......HQQB....',
      '......BBB.....',
    ],
  },
  coatFront: {
    at: [34, 45],
    rows: [
      '.QQSB....',
      'BQQSSB...',
      'BQQQSMB..',
      '.HQQSSSB.',
      '.BQQQSSB.',
      '..BQQQSSB',
      '...BQQQSB',
      '....QQQB.',
      '....QQB..',
      '....BB...',
    ],
  },
  head: {
    at: [20, 16],
    rows: [
      '........BBBB.......',
      '......BBRRRBB......',
      '......BRRRRRRBB....',
      '....BRRRRRKRRRRB...',
      '...BRRRRRKZZZZRRB..',
      '..BRKRRKTZHTTHHRRB.',
      '.BRKKRKZZHddTTTZRB.',
      'BRKKRRTZHTTdTWdHZRB',
      'BKKKRRZHWTdAZdAHZRB',
      'BKKRRZHWdZdGZbAHHZB',
      '.BKRZZHWWdZZZZTHHZB',
      '..BKZHTdWdWdWWWHZB.',
      '..BBKZHWWWWWddddBB.',
      '........HWWWdddWB..',
      '........ZHWWWdddB..',
      '........KZHWWWddBB.',
      '........KZHHWWWdBRB',
      '........RKZHHHWWRR.',
    ],
  },
  nearArm: {
    at: [17, 29],
    rows: [
      '....BRRBBTZ',
      '...BRRRRKKK',
      '..BRRRRRRKK',
      'KBBRRRRRKRR',
      'KKKKRRKKKRR',
      'DKKKRKKB...',
      'DDKDKKKB...',
      'DDDDKKB....',
      '.BDDBB.....',
      '..BB.......',
    ],
  },
  staff: {
    at: [12, 8],
    rows: [
      '.....BB...',
      '.....XB...',
      '.BBB.XB...',
      '.BXB.B....',
      '..B.BF....',
      '...BXFB...',
      '..BBXXBB..',
      '.BXBddXBB.',
      'BBXddHXNBB',
      'BNXddHENNB',
      'BNEXdHENNB',
      'BEEXXXEEB.',
      '.BEEXEEBB.',
      '.BBNECB...',
      '..BBEB....',
      '...BNC....',
      '...BNC....',
      '...BEC....',
      '...BGC....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
      '...BE.....',
      '...BN.....',
      '...BN.....',
      '...BN.....',
    ],
  },
  fist: {
    at: [13, 27],
    rows: [
      '.BZZBB',
      'BZZTTB',
      'BZZZTB',
      'BZZTBB',
      'BBCBB.',
    ],
  },
};

// Action-pose arms: a straight sleeve, forearm and hand hanging from the
// shoulder, posed like the legs (2px longer per segment than the rest-pose
// arms, so reaches read like the legacy art's). They sit off to the side of the rest canvas
// (poseOnly, never drawn at rest); figure() moves their shoulder onto the body.
const ARM = {
  upper: { poseOnly: true, at: [52, 40], rows: [
    '.RRR.',
    'RRRRK',
    'RRRKK',
    'RRKKD',
    'KKKKD',
    '.KKKD',
    '.KKKD',
    '.KKD.',
    '.KKD.',
    '.KKD.',
  ] },
  fore: { poseOnly: true, at: [53, 48], rows: [
    'KKD',
    'KKD',
    'KKD',
    'KKD',
    'KDD',
    'KDD',
    'KDD',
    'RRK',
  ] },
  hand: { poseOnly: true, at: [53, 56], rows: [
    'TZZ',
    'ZbZ',
    'TZT',
  ] },
};
Object.assign(JOINTS, { armShoulder: [54.5, 41], armElbow: [54.5, 49], armWrist: [54.5, 56.5] });

// The far limbs in action poses are the near ones shaded down, drawn behind the body.
const DARKER = { R: 'K', K: 'D', E: 'C', N: 'E', G: 'E', Z: 'T', b: 'Z' };
const shade = (part) => ({ ...part, poseOnly: true, rows: part.rows.map((row) => row.replace(/[RKENGZb]/g, (ch) => DARKER[ch])) });
const { thigh, shin, foot, ...rest } = PARTS;
const ORDERED = {
  farThigh: shade(thigh), farShin: shade(shin), farFoot: shade(foot),
  farUpper: shade(ARM.upper), farFore: shade(ARM.fore), farHand: shade(ARM.hand),
};
for (const [name, part] of Object.entries(rest)) {
  if (name === 'satchel') continue;
  if (name === 'coatBack') Object.assign(ORDERED, { thigh, shin, foot });
  ORDERED[name] = part;
  if (name === 'coatFront') ORDERED.satchel = PARTS.satchel;
  if (name === 'nearArm') Object.assign(ORDERED, { nearUpper: ARM.upper, nearFore: ARM.fore, nearHand: ARM.hand });
}

module.exports = { SIZE, PALETTE, PARTS: ORDERED, JOINTS };
