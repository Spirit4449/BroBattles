// Sparrow body as code: a 16-colour palette plus one pixel map per body part,
// drawn back to front on a 64x64 logical canvas. `at` is the part's top-left on
// that canvas in the rest pose (public/assets/sparrow/body.webp).
const SIZE = 64;

const PALETTE = {
  K: '#040715', // outline (deepest)
  k: '#0a0e21', // outline
  G: '#0d4421', // tunic shadow
  g: '#1a5a2f', // tunic
  m: '#2d783f', // tunic mid
  l: '#4e985a', // tunic light
  B: '#55261b', // wood / leather shadow
  b: '#783f22', // wood / leather
  o: '#a15630', // wood / leather light
  h: '#a3a29e', // hair deep shadow
  H: '#b1b0aa', // hair shadow
  i: '#cac9c5', // hair mid
  W: '#f9f8f3', // hair
  s: '#d2966b', // skin shadow
  S: '#fbc894', // skin
};

// Joint positions on the rest-pose canvas. Poses rotate parts around these.
const JOINTS = {
  hip: [32, 41], // torso pivot: the whole upper body leans around it
  neck: [38, 31],
  backShoulder: [30, 30],
  backElbow: [23, 34],
  backWrist: [16, 38],
  frontShoulder: [41, 32],
  grip: [53, 37], // bow hand on the bow
  hairRoot: [25, 19],
  quiverStrap: [28, 26],
  legTop: 39, // legs squash between this row and the feet
  feet: 63,
  frontHip: [37, 41], // front leg: the template both running legs are built from
  frontKnee: [43, 50],
  frontAnkle: [46, 60],
  toe: [51, 63], // bottom of the front boot's sole
  heel: [44, 63],
};

// Back to front.
const PARTS = {
  quiver: {
    at: [23, 20],
    rows: [
      '..k.kB...',
      '..kK.B...',
      '..kk.B...',
      'k.bkoK...',
      '.kbkGmk..',
      '.kllBBkgk',
      '.gkBBbklg',
      '..kbbbklg',
      '..kbbbKKK',
      '...lkk...',
    ],
  },
  hairBack: {
    at: [20, 18],
    rows: [
      '..kkK...',
      '..kWH...',
      '.kWWH.W.',
      '..kWW..H',
      '..khW..h',
      '....i...',
      '........',
      '........',
      '..kW....',
      '..kWH...',
      '.kWWH...',
      '.KWHHH..',
      'kWHHHH..',
      '.k......',
    ],
  },
  backLeg: {
    at: [6, 39],
    rows: [
      '...................kgll',
      '..................kBBBK',
      '.................koooBK',
      '.................KoooBB',
      '................koooobB',
      '...............koooobbB',
      '..............kbooobbbB',
      '..............kooobbbBB',
      '............kooobbbbBk.',
      '...........kobobbbBkk..',
      '.........kkoobbbBBkk...',
      '........kllgGbbBkk.....',
      '.......kllgggkBk.......',
      '.......kGGlgggk........',
      '......kmmGGGggk........',
      '......kmmGGGggk........',
      '.....kmmGGGkkk.........',
      '.....kmGGGk............',
      '....kmgGkk.............',
      '...kmGGk...............',
      '..kmmGGk...............',
      '..kmGGk................',
      '.kmlgGk................',
      'kmlllmGk...............',
      'kkkkkkkk...............',
    ],
  },
  backHand: {
    at: [10, 38],
    rows: [
      '..KssGggk',
      '.KSssSkk.',
      '.kSskSss.',
      'kSskkkSs.',
      'kSk...ks.',
      '.kk...kk.',
    ],
  },
  backFore: {
    at: [13, 31],
    rows: [
      '.........k.',
      '.......kkg.',
      '.....kKllg.',
      '.....mllgg.',
      '.....llmggG',
      '..kkggggGGk',
      'kkllgggkkk.',
      '......k....',
    ],
  },
  backUpper: {
    at: [23, 29],
    rows: [
      '......SSs',
      '...KSSSSs',
      'lKSSSSssK',
      'gSSSssoKm',
      'GSSkkkGgm',
      'GkK......',
    ],
  },
  torso: {
    at: [24, 32],
    rows: [
      '........mllmkk.',
      '........mlllmgk',
      '....kGggggllmmg',
      'k...kGggggllmmg',
      '.....kggggggkkk',
      '....kggmmmgk...',
      '..kkgggggmmk...',
      '.....llmgggl...',
      '.....mgmlllg...',
      '.....llggggk...',
      '.....Glggllk...',
      '.....Gllggll...',
      '.....klllggl...',
      '.....klllggl...',
    ],
  },
  skirt: {
    at: [24, 46],
    rows: [
      '.....kllllgl...',
      '....GGmgmlll...',
      '...GGGmgmllg...',
      '..GGGGmggglg...',
      '.kGGGGlggggl...',
      'kGGGGGlggggl...',
      'kGGGGGKllggllK.',
      'kkkGGGKlllgllK.',
      '...kkGGkGlggll.',
      '.....kk.kklgllk',
      '..........klllk',
      '...........kklk',
      '.............kk',
    ],
  },
  frontThigh: {
    at: [36, 39],
    rows: [
      'k.........',
      'kkk.......',
      'Bkkk......',
      'Booo......',
      'koook.....',
      'kbbook....',
      'kbbbook...',
      'kbbboook..',
      'kkkbbbookk',
      'k..kbbboob',
      'k...kbbbbB',
      'k.....bbB.',
      'k.........',
    ],
  },
  frontBoot: {
    at: [38, 50],
    rows: [
      '..gG...k......',
      '.kggkkml......',
      '.kGGllmg......',
      '..GGGGGG......',
      'k.GGGGGG......',
      '..kkGGGg......',
      '....kGGGk.....',
      '.....kGGk.....',
      '.....kGmk.....',
      '....kGGGmkk...',
      '....kGGGmmkk..',
      '.....kGGGmllk.',
      '.....kGkGgGGmk',
      '.........kkkkk',
    ],
  },
  head: {
    at: [25, 14],
    rows: [
      '..........kkkkkkk....',
      '.........kHWWWWWWk...',
      '.......kkHWWWWWHHHk..',
      'kkKK...KKHWWWWWHHhK..',
      'WkWHkkkHHHHWWWWHHWWkk',
      'WkWWkkiWWWHHHHHWWWWHl',
      '....WWHHHWWHHWWHHgKHH',
      '....WHHBBWHHHWWsbBski',
      '....WHHBbWHHHWWsbBsBh',
      '....WHHHBShWWWhosSSSk',
      '.....HHHkSBHHHkBkkKSk',
      '.......kkksWWWSsWWkok',
      '.......gghWWWHSSWkKbK',
      '.......ggkWHHWSSWkKbK',
      '.......kkhWHHWSSSSSbK',
      '.......bkkHHHWsSSSSk.',
      '.......lggkWWH.......',
      '.......KllkiHW.......',
      '.............WH......',
      '..............W......',
    ],
  },
  frontArm: {
    at: [39, 30],
    rows: [
      'kSSkk.......',
      'sBk.........',
      '.SSk........',
      '.SSSk.......',
      'KSSSSkkk....',
      'kSSSsmlk.k..',
      '.kssGgmk.lkk',
      '..kkGGGk.Glg',
      '....kGGk.Ggg',
      '.....kkk.GGG',
    ],
  },
  bow: {
    at: [46, 8],
    rows: [
      'kk..........',
      'ok..........',
      'ok..........',
      'okk.........',
      'oBBkk.......',
      'obbkk.......',
      'kkoob.......',
      'kbkook......',
      'kbkBbk......',
      'kbkBBbk.....',
      'kbkBBok.....',
      'kbkkBBoKk...',
      'Wkk..kBoBk..',
      'Hkk..kBooBk.',
      'HKk..kBboBk.',
      'WHk...kBooo.',
      'HWk....kBbo.',
      'Hkk....kBbo.',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk....kooo.',
      'kbk....kBkk.',
      'kbk...kBBkk.',
      '.bk...kBkk..',
      '.b....KBKkk.',
      '.b..........',
      '.b..........',
      '.b..........',
      '.b.....Bkk..',
      'kbkkk.kBBkk.',
      'kbk....kobB.',
      'kbk....kBbo.',
      'kbk....kBbok',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk.....kBBk',
      'kbk....kBbo.',
      'kbk....kobB.',
      'kbk...kBoBk.',
      'kbk..kBooBk.',
      'kbk..kBokk..',
      'kbk..Bookk..',
      'kbk.kook....',
      'kbkBBok.....',
      '.bkBBk......',
      '.kBook......',
      '.Booo.......',
      '.kbkk.......',
    ],
  },
  bowHand: {
    at: [51, 36],
    rows: [
      'kSsSkk',
      'SsSSkk',
      'SkSSkk',
      'kk....',
    ],
  },
};

// Running needs two legs whose feet point forward; only the front leg has one, so
// the far leg is the front leg shaded darker, drawn behind everything. Knee caps
// (plain legging fill) sit under each knee so a deep bend never opens a hole.
// These only draw when a pose lists them; the rest pose never shows them.
const DARKER = { l: 'g', m: 'G', g: 'G', o: 'B', b: 'B' }; // two shades down, so it parts from the skirt
const shade = (part) => ({ ...part, rows: part.rows.map((row) => row.replace(/[lmgob]/g, (ch) => DARKER[ch])) });
const knee = { at: [41, 48], rows: ['.bb.', 'bbbb', 'bBBb', '.BB.'] };
// A bow lying on the ground goes under her, so poses that drop it use this copy,
// drawn behind everything, instead of the held bow.
const ORDERED = {
  droppedBow: { ...PARTS.bow, poseOnly: true },
  farKnee: { ...shade(knee), poseOnly: true },
  farThigh: { ...shade(PARTS.frontThigh), poseOnly: true },
  farBoot: { ...shade(PARTS.frontBoot), poseOnly: true },
};
for (const [name, part] of Object.entries(PARTS)) {
  if (name === 'frontThigh') ORDERED.nearKnee = { ...knee, poseOnly: true };
  ORDERED[name] = part;
}

module.exports = { SIZE, PALETTE, PARTS: ORDERED, JOINTS };
