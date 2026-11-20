// The grandstand crowd: small pixel spectators drawn on the empty benches so
// they can hop, clap, wave, ride a stadium wave, gasp at big hits and leap up
// when their side scores. Each figure is 16x28 art pixels on the arena's 2 world
// px grid, with a shaded face, hair or hat, and team clothes and scarves.
const FRAME_W = 16, FRAME_H = 28;
const PX = 2;
const SEATED = 0, CHEER = 1, WAVE = 2, CLAP = 3;
const GASP = 4, WINCE = 5, POINT = 6, APPLAUD = 7;
const CHIN = 8, FIST = 9;
const LOOK = FIST + 1;
const POSES = LOOK + 1;
const RAISED_HAND_Y = 10;
const FAN_STYLES = [
  { idle: CHIN, shot: CHIN, impact: CHIN, post: WINCE, goal: CLAP, loss: CHIN, bounce: 0 },
  { idle: CLAP, shot: POINT, impact: CLAP, post: GASP, goal: CLAP, loss: SEATED, bounce: 0 },
  { idle: WAVE, shot: POINT, impact: FIST, post: WINCE, goal: WAVE, loss: WINCE, bounce: 2 },
  { idle: FIST, shot: GASP, impact: CHEER, post: GASP, goal: CHEER, loss: WINCE, bounce: 4 },
  { idle: CHIN, shot: CHIN, impact: SEATED, post: CHIN, goal: FIST, loss: CHIN, bounce: 1 },
];

function besideGoal(x, y, goal, reach) {
  return Math.abs(x - goal.x) <= reach && y >= goal.top - 24 && y <= goal.bottom + 24;
}
const INK = '#26192a';
const SKIN = [['#f8d8b8', '#e2b48f'], ['#efc39a', '#d29f73'], ['#d79c6b', '#b47a4c'], ['#b0774a', '#8c5935'], ['#8a5634', '#6a3e24'], ['#5f3a24', '#472a19']];
const HAIR = [['#2a1d17', '#3f2c22'], ['#5a3420', '#784a2e'], ['#a5622b', '#c98243'], ['#e2b552', '#f3d27e'], ['#1c1c24', '#33333f'], ['#8a8a96', '#b4b4be'], ['#b5462e', '#d8653f']];
const TEAM_SHIRTS = {
  team1: [['#3d8fe0', '#2a68b3', '#7fbcf2'], ['#2c6cc0', '#1e4f91', '#5a95dd'], ['#5ab3f2', '#3b88c9', '#9fd6ff']],
  team2: [['#e2504c', '#b23339', '#f48a7c'], ['#c33b44', '#922731', '#e2686c'], ['#f27a5d', '#c95542', '#ffab92']],
  neutral: [['#f2c94c', '#c99a2b', '#ffe38a'], ['#7dbb5a', '#5a9140', '#a8d886'], ['#a77ad9', '#7e56ae', '#c8a4ef'], ['#f3ead2', '#cdbf9e', '#ffffff'], ['#f08a3c', '#c4632a', '#ffb072']],
};
const SCARF = { team1: ['#3d8fe0', '#e8f2ff'], team2: ['#e2504c', '#fff0e8'], neutral: ['#f08a3c', '#fff3d2'] };
const HAIRSTYLES = ['short', 'long', 'bun', 'cap', 'beanie', 'brim', 'curly', 'bald'];

function random(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const JERSEYS = ['plain', 'stripe', 'chest-band', 'crest', 'split', 'star', 'ball', 'sun'];

function makeLooks(rand) {
  const pick = list => list[Math.floor(rand() * list.length)];
  const looks = [];
  for (const team of ['team1', 'team2', 'neutral']) {
    for (let i = 0; i < 16; i++) {
      const outfit = i < 2 ? 'winter' : i < 4 ? 'summer' : i < 6 ? 'swimwear' : 'jersey';
      looks.push({
        team, outfit, skin: pick(SKIN), hair: pick(HAIR), style: pick(HAIRSTYLES), shirt: pick(TEAM_SHIRTS[team]),
        scarf: team !== 'neutral' ? rand() < 0.45 : rand() < 0.15, jersey: pick(JERSEYS), beard: rand() < 0.18,
        hatColor: pick(TEAM_SHIRTS[team === 'neutral' ? pick(['team1', 'team2', 'neutral']) : team])[0],
      });
    }
  }
  return looks;
}

// Draw one spectator into a FRAME_W x FRAME_H grid of colours.
function drawSpectator(look, pose) {
  const grid = Array.from({ length: FRAME_H }, () => new Array(FRAME_W).fill(null));
  const fill = (x, y, w, h, color) => {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (grid[j]?.[i] !== undefined) grid[j][i] = color;
  };
  const [skin, skinShade] = look.skin, [hair, hairLight] = look.hair, [shirt, shirtShade, shirtLight] = look.shirt;
  // Legs and lap, mostly hidden behind the bench rail.
  fill(4, 26, 8, 2, '#3a3346');
  // Torso, lit from the upper left.
  fill(3, 16, 10, 10, shirt);
  fill(3, 16, 1, 10, shirtLight);
  fill(11, 17, 2, 9, shirtShade);
  switch (look.jersey) {
    case 'stripe': fill(7, 17, 2, 9, shirtLight); break;
    case 'chest-band': fill(4, 19, 7, 2, shirtLight); break;
    case 'crest': fill(5, 18, 2, 2, shirtLight); break;
    case 'split': fill(8, 17, 3, 9, shirtShade); break;
    case 'star':
      fill(7, 18, 1, 5, shirtLight);
      fill(5, 20, 5, 1, shirtLight);
      fill(6, 19, 3, 3, shirtLight);
      break;
    case 'ball':
      fill(6, 19, 3, 3, '#f5ead7');
      fill(7, 20, 1, 1, INK);
      break;
    case 'sun':
      fill(6, 19, 3, 3, '#ffd56b');
      fill(7, 18, 1, 5, '#ffd56b');
      fill(5, 20, 5, 1, '#ffd56b');
      break;
  }
  if (look.outfit === 'winter') {
    fill(4, 20, 8, 1, shirtShade);
    fill(7, 17, 1, 9, shirtShade);
    fill(7, 18, 1, 1, shirtLight);
  } else if (look.outfit === 'summer' || look.outfit === 'swimwear') {
    fill(3, 16, 10, 3, skin);
    fill(5, 16, 1, 4, shirt);
    fill(10, 16, 1, 4, shirt);
    if (look.outfit === 'swimwear') {
      fill(3, 22, 10, 4, skin);
      fill(3, 19, 10, 3, shirt);
      fill(5, 19, 2, 1, shirtLight);
      fill(9, 19, 2, 1, shirtLight);
    }
  }
  // Neck and collar.
  fill(6, 15, 4, 1, skinShade);
  fill(6, 16, 4, 1, shirtShade);
  if (look.outfit === 'winter' || (look.outfit === 'jersey' && look.scarf)) {
    const [a, b] = SCARF[look.team];
    for (let x = 4; x < 12; x++) fill(x, 15, 1, 2, (x >> 1) % 2 ? a : b);
    fill(10, 17, 2, 4, a);
    fill(10, 19, 2, 1, b);
  }
  // Head and face.
  fill(4, 7, 8, 8, skin);
  fill(11, 8, 1, 6, skinShade);
  fill(5, 14, 6, 1, skinShade);
  if (look.beard) fill(4, 12, 8, 3, hair);
  fill(4, 11, 1, 1, '#f0a39b');
  const startled = pose === GASP;
  const smiling = [CHEER, WAVE, CLAP, APPLAUD].includes(pose);
  for (const x of [5, 9]) {
    fill(x, startled ? 8 : 9, 2, 1, hair);
    if (startled || pose === POINT || pose === LOOK) fill(x, 10, 2, 2, '#fff5e8');
    fill(x + ([POINT, LOOK].includes(pose) ? 1 : 0), 10, pose === WINCE ? 2 : 1, 1, INK);
  }
  if (smiling) {
    fill(5, 12, 5, 1, '#742735');
    fill(6, 13, 3, 1, '#742735');
    fill(6, 12, 3, 1, '#fff5e8');
  } else if (startled) {
    fill(7, 12, 2, 3, '#622332');
  } else {
    fill(6, 13, 3, 1, '#984947');
    if (pose === WINCE) fill(7, 12, 2, 1, '#984947');
  }
  // Hair and headwear.
  const style = look.outfit === 'winter' ? 'beanie' : look.style;
  if (style === 'cap') {
    fill(4, 5, 8, 3, look.hatColor);
    fill(4, 5, 8, 1, '#ffffff');
    fill(11, 7, 3, 1, look.hatColor);
  } else if (style === 'beanie') {
    fill(4, 4, 8, 4, look.hatColor);
    fill(4, 7, 8, 1, '#f3ead2');
    fill(7, 3, 2, 1, '#f3ead2');
  } else if (style === 'brim') {
    fill(5, 3, 6, 4, '#d9b36a');
    fill(2, 6, 12, 1, '#b98d48');
    fill(5, 5, 6, 1, look.hatColor);
  } else if (style === 'bald') {
    fill(4, 7, 1, 2, hair);
    fill(11, 7, 1, 2, hair);
    fill(6, 7, 2, 1, '#ffffff');
  } else {
    fill(4, 5, 8, 3, hair);
    fill(5, 5, 4, 1, hairLight);
    fill(3, 7, 1, 3, hair);
    fill(12, 7, 1, 3, hair);
    if (style === 'long') fill(3, 7, 1, 8, hair), fill(12, 7, 1, 8, hair);
    if (style === 'bun') fill(6, 3, 4, 2, hair), fill(7, 3, 2, 1, hairLight);
    if (style === 'curly') {
      for (const [x, y] of [[3, 5], [5, 4], [8, 4], [11, 5], [12, 6], [2, 7]]) fill(x, y, 2, 2, hair);
      fill(6, 4, 1, 1, hairLight);
    }
  }
  const sleeveless = look.outfit === 'summer' || look.outfit === 'swimwear';
  const leftSleeve = sleeveless ? skin : shirtLight;
  const rightSleeve = sleeveless ? skinShade : shirtShade;
  // Arms: down on the lap, raised, waving or clapping in front.
  const armDown = (x, color) => { fill(x, 17, 2, 7, color); fill(x, 24, 2, 1, skin); };
  const armUp = (x, color) => {
    const wrist = x === 1 ? 0 : 14;
    fill(x, 14, 2, 4, color);
    fill(wrist, 12, 2, 3, skinShade);
    fill(wrist, RAISED_HAND_Y, 2, 2, skin);
  };
  if (pose === CHEER) { armUp(1, leftSleeve); armUp(13, rightSleeve); }
  else if (pose === WAVE) { armUp(1, leftSleeve); armDown(13, rightSleeve); }
  else if (pose === CLAP) {
    fill(1, 17, 2, 5, leftSleeve); fill(13, 17, 2, 5, rightSleeve);
    fill(3, 21, 4, 2, leftSleeve); fill(9, 21, 4, 2, rightSleeve);
    fill(7, 20, 2, 3, skin);
  } else if (pose === GASP || pose === WINCE) {
    const handY = pose === GASP ? 13 : 8;
    for (const [x, color, handX] of [[1, leftSleeve, 3], [13, rightSleeve, 11]]) {
      fill(x, handY + 2, 2, 18 - handY, color);
      fill(handX, handY, 2, 3, skin);
    }
  } else if (pose === POINT) {
    armDown(1, leftSleeve);
    fill(12, 15, 3, 3, rightSleeve);
    fill(14, 13, 2, 3, skin);
  } else if (pose === CHIN) {
    armDown(1, leftSleeve);
    fill(11, 16, 3, 5, rightSleeve);
    fill(9, 14, 3, 3, skin);
  } else if (pose === FIST) {
    armDown(1, leftSleeve);
    fill(12, 16, 3, 4, rightSleeve);
    fill(13, 14, 2, 3, skinShade);
    fill(12, 12, 3, 3, skin);
  } else if (pose === APPLAUD) {
    fill(1, 17, 3, 4, leftSleeve); fill(12, 17, 3, 4, rightSleeve);
    fill(3, 17, 2, 3, skin); fill(11, 17, 2, 3, skin);
  } else { armDown(1, leftSleeve); armDown(13, rightSleeve); }
  // A dark outline keeps each figure readable.
  const out = grid.map(row => row.slice());
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      if (grid[y][x]) continue;
      if ([[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => grid[y + dy]?.[x + dx])) out[y][x] = INK;
    }
  }
  return out;
}

// Blitters cannot scale, so the sheet is baked at its on-screen pixel size.
function makeSheet(scene, Phaser, key, looks) {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const w = FRAME_W * PX, h = FRAME_H * PX;
  const texture = scene.textures.createCanvas(key, looks.length * w, POSES * h);
  const context = texture.getContext();
  looks.forEach((look, index) => {
    for (let pose = 0; pose < POSES; pose++) {
      const grid = drawSpectator(look, pose);
      for (let y = 0; y < FRAME_H; y++) {
        for (let x = 0; x < FRAME_W; x++) {
          if (!grid[y][x]) continue;
          context.fillStyle = grid[y][x];
          context.fillRect(index * w + x * PX, pose * h + y * PX, PX, PX);
        }
      }
      texture.add(`${index}:${pose}`, 0, index * w, pose * h, w, h);
    }
  });
  texture.setFilter(Phaser.Textures.FilterMode.NEAREST);
  texture.refresh();
}

/**
 * @param rows [{ y, left, right }] world lines the spectators sit on, back tier first.
 */
export function createCrowd(scene, Phaser, { rows, depth, skyY, left, right, reduced, goals }) {
  const rand = random(0x5eed);
  const looks = makeLooks(rand);
  const key = 'bro-ball-crowd';
  makeSheet(scene, Phaser, key, looks);
  const crowd = scene.add.blitter(0, 0, key).setDepth(depth);
  const props = scene.add.graphics().setDepth(depth + 0.1);
  const sky = scene.add.graphics().setDepth(depth - 0.2);
  // A single veil covers benches, fans and pennants together, even on low graphics.
  const first = rows[0], last = rows[rows.length - 1];
  const top = first.y - (FRAME_H * PX + 55);
  const hazeKey = 'bro-ball-stands-haze';
  const veil = scene.textures.createCanvas(hazeKey, 512, 192);
  const ctx = veil.getContext();
  const gradient = ctx.createLinearGradient(0, 0, 0, 192);
  gradient.addColorStop(0, 'rgba(255,224,171,0)');
  gradient.addColorStop(0.3, 'rgba(255,221,179,0.22)');
  gradient.addColorStop(0.7, 'rgba(201,184,204,0.15)');
  gradient.addColorStop(1, 'rgba(164,153,186,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 512, 192);
  // Feather the sun shafts across their width and fade them out at the pitch.
  ctx.save();
  ctx.transform(1, 0, 0.48, 1, 0, 0);
  for (const [x, width] of [[48, 75], [138, 26], [340, 48]]) {
    const shaft = ctx.createLinearGradient(x, 0, x + width, 0);
    shaft.addColorStop(0, 'rgba(255,226,159,0)');
    shaft.addColorStop(0.48, 'rgba(255,226,159,0.16)');
    shaft.addColorStop(1, 'rgba(255,226,159,0)');
    ctx.fillStyle = shaft;
    ctx.fillRect(x, 0, width, 192);
  }
  ctx.restore();
  ctx.globalCompositeOperation = 'destination-in';
  const fade = ctx.createLinearGradient(0, 0, 0, 192);
  fade.addColorStop(0, 'transparent');
  fade.addColorStop(0.16, 'white');
  fade.addColorStop(0.72, 'white');
  fade.addColorStop(1, 'transparent');
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 512, 192);
  veil.refresh();
  const haze = scene.add.image(first.left - 60, top - 55, hazeKey).setOrigin(0)
    .setDisplaySize(first.right - first.left + 120, last.y - top + 180).setDepth(depth + 0.2);
  const objects = [crowd, props, sky, haze];
  const pollen = scene.add.graphics().setDepth(depth + 0.22);
  objects.push(pollen);
  const motes = Array.from({ length: 23 }, () => ({
    x: rand(), y: rand(), phase: rand() * Math.PI * 2, speed: 3 + rand() * 5,
  }));
  const people = [];
  const midX = (left + right) / 2, width = right - left;
  // Each tier seats two ranks, the back ones higher and in shade.
  const ranks = rows.flatMap((row, index) => [
    { ...row, index, lift: 27, tint: 0xb3adc4, offset: 7 },
    { ...row, index, lift: 0, tint: 0xe6e0ef, offset: 0 },
  ]);
  for (const rank of ranks) {
    for (let x = rank.left + rank.offset + (rank.index % 2) * 10; x < rank.right - FRAME_W * PX; x += 35 + rand() * 10) {
      if (rand() < 0.06) continue;
      // Blue fans fill the left end, red the right, with a mixed middle.
      const side = (x - midX) / (width / 2);
      const roll = rand();
      const team = side < -0.28 ? (roll < 0.82 ? 'team1' : 'neutral') : side > 0.28 ? (roll < 0.82 ? 'team2' : 'neutral')
        : roll < 0.3 ? 'team1' : roll < 0.6 ? 'team2' : 'neutral';
      const pool = looks.map((look, index) => ({ look, index })).filter(entry => entry.look.team === team);
      const { index } = pool[Math.floor(rand() * pool.length)];
      const ax = Math.round(x / PX) * PX;
      const ay = Math.round((rank.y - rank.lift - (FRAME_H - 3) * PX) / PX) * PX + Math.round(rand()) * PX;
      const bob = crowd.create(ax, ay, `${index}:0`);
      bob.tint = rank.tint;
      people.push({
        bob, pose: SEATED, column: index, team, x: ax, y: ay, row: rank.index, rank,
        phase: rand() * Math.PI * 2, style: FAN_STYLES[Math.floor(rand() * FAN_STYLES.length)],
        tempo: 310 + rand() * 230, attention: 0.35 + rand() * 0.6,
        delay: rand() * 430, cheerDuration: 1000 + rand() * 1700,
        actUntil: 0, act: 0, nextAct: 3000 + rand() * 16000,
        flag: team !== 'neutral' && !rank.lift && rand() < 0.06,
      });
    }
  }

  let cheer = null;
  let stadiumWave = { start: 9000 + rand() * 6000, until: 0 };
  let birds = null, nextBirds = 6000 + rand() * 8000;
  const born = scene.time.now;
  const WAVE_MS = 6500;

  function celebrate(team) {
    cheer = { team, at: scene.time.now, until: scene.time.now + 3200 };
  }

  function react(event) {
    const post = event.kind === 'post';
    const big = ['smash', 'super'].includes(event.kind);
    if (!post && !big && !(['strike', 'kick', 'body'].includes(event.kind) && event.strength >= 550)) return;
    const nearMouth = [goals.team1, goals.team2].some(goal => besideGoal(event.x, event.y, goal, 260));
    if (!nearMouth) return;
    const reach = post ? 650 : big ? 490 : 280;
    for (const person of people) {
      const distance = Math.abs(person.x - event.x);
      if (distance >= reach || rand() > person.attention * (1 - 0.45 * distance / reach)) continue;
      const start = scene.time.now + distance * 0.25 + person.delay * 0.45;
      if (person.reaction?.until > start && person.reaction.post && !post) continue;
      person.reaction = {
        start, until: start + person.tempo * (post ? 2.5 : 1.6), post,
        pose: post ? person.style.post : person.style.impact,
      };
    }
  }

  function reactToDeath(x) {
    if (!Number.isFinite(x)) return;
    for (const person of people) {
      const distance = Math.abs(person.x + FRAME_W * PX / 2 - x);
      if (person.exit || distance > 275 || (distance > 100 && person.attention < 0.6)) continue;
      const start = scene.time.now + distance * 0.4 + person.delay * 0.3;
      person.reaction = {
        start, until: start + 550, pose: person.style.bounce && person.phase > 3 ? CHEER : GASP,
      };
    }
  }

  function threatenedGoal(ball) {
    if (!ball || ball.destroyed || Math.abs(ball.vx) < 220) return null;
    const goal = ball.vx < 0 ? goals.team1 : goals.team2;
    const seconds = (goal.x - ball.x) / ball.vx;
    if (seconds <= 0 || seconds > 0.52 || !besideGoal(ball.x, ball.y, goal, 320)) return null;
    const height = ball.y + ball.vy * seconds;
    return height >= goal.top && height <= goal.bottom ? goal : null;
  }

  function updateBirds(now, dt) {
    sky.clear();
    if (reduced) return;
    if (!birds && now - born > nextBirds) {
      const direction = rand() < 0.5 ? 1 : -1;
      birds = {
        direction, y: skyY + rand() * 60, x: direction > 0 ? left - 200 : right + 200,
        flock: Array.from({ length: 3 + Math.floor(rand() * 4) }, (_, i) => ({ dx: -i * 26 * direction + rand() * 10, dy: (i % 2) * 14 + rand() * 8, phase: rand() * 6 })),
      };
    }
    if (!birds) return;
    birds.x += birds.direction * 70 * dt;
    for (const bird of birds.flock) {
      const x = Math.round((birds.x + bird.dx) / 2) * 2;
      const y = Math.round((birds.y + bird.dy + Math.sin(now / 600 + bird.phase) * 6) / 2) * 2;
      const up = Math.sin(now / 90 + bird.phase) > 0;
      sky.fillStyle(0x34304c, 0.85).fillRect(x - 2, y, 4, 2);
      if (up) sky.fillRect(x - 8, y - 4, 6, 2).fillRect(x + 2, y - 4, 6, 2);
      else sky.fillRect(x - 8, y + 2, 6, 2).fillRect(x + 2, y + 2, 6, 2);
    }
    if ((birds.direction > 0 && birds.x > right + 300) || (birds.direction < 0 && birds.x < left - 300)) {
      birds = null;
      nextBirds = now - born + 14000 + rand() * 16000;
    }
  }

  const neighbors = people.slice(1).flatMap((receiver, index) => {
    const giver = people[index];
    return giver.rank === receiver.rank && receiver.x - giver.x < 47 && !giver.flag && !receiver.flag
      ? [[giver, receiver]] : [];
  });
  const scenes = ['popcorn', 'drink', 'slap'];
  let nextScene = born + 5000, sceneIndex = 0, interaction = null;
  const departures = { team1: 0, team2: 0 };

  function setPose(person, pose) {
    person.pose = pose;
    person.bob.setFrame(`${person.column}:${pose}`);
  }

  function updateInteractions(now, score) {
    if (score) {
      for (const team of ['team1', 'team2']) {
        const other = team === 'team1' ? 'team2' : 'team1';
        const deficit = score[other] - score[team];
        const target = deficit >= 3 ? 10 : deficit === 2 ? 6 : 0;
        const count = target - departures[team];
        if (!(count > 0)) continue;
        const fans = people.filter(person => person.team === team && !person.flag && !person.exit)
          .sort((a, b) => Math.min(a.x - a.rank.left, a.rank.right - a.x) -
            Math.min(b.x - b.rank.left, b.rank.right - b.x));
        const leaving = fans.slice(0, count);
        departures[team] += leaving.length;
        leaving.forEach((person, index) => {
          const edge = person.x < (person.rank.left + person.rank.right) / 2 ? person.rank.left - 32 : person.rank.right;
          person.exit = { edge, start: now + 350 + Math.floor(index / 2) * 300 + (index % 2) * 100 };
        });
      }
    }
    for (const person of people) {
      if (!person.exit || now < person.exit.start || person.departed) continue;
      const { edge, start } = person.exit;
      const duration = Math.max(500, Math.abs(edge - person.x) * 7);
      const progress = Math.min(1, (now - start) / duration);
      if (!reduced) {
        person.bob.x = Math.round(person.x + (edge - person.x) * progress);
        person.bob.y = person.y - 2 * Math.round(Math.abs(Math.sin((now - start) / 75)));
      }
      if (progress === 1) {
        person.departed = true;
        person.bob.setVisible(false);
      }
    }
    if (reduced) return;
    if (now >= nextScene && !cheer) {
      const available = neighbors.filter(pair => pair.every(person => !person.exit));
      const pair = available[Math.floor(rand() * available.length)];
      if (pair) interaction = { pair, type: scenes[sceneIndex++ % scenes.length], start: now };
      nextScene = now + 7500 + rand() * 3500;
    }
    if (!interaction) return;
    const { pair: [giver, receiver], type, start } = interaction;
    const age = now - start;
    if (age >= 2100 || cheer || giver.exit || receiver.exit ||
        giver.reaction?.until > now || receiver.reaction?.until > now) {
      interaction = null;
      return;
    }
    const transfer = Math.max(0, Math.min(1, (age - 650) / 450));
    setPose(giver, transfer < 1 ? POINT : SEATED);
    setPose(receiver, type === 'slap' ? (transfer > 0.65 ? WINCE : SEATED) : (transfer > 0.4 ? CLAP : SEATED));
    const x = Math.round(giver.x + 27 + (receiver.x - giver.x - 14) * transfer);
    const y = giver.y + 31;
    if (type === 'slap') {
      if (age > 930 && age < 1130) {
        props.fillStyle(0xffe0a0, 1).fillRect(receiver.x + 2, y - 13, 10, 2).fillRect(receiver.x + 6, y - 17, 2, 10);
      }
      return;
    }
    props.fillStyle(type === 'popcorn' ? 0xef5b51 : 0x58bce5, 1).fillRect(x, y, 9, 11);
    props.fillStyle(0xffefce, 1).fillRect(x, y, 9, 2);
    if (type === 'popcorn') props.fillRect(x + 2, y - 2, 5, 3).fillRect(x + 3, y + 3, 2, 7);
    else props.fillRect(x + 6, y - 4, 2, 5);
  }

  let activePlay = false;
  function update(now, dt, ball, score) {
    const since = now - born;
    // Separate thresholds keep a slowly rolling ball from toggling the stands every frame.
    const pace = ball && !ball.destroyed ? Math.hypot(ball.vx, ball.vy) : 0;
    const moving = ball?.y >= Math.min(goals.team1.top, goals.team2.top) - 24 && pace > (activePlay ? 160 : 320);
    if (moving && !activePlay) {
      for (const person of people) {
        person.nextAct = since + 800 + rand() * 15000;
      }
      stadiumWave = { start: since + 9000 + rand() * 6000, until: 0 };
    }
    activePlay = moving;
    if (!moving) stadiumWave.until = 0;
    if (moving && !reduced && since > stadiumWave.start && !stadiumWave.until) stadiumWave.until = since + WAVE_MS;
    if (stadiumWave.until && since > stadiumWave.until) stadiumWave = { start: since + 26000 + rand() * 20000, until: 0 };
    const waveFront = stadiumWave.until
      ? left - 200 + ((since - (stadiumWave.until - WAVE_MS)) / WAVE_MS) * (right - left + 400) : null;
    if (cheer && now > cheer.until) cheer = null;
    const threat = threatenedGoal(ball);
    props.clear();
    for (const person of people) {
      if (person.departed) continue;
      person.bob.x = person.x;
      if (now >= (person.nextLook ?? born + person.delay)) {
        const tracking = !reduced && pace > 100 && person.attention > 0.45 && rand() < 0.84;
        const offset = tracking ? ball.x - person.x : 0;
        person.look = Math.abs(offset) > 55 ? Math.sign(offset) : 0;
        person.nextLook = now + person.tempo * 2 + rand() * 300;
      }
      let pose = SEATED, lift = 0;
      if (moving && !reduced && since > person.nextAct) {
        person.act = person.style.idle;
        person.actUntil = since + person.tempo * 3;
        person.nextAct = since + 6000 + rand() * 18000;
      }
      if (moving && since < person.actUntil) pose = person.act;
      if (waveFront != null && person.style.bounce && Math.abs(person.x - waveFront + person.row * 24) < 40) {
        pose = WAVE;
      }
      if (threat && Math.abs(person.x - threat.x) < 580 * person.attention) {
        pose = person.style.shot;
      }
      const reaction = person.reaction;
      if (reaction && now >= reaction.until) person.reaction = null;
      else if (reaction && now >= reaction.start) {
        pose = reaction.pose;
      }
      const cheerAge = cheer ? now - cheer.at - person.delay : -1;
      if (cheerAge >= 0 && cheerAge < person.cheerDuration) {
        const supporter = person.team === cheer.team || (person.team === 'neutral' && person.phase > 3);
        pose = supporter ? person.style.goal : person.style.loss;
      }
      if (!reduced) {
        const cycle = since / person.tempo + person.phase;
        if (pose === CLAP && cycle % 1 < 0.5) pose = APPLAUD;
        if (pose === WAVE || pose === CHEER || pose === FIST) {
          lift = Math.round(person.style.bounce * Math.max(0, Math.sin(cycle * Math.PI * 2)));
        }
      }
      person.bob.y = person.y - (reduced ? 0 : lift * PX);
      if (pose === SEATED && person.look && !person.exit) pose = LOOK;
      person.bob.flipX = (pose === POINT && threat.x < person.x) || (pose === LOOK && person.look < 0);
      if (person.pose !== pose) {
        person.pose = pose;
        person.bob.setFrame(`${person.column}:${pose}`);
      }
      if (person.flag && !reduced) {
        // A pennant on a stick, flapping above the fan's hand.
        const main = person.team === 'team1' ? 0x3d8fe0 : 0xe2504c;
        const light = person.team === 'team1' ? 0x8fd0ff : 0xffa9a0;
        const raised = pose === CHEER || pose === WAVE;
        const handY = raised ? RAISED_HAND_Y : pose === WINCE ? 8 : pose === GASP ? 13
          : pose === CLAP ? 21 : pose === APPLAUD ? 18 : 24;
        const handX = pose === CLAP ? 7 : [WINCE, GASP, APPLAUD].includes(pose) ? 3 : raised ? 0 : 1;
        const hx = person.x + (person.bob.flipX ? FRAME_W - 1 - handX : handX) * PX;
        const hy = person.bob.y + handY * PX;
        const flap = (moving || cheer) && Math.sin(now / 140 + person.phase) > 0;
        props.fillStyle(0x4a2e1b, 1).fillRect(hx, hy - 36, 2, 36);
        props.fillStyle(main, 1).fillRect(hx + 2, hy - 36, 16, 8).fillRect(hx + 2, hy - 28, flap ? 10 : 14, 6);
        props.fillStyle(light, 1).fillRect(hx + 2, hy - 36, 16, 2);
      }
    }
    if (!reduced) {
      pollen.clear();
      const seconds = since / 1000;
      for (const m of motes) {
        const x = first.left + (m.x * width + seconds * m.speed) % width;
        const y = top + ((m.y * 650 - seconds * m.speed * 0.4) % 650 + 650) % 650;
        const shimmer = (1 + Math.sin(seconds * 0.8 + m.phase)) / 2;
        pollen.fillStyle(0xffedb7, 0.12 + 0.48 * shimmer)
          .fillCircle(x, y + 5 * Math.sin(seconds * 0.35 + m.phase), 1 + m.x);
      }
    }
    updateInteractions(now, score);
    updateBirds(now, dt);
  }

  return {
    celebrate, react, reactToDeath, update,
    destroy() {
      for (const object of objects) object.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
      scene.textures.remove(hazeKey);
    },
  };
}
