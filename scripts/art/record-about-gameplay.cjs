// Record the real match client against isolated, bot-only GameRooms. No SQL,
// accounts, or running dev server. Build first, then:
//   node scripts/art/record-about-gameplay.cjs [setup ...]      record, then cut
//   node scripts/art/record-about-gameplay.cjs --cut [setup ...] re-cut saved takes
// Each take runs long; the cut keeps the window with the most hits, supers and
// knockouts (from the server's own event log), so the clip is never a walk-on.
// Requires ffmpeg. Raw recordings and event logs stay in output/about-gameplay;
// finished MP4s and JPEG posters go to public/assets/site/gameplay.
// Record a 1080p60 output from the game's 2x super-high render. The source
// framebuffer must exceed the delivery size so this downsamples real detail.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { Server } = require('socket.io');
const { chromium } = require('playwright-core');
const { GameRoom } = require('../../src/server/core/gameRoom');
const state = require('../../src/server/core/gameRoom/roomStateManager');
const { mapDefaults } = require('../../src/shared/maps');
const { mapSummary } = require('../../src/shared/maps/mapDocument');
const { mapArena } = require('../../src/shared/maps/arenas');
const { difficultyForTrophies } = require('../../src/server/core/bots/config');
const { getHealth, getDamage, getSpecialDamage } = require('../../src/shared/characters/characterStats');
const { snapshotEpoch } = require('../../src/shared/combat/runtime/clock');

const root = path.resolve(__dirname, '../..');
const output = path.join(root, 'output/about-gameplay');
const installed = path.join(root, 'public/assets/site/gameplay');
// Characters alternate teams: even indexes are team 1, odd are team 2.
const setups = {
  'face-off': { map: 1, seed: 17, characters: ['ninja', 'draven'], seconds: 45 },
  'sky-brawl': { map: 2, seed: 41, characters: ['sparrow', 'gloop', 'ozzy', 'ninja'], seconds: 45 },
  'last-stand': { map: 3, seed: 73, characters: ['thorg', 'gloop', 'ozzy', 'draven'], seconds: 40 },
  'vault-raid': { map: 4, seed: 29, characters: ['ninja', 'draven', 'thorg', 'sparrow', 'ozzy', 'gloop'], seconds: 50 },
};
const CLIP_SECONDS = 8;
// What reads as action on screen: damage, supers and especially knockouts.
const EVENT_WEIGHT = { 'health-update': 2, 'super-update': 2, 'game:action': 1, 'player:dead': 9, 'player:respawn': 1 };

// Fast camera travel means panning over empty platforms between fights.
function cameraPenalty(camera, startedAt, from, to) {
  let penalty = 0;
  for (let i = 1; i < camera.length; i++) {
    const t = (camera[i].at - startedAt) / 1000;
    if (t < from || t >= to) continue;
    const dt = (camera[i].at - camera[i - 1].at) / 1000;
    if (dt <= 0) continue;
    const speed = Math.hypot(camera[i].x - camera[i - 1].x, camera[i].y - camera[i - 1].y) / dt;
    penalty += Math.max(0, speed - 150) * dt / 6;
  }
  return penalty;
}

function bestWindow(events, startedAt, duration, camera = []) {
  const times = events.map(e => ({ t: (e.at - startedAt) / 1000, w: EVENT_WEIGHT[e.type] || 0 })).filter(e => e.w && e.t >= 0);
  let best = { start: 0, score: -Infinity };
  for (let start = 0; start + CLIP_SECONDS <= duration; start += 0.25) {
    // A short lead-in lets the viewer find the fighters before the first hit.
    const action = times.filter(e => e.t >= start + 0.6 && e.t < start + CLIP_SECONDS - 0.3).reduce((sum, e) => sum + e.w, 0);
    const score = action - cameraPenalty(camera, startedAt, start, start + CLIP_SECONDS);
    if (score > best.score) best = { start, score: Math.round(score), action };
  }
  return best;
}

function cut(key) {
  const { execFileSync } = require('node:child_process');
  const raw = path.join(output, `${key}-60-raw.webm`);
  const log = JSON.parse(fs.readFileSync(path.join(output, `${key}-60-events.json`), 'utf8'));
  const duration = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', raw]).toString()) || log.setup.seconds;
  const window = bestWindow(log.events, log.recordingStartedAt, duration, log.camera);
  const start = window.start.toFixed(2);
  fs.mkdirSync(installed, { recursive: true });
  // Web delivery: 1080p60 H.264 with a bitrate cap, faststart for quick playback.
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', start, '-i', raw, '-t', String(CLIP_SECONDS), '-an',
    '-vf', 'fps=60,format=yuv420p', '-c:v', 'libx264', '-preset', 'slow', '-crf', '22', '-maxrate', '9M', '-bufsize', '18M',
    '-profile:v', 'high', '-movflags', '+faststart', path.join(installed, `${key}.mp4`)]);
  // Poster from the busiest second of the clip so the paused frame shows a fight.
  const weights = log.events.map(e => ({ t: (e.at - log.recordingStartedAt) / 1000 - window.start, w: EVENT_WEIGHT[e.type] || 0 })).filter(e => e.w && e.t > 0.5 && e.t < CLIP_SECONDS - 0.5);
  let posterAt = CLIP_SECONDS / 2, posterScore = -1;
  for (let t = 0.5; t < CLIP_SECONDS - 0.5; t += 0.25) {
    const score = weights.filter(e => Math.abs(e.t - t) < 0.6).reduce((sum, e) => sum + e.w, 0);
    if (score > posterScore) { posterScore = score; posterAt = t; }
  }
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', (window.start + posterAt).toFixed(2), '-i', raw, '-frames:v', '1', '-q:v', '3', path.join(installed, `${key}.jpg`)]);
  console.log(`Cut ${key}: ${start}s +${CLIP_SECONDS}s (action ${window.action}, score ${window.score}), poster at +${posterAt.toFixed(2)}s`);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const args = process.argv.slice(2);
  const keys = args.filter(arg => !arg.startsWith('--'));
  const selected = keys.length ? keys : Object.keys(setups);
  for (const key of selected) if (!setups[key]) throw new Error(`Unknown setup: ${key}`);
  if (args.includes('--cut')) { selected.forEach(cut); return; }
  const app = express(), server = http.createServer(app), io = new Server(server);
  let room, gameData, started = false, events = [];
  app.use(express.json());
  app.post('/gamedata', (_req, res) => res.json({ success: true, gameData }));
  app.get('/api/site/runtime', (_req, res) => res.json({ serverTime: Date.now() }));
  app.get('/api/support/unread', (_req, res) => res.json({ count: 0 }));
  app.get('/status', (_req, res) => res.json({ loggedIn: false }));
  app.get('/game/:id', (_req, res) => {
    // Keep the actual game's DOM and CSS; replace only navigation/loading boot
    // so recording needs no lobby, authentication, or production server.
    let html = fs.readFileSync(path.join(root, 'public/game.html'), 'utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
    html = html.replace('</body>', `<script>
      window.updateLoading = p => { if(p>=100) {
        document.querySelector('#loading-wrap')?.remove();
        document.querySelector('#matchmaking-screen')?.remove();
        document.querySelector('#game-bg')?.classList.add('visible');
        document.dispatchEvent(new Event('game:ready'));
      }};
      window.markMatchBackgroundReady = () => {};
      localStorage.setItem('bb-battle-tutorial-v1', '1');
      localStorage.setItem('bb_settings_v1', JSON.stringify({graphics:'super-high', music:0, sfx:0}));
    </script><script src="/bundles/phaser-arcade-physics.min.js"></script>
    <script>const OriginalGame = Phaser.Game; Phaser.Game = class extends OriginalGame { constructor(config) { super({...config, fps:{...config.fps, target:60}}); window.__filmGame = this; } };</script>
    <script src="/bundles/game.bundle.js"></script>
    <script>window.__BOOT_GAME__();</script></body>`);
    res.type('html').send(html);
  });
  app.use('/assets', express.static(path.join(root, 'public/assets')));
  app.use(express.static(path.join(root, 'dist')));
  io.on('connection', socket => {
    socket.on('game:join', (_data, ack) => {
      socket.join(`game:${room.matchId}`);
      const observer = { ...gameData.players.at(-1), socketId: socket.id,
        x: 200, y: 100, health: 0, maxHealth: 1000, isAlive: false, loaded: true, connected: true };
      room.players.set(socket.id, observer);
      state.sendGameStateToPlayer(room, socket);
      ack?.({ ok: true, matchId: room.matchId });
    });
    socket.on('game:clock', (_data, ack) => ack?.({ snapshotEpoch: snapshotEpoch(room), serverMono: performance.now(), serverTime: Date.now() }));
    socket.on('capture:start', (_data, ack) => {
      if (!started) { started = true; room.startGameLoop(); }
      ack?.({ ok: true });
    });
    socket.on('disconnect', () => room?.players.delete(socket.id));
  });
  const emit = io.to.bind(io);
  io.to = channel => {
    const target = emit(channel), original = target.emit.bind(target);
    target.emit = (type, data) => {
      if (!['game:snapshot', 'game:state', 'game:timer'].includes(type)) events.push({ at: Date.now(), type, data });
      return original(type, data);
    };
    return target;
  };
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true,
    args: ['--use-angle=metal', '--autoplay-policy=no-user-gesture-required', '--window-size=1920,1080',
      '--force-device-scale-factor=1', '--disable-frame-rate-limit', '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'],
    ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}),
  });
  try {
    for (const key of selected) {
      const setup = setups[key];
      const map = structuredClone(mapDefaults.find(m => m.id === setup.map));
      const arena = mapArena(map);
      const players = setup.characters.map((char_class, i) => ({
        participantId: `bot:film:${i}`, name: char_class[0].toUpperCase() + char_class.slice(1),
        char_class, team: i % 2 ? 'team2' : 'team1', isBot: true, level: 1,
        trophies: 4000, seed: setup.seed + i, difficulty: difficultyForTrophies(4000),
      }));
      const mapSnapshot = { mapId: setup.map, revision: 'capture-default', metadata: mapSummary(map), map };
      room = new GameRoom(8001, { mode: players.length / 2, modeId: arena.modeId,
        modeVariantId: arena.modeId === 'duels' ? `duels-${players.length / 2}v${players.length / 2}` : 'bank-bust-3v3',
        map: setup.map, players, editorMapSnapshot: mapSnapshot,
      }, { io, db: { runQuery: async () => [] } });
      room.status = 'active'; room._netTestEnabled = true;
      // Leave the action running long enough to choose an edit after a knockout.
      // Health, movement, attacks, ammo and super charge use normal match rules.
      room._checkVictoryCondition = () => {};
      room._requiredUserIds.clear();
      gameData = { ...room.matchData, matchId: room.matchId, mapSnapshot,
        yourName: 'Camera', yourTeam: 'spectator', yourCharacter: 'ninja', isGuest: true,
        players: [...players, { participantId: 'camera', name: 'Camera', team: 'spectator', char_class: 'ninja', level: 1 }]
          .map(p => ({ ...p, stats: { health: getHealth(p.char_class, 1), damage: getDamage(p.char_class, 1), specialDamage: getSpecialDamage(p.char_class, 1) } })),
      };
      events = []; started = false;
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
      const rawPath = path.join(output, `${key}-60-raw.webm`);
      const partialPath = `${rawPath}.partial`;
      fs.writeFileSync(partialPath, '');
      await page.exposeFunction('__saveFilmChunk', data => fs.appendFileSync(partialPath, Buffer.from(data, 'base64')));
      page.on('pageerror', e => console.error('BROWSER:', e.message));
      await page.goto(`http://127.0.0.1:${server.address().port}/game/8001?netTrace=film`);
      await page.waitForFunction(() => window.__filmGame?.scene.keys.GameScene?._remoteSpritesBuilt, null, { timeout: 60000 });
      await page.screenshot({ path: path.join(output, `${key}-ready.png`) });
      // Capture just the game's canvas, with a gently tracking spectator camera.
      // Browser-only framing never changes the server simulation.
      const capture = await page.evaluate(teams => {
        const game = window.__filmGame, scene = game.scene.keys.GameScene;
        window.__filmScene = scene;
        let filmX, filmY, filmZoom = 2.4, focus = null, sampledAt = 0;
        window.__filmCamera = [];
        scene.events.on('postupdate', () => {
          const cam = scene.cameras.main;
          const sprites = scene.children.list.filter(s => s.username && s.username !== 'Camera' && s.active && s.visible && s.body);
          if (!sprites.length) return;
          cam.stopFollow(); cam.setDeadzone(0, 0); cam.removeBounds();
          // Frame the closest opposing pair, where a fight is actually happening.
          // Stay on that fight until it breaks up or a much closer one starts, so
          // the camera never drifts across empty platforms between duels.
          const byName = new Map(sprites.map(s => [s.username, s]));
          const gap = pair => Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
          let closest = null, distance = Infinity;
          for (const a of sprites) for (const b of sprites) {
            if (teams[a.username] === teams[b.username]) continue;
            const d = gap([a, b]);
            if (d < distance) { distance = d; closest = [a, b]; }
          }
          let pair = focus && focus.map(name => byName.get(name));
          if (pair?.length !== 2 || pair.some(s => !s) || gap(pair) > 1150 || (closest && distance < gap(pair) * 0.45)) pair = closest || sprites;
          focus = pair.map(s => s.username);
          const xs = pair.map(s => s.x), ys = pair.map(s => s.y);
          const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
          const cy = (Math.min(...ys) + Math.max(...ys)) / 2 - 75;
          const zoom = Math.max(2.1, Math.min(2.9, game.scale.width / (Math.max(...xs) - Math.min(...xs) + 700)));
          filmZoom = Phaser.Math.Linear(filmZoom, zoom, .035);
          filmX = Phaser.Math.Linear(filmX ?? cx, cx, .045);
          filmY = Phaser.Math.Linear(filmY ?? cy, cy, .045);
          cam.setZoom(filmZoom); cam.centerOn(filmX, filmY);
          if (Date.now() - sampledAt >= 100) { sampledAt = Date.now(); window.__filmCamera.push({ at: sampledAt, x: Math.round(filmX), y: Math.round(filmY) }); }
        });
        const captureWidth = 1920, captureHeight = 1080;
        if (game.canvas.width < captureWidth || game.canvas.height < captureHeight) {
          throw new Error(`Refusing to upscale ${game.canvas.width}x${game.canvas.height} game render to ${captureWidth}x${captureHeight}`);
        }
        const canvas = document.createElement('canvas'); canvas.width = captureWidth; canvas.height = captureHeight;
        const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        let renderedFrames = 0, captureStartedAt = performance.now();
        const draw = () => { ctx.drawImage(game.canvas, 0, 0, canvas.width, canvas.height); renderedFrames++; };
        game.events.on('postrender', draw);
        const stream = canvas.captureStream(60);
        const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm;codecs=vp8';
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 32000000 });
        window.__finishFilm = () => new Promise(resolve => {
          recorder.onstop = () => resolve();
          recorder.stop(); stream.getTracks().forEach(t => t.stop()); game.events.off('postrender', draw);
        });
        let saving = Promise.resolve();
        recorder.ondataavailable = event => {
          saving = saving.then(async () => {
            const data = new Uint8Array(await event.data.arrayBuffer());
            let s = ''; for (let i=0;i<data.length;i+=32768) s += String.fromCharCode(...data.subarray(i,i+32768));
            await window.__saveFilmChunk(btoa(s));
          });
        };
        recorder.start(500);
        window.__flushFilm = () => saving;
        window.__filmCaptureInfo = () => {
          const elapsedMs = performance.now() - captureStartedAt;
          return { renderedFrames, elapsedMs, actualRenderFps: renderedFrames * 1000 / elapsedMs,
            width: game.canvas.width, height: game.canvas.height, captureWidth, captureHeight,
            captureFps: 60, gameTargetFps: game.loop.targetFps, mimeType };
        };
        return window.__filmCaptureInfo();
      }, Object.fromEntries(players.map(p => [p.name,p.team])));
      console.log(`Capture ${key}: ${JSON.stringify(capture)}`);
      const recordingStartedAt = Date.now();
      room.startGameLoop(); started = true;
      console.log(`Recording ${key}: ${setup.seconds}s on ${map.label}`);
      for (let second = 0; second < setup.seconds; second++) {
        await page.waitForTimeout(1000);
        if (second === 4) await page.screenshot({ path: path.join(output, `${key}-action.png`) });
      }
      await page.evaluate(() => window.__finishFilm());
      await page.evaluate(() => window.__flushFilm());
      const captureInfo = await page.evaluate(() => window.__filmCaptureInfo());
      const camera = await page.evaluate(() => window.__filmCamera);
      if (captureInfo.gameTargetFps < 60 || captureInfo.actualRenderFps < 59) {
        throw new Error(`Capture did not sustain 60 fps: ${JSON.stringify(captureInfo)}`);
      }
      fs.renameSync(partialPath, rawPath);
      fs.writeFileSync(path.join(output, `${key}-60-events.json`), JSON.stringify({ setup, capture: captureInfo, recordingStartedAt, camera, events }, null, 2));
      await page.screenshot({ path: path.join(output, `${key}-review.png`) });
      await page.close(); room.cleanup(); room = null;
      console.log(`Saved ${key} (${captureInfo.renderedFrames} rendered frames)`);
      cut(key);
    }
  } finally {
    room?.cleanup(); await browser.close(); io.close(); server.close();
  }
}
main().catch(error => { console.error(error); process.exit(1); });
