const { characterStats, LEVEL_CAP, getHealth, getDamage, getSpecialDamage, upgradePrice } = require('../../../shared/characters/characterStats');
const { characterDefinitions } = require('../../../shared/characters');
const { mapDefaults } = require('../../../shared/maps');
const { escapeHtml: escape, arrowHtml: arrow } = require('../../../shared/site/html.cjs');
const clips = require('../../../shared/site/aboutClips.json');
const gameModes = require('../../../shared/catalogs/gameModes.catalog.json').modes;
const { buildTrophyRewardTrack } = require('../trophies/trophySystem');
const { currencyRewardImage } = require('../../../shared/currencyRewardArt.cjs');
const titles = require('../../../shared/catalogs/titlesCatalog.json').titles;
const playerCards = require('../../../shared/catalogs/playerCardsCatalog.json').cards;
const skins = require('../../../shared/catalogs/skinsCatalog.json').characters;
const profileIcons = require('../../../shared/catalogs/profileIconsCatalog.json').icons;

// One line per fighter, drawn from what their attack actually does.
const FIGHTER_LINES = {
  ninja: 'Boomerang shurikens',
  thorg: 'Spinning heavy hitter',
  draven: 'Splash-damage caster',
  ozzy: 'Fireballs and team buffs',
  sparrow: 'Three-arrow volleys',
  gloop: 'Sticky, slowing slime',
};
// Idle playback rates the game client uses for each fighter.
const IDLE_FPS = { ninja: 12.5, thorg: 4, draven: 2, ozzy: 6, sparrow: 8, gloop: 4 };
const MODE_COPY = {
  duels: { tags: ['1v1', '2v2', 'One life'], line: 'No respawns. Knock out the other side before they get you.', guide: 'duels' },
  'bank-bust': { tags: ['3v3', 'Respawns'], line: 'Guard your vault and raid theirs. Empty it, or have more coins when time runs out.', guide: 'bank-bust' },
};
const name = key => key[0].toUpperCase() + key.slice(1);
const json = value => JSON.stringify(value).replace(/</g, '\\u003c');
const rank = rarity => ({ common: 0, rare: 1, epic: 2, legendary: 3 }[rarity] ?? 0);
const lobbyMaps = () => mapDefaults.filter(map => map.metadata?.lobbyBgAsset && map.metadata?.lobbyPlatformAsset);

// Real stats, prices, idle rate, rig feet and a lobby stage for each Bro.
function fighterData(key, index, maps) {
  const def = characterDefinitions[key];
  const stage = maps[index % maps.length]?.metadata;
  return {
    name: name(key),
    fps: IDLE_FPS[key] || 6,
    feet: def.rig?.feet ?? [def.frame.w / 2, def.frame.h],
    stage: stage ? { sky: stage.lobbyBgAsset, platform: stage.lobbyPlatformAsset } : null,
    levels: Array.from({ length: LEVEL_CAP }, (_, i) => ({
      level: i + 1,
      health: getHealth(key, i + 1),
      damage: getDamage(key, i + 1),
      special: getSpecialDamage(key, i + 1),
      price: upgradePrice(i + 1) ?? null,
    })),
  };
}

// The real Trophy Road, trimmed to fit: every milestone whose reward art
// sits well in a small frame (no player cards, no unplayable modes), with one
// coin or gem cache between each pair so the road reads like the game's.
function roadMilestones() {
  const playable = new Set(gameModes.filter(mode => mode.implemented && mode.queueable).map(mode => mode.id));
  const fits = reward => reward.kind !== 'card' && (reward.kind !== 'mode' || playable.has(reward.itemId));
  const track = buildTrophyRewardTrack();
  const majors = track.filter(tier => tier.rewards.length > 1 || tier.rewards[0].kind !== 'currency').filter(tier => fits(tier.rewards[0]));
  const steps = [];
  let previous = 0;
  for (const major of majors) {
    const between = track.filter(tier => tier.trophiesRequired > previous && tier.trophiesRequired < major.trophiesRequired && tier.rewards[0].kind === 'currency' && tier.rewards.length === 1);
    if (between.length) steps.push(between[Math.floor(between.length / 2)]);
    steps.push(major);
    previous = major.trophiesRequired;
  }
  return steps.map(tier => {
    const reward = tier.rewards[0];
    const currency = reward.kind === 'currency' && tier.rewards.length === 1;
    return {
      trophies: tier.trophiesRequired,
      title: currency ? `${Number(reward.amount).toLocaleString('en-US')} ${reward.name}` : tier.title,
      image: reward.kind === 'currency' ? currencyRewardImage(reward.currency, reward.amount) : reward.image,
      kind: reward.kind,
      major: !currency,
      // Bloom colour behind the reward, as on the lobby's Trophy Road.
      glow: reward.currency === 'gems' && currency ? '64,207,255' : !currency ? '255,203,87' : '121,158,255',
    };
  });
}

// Static cosmetics for the collection grid: player cards (with a Bro in the
// card window, as in battle intros), skins, titles and profile icons.
function cosmeticPools() {
  const bros = Object.keys(characterStats);
  const cards = playerCards.filter(card => card.animationViewport || card.battleViewport).map((card, index) => {
    const view = card.animationViewport || card.battleViewport;
    return { kind: 'card', name: card.name, rarity: card.rarity, image: card.assetUrl, bro: `/assets/${bros[index % bros.length]}/body.webp`,
      window: { x: view.x / view.width, y: view.y / view.height, w: view.w / view.width, h: view.h / view.height } };
  });
  const skinItems = Object.values(skins).flatMap(character => character.skins
    .filter(skin => skin.id !== character.defaultSkinId && skin.available !== false)
    .map(skin => ({ kind: 'skin', name: skin.name, rarity: skin.rarity, image: skin.assetUrl })));
  const titleItems = titles.map(title => ({ kind: 'title', name: title.name, rarity: title.rarity, color: title.color, gleam: title.gleamColor }));
  // Trophy milestone icons look alike, so the grid shows the collectible ones.
  const iconItems = profileIcons.filter(icon => icon.showInPicker !== false && !/trophies$/.test(icon.id)).map(icon => ({ kind: 'icon', name: icon.name, rarity: icon.rarity, image: icon.assetUrl }));
  const byRarity = list => [...list].sort((x, y) => rank(y.rarity) - rank(x.rarity));
  return { card: byRarity(cards), skin: byRarity(skinItems), title: byRarity(titleItems), icon: byRarity(iconItems) };
}
// The grid's layout: which kind each tile holds (cards are tall, titles wide).
// A gap-free 6 x 4 collection wall: [kind, column, row, columns spanned, rows spanned].
// Narrow screens drop the placement and let the grid pack the tiles.
const COSMETIC_LAYOUT = [
  ['card', 1, 1, 1, 2], ['icon', 2, 1], ['title', 3, 1, 2], ['skin', 5, 1], ['icon', 6, 1],
  ['card', 2, 2, 1, 2], ['icon', 3, 2], ['skin', 4, 2], ['title', 5, 2, 2],
  ['icon', 1, 3], ['icon', 3, 3], ['card', 4, 3, 1, 2], ['title', 5, 3, 2],
  ['icon', 1, 4], ['icon', 2, 4], ['icon', 3, 4], ['icon', 5, 4], ['icon', 6, 4],
];

function cosmeticTile(item) {
  const label = `<span class="about-tile-label"><span class="rarity-tag tag rarity-${escape(item.rarity)}">${escape(item.rarity)}</span><strong>${escape(item.name)}</strong></span>`;
  if (item.kind === 'card') {
    const w = item.window;
    return `<span class="about-tile-art about-card-art"><span class="about-card"><img class="about-card-frame" src="${escape(item.image)}" alt="" loading="lazy"/><img class="about-card-bro" src="${escape(item.bro)}" alt="" loading="lazy" style="left:${(w.x * 100).toFixed(2)}%;top:${(w.y * 100).toFixed(2)}%;width:${(w.w * 100).toFixed(2)}%;height:${(w.h * 100).toFixed(2)}%"/></span></span>${label}`;
  }
  if (item.kind === 'title') return `<span class="about-tile-art about-title-art"><span class="bb-player-title" style="--title-color:${escape(item.color)};--title-gleam:${escape(item.gleam)}">${escape(item.name)}</span></span>${label}`;
  return `<span class="about-tile-art"><img src="${escape(item.image)}" alt="" loading="lazy"/></span>${label}`;
}

function renderHero(first) {
  // [cloud art, top %, width px, opacity, seconds per crossing, start offset]
  const clouds = [[3, 6, 360, 0.34, 70, 0], [7, 22, 260, 0.24, 95, -40], [1, 46, 300, 0.2, 85, -20], [9, 66, 220, 0.26, 110, -70], [5, 14, 180, 0.18, 120, -95], [11, 80, 340, 0.16, 100, -55], [12, 34, 200, 0.22, 130, -110]];
  return `
  <section class="about-hero" aria-labelledby="about-title">
    <div class="about-hero-sky" aria-hidden="true">${clouds.map(([n, top, width, opacity, duration, delay]) => `<img class="about-cloud" src="/assets/clouds/cloud-${n}.png" alt="" style="top:${top}%;width:${width}px;opacity:${opacity};animation-duration:${duration}s;animation-delay:${delay}s"/>`).join('')}</div>
    <div class="about-hero-inner">
      <div class="about-hero-copy">
        <h1 id="about-title"><img class="about-hero-logo" src="/assets/logos/wordmark.webp" width="2065" height="408" alt="Bro Battles" fetchpriority="high"/></h1>
        <p class="about-hero-tagline">Free to play, right in your browser.</p>
        <p class="about-lede">Pick a Bro and jump into fast 1v1, 2v2 and 3v3 arena fights.</p>
        <a class="pixel-menu-button site-btn site-btn-play about-play" href="/">Play free ${arrow('right')}</a>
      </div>
      <div class="about-reel" id="reel" data-about-reel aria-label="Gameplay">
        <div class="site-frame about-reel-frame">
          <div class="about-reel-head"><span class="about-reel-live" aria-hidden="true"></span><span data-reel-format>${escape(first.format)}</span></div>
          <div class="about-reel-screen">
            <video muted playsinline preload="none" poster="/assets/site/gameplay/${escape(first.key)}.jpg" aria-label="Recorded Bro Battles gameplay"></video>
            <button class="about-reel-toggle" type="button" data-reel-toggle aria-label="Play gameplay"><span class="about-reel-icon" aria-hidden="true"></span></button>
            <div class="about-reel-progress" aria-hidden="true">${clips.map(() => '<span><i></i></span>').join('')}</div>
          </div>
        </div>
        <p class="about-reel-status" data-reel-status role="status" hidden></p>
        <noscript><p><a href="/assets/site/gameplay/${escape(first.key)}.mp4">Watch gameplay</a></p></noscript>
      </div>
    </div>
  </section>`;
}

// The lobby's character-details stat box (styles/characterSelect.css).
function statBox(kind, label, icon, value, description) {
  return `<div class="character-details-stat-box ${kind}-box" data-stat="${kind}">
      <div class="stat-box-header"><img class="stat-box-icon" src="${icon}" alt=""/><span class="stat-box-label">${label}</span><span class="stat-box-value-stack"><span class="stat-box-value" data-stat-value>${value}</span><span class="stat-box-gain" data-stat-gain aria-hidden="true"></span></span></div>
      <div class="stat-box-track" aria-hidden="true"><div class="stat-box-fill" data-stat-fill></div></div>
      ${description ? `<div class="stat-box-content"><div class="stat-box-desc">${escape(description)}</div></div>` : ''}
    </div>`;
}

function renderBros(fighters) {
  const maps = lobbyMaps();
  const data = Object.fromEntries(fighters.map(([key], index) => [key, fighterData(key, index, maps)]));
  const [firstKey] = fighters[0];
  const firstStage = data[firstKey].stage;
  return `
  <section class="about-section about-roster" id="fighters" aria-labelledby="fighters-title">
    <header class="about-heading"><h2 id="fighters-title">Meet the Bros.</h2><p>Every Bro fights differently. Spend coins to level them up.</p></header>
    <div class="site-frame about-bros" data-about-bros>
      <div class="about-bros-body">
        <div class="about-bro-stage" aria-hidden="true">
          <div class="about-bro-sky" data-bro-sky style="background-image:url('${escape(firstStage?.sky || '')}')"></div>
          <div class="about-bro-ground" data-bro-ground>
            <span class="about-bro-aura" data-bro-aura></span>
            <canvas class="about-bro-sprite" width="384" height="384" data-bro-sprite></canvas>
            <img class="about-bro-still" src="/assets/${escape(firstKey)}/body.webp" width="256" height="256" alt="" data-bro-still/>
            <img class="about-bro-platform" src="${escape(firstStage?.platform || '')}" alt="" data-bro-platform/>
          </div>
          <div class="about-bro-level"><span class="about-level-aura" aria-hidden="true"></span><div data-level-badge></div></div>
        </div>
        <div class="about-bro-panels">${fighters.map(([key, stats], index) => `
          <article class="about-bro${index ? '' : ' is-active'}" role="tabpanel" id="fighter-${escape(key)}" aria-labelledby="tab-${escape(key)}"${index ? ' aria-hidden="true" inert' : ''}>
            <header class="about-bro-head"><h3>${escape(name(key))}</h3>${FIGHTER_LINES[key] ? `<p class="about-bro-line">${escape(FIGHTER_LINES[key])}</p>` : ''}</header>
            <div class="character-details-stats-container about-bro-stats">
              ${statBox('health', 'Health', '/assets/icons/heart.webp', data[key].levels[0].health)}
              <div class="character-details-stat-boxes-row">
                ${statBox('attack', 'Attack', '/assets/icons/attack.webp', data[key].levels[0].damage, stats.attackDescription)}
                ${statBox('special', 'Super', '/assets/icons/special.webp', data[key].levels[0].special, stats.specialDescription)}
              </div>
            </div>
            <button type="button" class="pixel-menu-button site-btn about-upgrade-btn" data-upgrade-button><span data-upgrade-label>Level up</span><span class="about-upgrade-price" data-upgrade-cost><img src="/assets/icons/coin.webp" width="18" height="18" alt="coins"/><span data-upgrade-price>${data[key].levels[0].price}</span></span></button>
          </article>`).join('')}
          <p class="bb-visually-hidden" role="status" data-upgrade-status></p>
        </div>
      </div>
      <div class="about-bros-tabs" role="tablist" aria-label="Fighters">${fighters.map(([key], index) => `
        <button type="button" role="tab" class="character-card about-bro-tab${index ? '' : ' selected'}" id="tab-${escape(key)}" data-fighter="${escape(key)}" aria-controls="fighter-${escape(key)}" aria-selected="${index === 0}" tabindex="${index === 0 ? 0 : -1}"><span class="character-card-image-wrap"><img class="character-profile-icon" src="/assets/${escape(key)}/portrait.webp" width="96" height="96" alt="" data-portrait="${escape(key)}"/></span><span class="character-card-name">${escape(name(key))}</span></button>`).join('')}
      </div>
    </div>
    <script type="application/json" id="about-fighter-data">${json(data)}</script>
  </section>`;
}

function renderRoad() {
  return `
  <section class="about-section about-road" id="trophy-road" aria-labelledby="road-title">
    <div class="about-road-scroller" data-trophy-road>
      <div class="about-road-sticky">
      <header class="about-heading"><h2 id="road-title">Climb the Trophy Road.</h2><p>Every win earns trophies. Each milestone unlocks something new.</p></header>
      <div class="site-frame about-road-frame">
        <div class="about-road-viewport">
          <ol class="about-road-track" data-road-track>
            <li class="about-road-rail" aria-hidden="true"><span data-road-fill></span></li>
            ${roadMilestones().map(step => `
            <li class="about-road-step${step.major ? ' is-major' : ''}" data-road-step>
              <div class="trophy-lane-card about-road-card${step.major ? ' major' : ''}">
                <span class="about-road-art reward-${escape(step.kind)}" style="--reward-glow:${step.glow}"><img src="${escape(step.image)}" width="96" height="96" loading="lazy" alt=""/></span>
                <strong>${escape(step.title)}</strong>
                <span class="about-road-state" data-locked="Locked" data-claimed="Claimed"></span>
              </div>
              <span class="about-road-node" aria-hidden="true"></span>
              <b class="about-road-count"><img src="/assets/icons/trophy.webp" width="14" height="14" alt=""/>${step.trophies.toLocaleString('en-US')}</b>
            </li>`).join('')}
          </ol>
        </div>
      </div>
      </div>
    </div>
  </section>`;
}

function renderCosmetics() {
  const pools = cosmeticPools();
  const used = { card: 0, skin: 0, title: 0, icon: 0 };
  const tiles = COSMETIC_LAYOUT.map(([kind, column, row, columns = 1, rows = 1]) => {
    const pool = pools[kind];
    if (!pool.length) return '';
    const item = pool[used[kind]++ % pool.length];
    return `<li class="profile-icon-choice-tile about-cosmetic-tile is-${kind} rarity-${escape(item.rarity)}" style="--area:${row} / ${column} / span ${rows} / span ${columns}" data-kind="${kind}" data-name="${escape(item.name)}">${cosmeticTile(item)}</li>`;
  }).join('');
  return `
  <section class="about-section about-cosmetics" id="cosmetics" aria-labelledby="cosmetics-title">
    <header class="about-heading"><h2 id="cosmetics-title">Make it yours.</h2><p>Skins, player cards, titles and profile icons. Earn them on the Trophy Road or grab them in the shop.</p></header>
    <ul class="about-cosmetic-grid" data-cosmetics>${tiles}</ul>
    <script type="application/json" id="about-cosmetic-data">${json(pools)}</script>
  </section>`;
}

function renderFriends() {
  // Seats are built like the lobby's: name over a pixel frame standing on the
  // platform's walkable surface, status pill hanging below the frame.
  const seat = (side, bro, name, status) => `<div class="about-lobby-seat is-${side}">
          <div class="about-lobby-slot character-slot" data-lobby-slot="${side}" data-state="${side === 'you' ? 'online' : 'empty'}">
            <span class="about-lobby-name">${name}</span>
            <img class="about-lobby-bro character-sprite" src="/assets/${bro}/body.webp" alt=""/>
            <span class="about-lobby-status" data-lobby-status>${status}</span>
          </div>
          <span class="about-lobby-platform"></span>
        </div>`;
  return `
  <section class="about-section about-friends" id="friends" aria-labelledby="friends-title">
    <header class="about-heading"><h2 id="friends-title">Play with friends.</h2><p>Message a friend, pull them into your party and queue up together.</p></header>
    <div class="about-friends-scene" aria-hidden="true" data-friends-scene>
      <div class="bb-chat-shell about-scene-chat">
        <div class="bb-chat-header"><span class="bb-friends-avatar-wrap is-offline" data-scene-presence><img class="bb-friends-avatar" src="/assets/profile-icons/sparrow.webp" alt=""/></span><div class="bb-chat-heading"><h3 class="bb-chat-title">ArrowRain</h3><div class="bb-chat-header-status"><div class="bb-chat-subtitle" data-scene-chat-status>Offline</div></div></div></div>
        <div class="bb-chat-messages" data-scene-log></div>
        <div class="bb-chat-composer"><div class="bb-chat-input-row"><span class="bb-chat-textarea about-scene-input" data-scene-input></span><span class="bb-chat-send">Send</span></div></div>
      </div>
      <div class="site-frame about-lobby" data-scene-lobby>
        <div class="about-lobby-sky"></div>
        <div class="about-lobby-floor">
          ${seat('you', 'thorg', 'You', 'Online')}
          <div class="about-lobby-versus"><img class="about-lobby-vs" src="/assets/vs.webp" alt=""/></div>
          ${seat('friend', 'sparrow', 'ArrowRain', 'Invite')}
        </div>
        <div class="about-lobby-bar"><span class="about-lobby-chip">Bank Bust · 3v3</span><span class="about-lobby-ready" data-scene-ready>Ready</span><span class="about-lobby-chip">Iron Junction</span></div>
        <div class="about-match" data-scene-match>
          <div class="site-frame about-match-card">
            <div class="site-frame-head"><h2>Match found!</h2></div>
            <div class="about-match-teams"><img src="/assets/profile-icons/thorg.webp" alt=""/><img src="/assets/profile-icons/sparrow.webp" alt=""/><img class="about-match-vs" src="/assets/vs.webp" alt=""/><img src="/assets/profile-icons/draven.webp" alt=""/><img src="/assets/profile-icons/gloop.webp" alt=""/></div>
          </div>
        </div>
      </div>
    </div>
  </section>`;
}

function renderAboutPage(modes) {
  const fighters = Object.entries(characterStats);
  const arenas = mapDefaults.filter(map => map.metadata?.mapFullPreviewAsset);
  return `${renderHero(clips[0])}

  <section class="about-section about-basics" id="how-to-play" aria-labelledby="basics-title">
    <header class="about-heading"><h2 id="basics-title">Easy to pick up. Hard to put down.</h2></header>
    <div class="about-basics-grid">
      <article class="site-tile"><span class="about-step">01</span><h3>Move</h3><p>Jump, wall-slide and dash out of trouble.</p><div class="about-keys"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><kbd class="is-wide">Space</kbd></div></article>
      <article class="site-tile"><span class="about-step">02</span><h3>Aim</h3><p>Your mouse aims every shot. Make them count.</p><div class="about-keys"><img class="about-mouse" src="/assets/icons/mouse_left.webp" width="60" height="91" alt="Left click"/><span>Attack</span></div></article>
      <article class="site-tile"><span class="about-step">03</span><h3>Unleash</h3><p>Hits charge your super. Save it for the big moment.</p><div class="about-keys"><img class="about-mouse" src="/assets/icons/mouse_right.webp" width="60" height="91" alt="Right click"/><span>Super</span></div></article>
    </div>
    <a class="site-link" href="/help/controls">All controls ${arrow('right', 'sm')}</a>
  </section>
${renderBros(fighters)}
  <section class="about-section about-game-modes" id="modes" aria-labelledby="modes-title">
    <header class="about-heading"><h2 id="modes-title">Ways to win.</h2></header>
    <div class="about-mode-grid">${modes.map(mode => {
      const copy = MODE_COPY[mode.id] || { tags: [], line: mode.description, guide: mode.id };
      const tags = [...copy.tags, ...(Number(mode.unlockTrophies) > 0 ? [`Unlocks at ${Number(mode.unlockTrophies)} trophies`] : [])];
      return `
      <article class="site-tile about-mode" id="mode-${escape(mode.id)}"><span class="site-tile-art about-mode-art"><img src="${escape(mode.artAsset)}" width="1280" height="960" alt="" loading="lazy"/></span><div class="about-mode-copy"><h3>${escape(mode.label)}</h3><ul class="about-tags">${tags.map(tag => `<li>${escape(tag)}</li>`).join('')}</ul><p>${escape(copy.line)}</p><a class="site-link" href="/help/modes-and-maps#${escape(copy.guide)}">How ${escape(mode.label)} works ${arrow('right', 'sm')}</a></div></article>`;
    }).join('')}
    </div>
  </section>

  <section class="about-section about-arenas" id="arenas" aria-labelledby="arenas-title">
    <header class="about-heading"><h2 id="arenas-title">Pick your arena.</h2></header>
    <ul class="about-arena-strip">${arenas.map(map => `
      <li class="site-tile"><span class="site-tile-art about-arena-art"><img src="${escape(map.metadata.mapFullPreviewAsset)}" width="640" height="312" loading="lazy" alt=""/></span><span class="site-tile-name">${escape(map.label)}</span></li>`).join('')}
    </ul>
  </section>
${renderRoad()}
${renderCosmetics()}
${renderFriends()}
  <section class="site-frame about-crew" id="your-crew" aria-labelledby="crew-title">
    <div class="about-crew-art" aria-hidden="true"><img src="/assets/thorg/body.webp" width="256" height="256" loading="lazy" alt=""/><img src="/assets/ozzy/body.webp" width="256" height="256" loading="lazy" alt=""/><img src="/assets/gloop/body.webp" width="256" height="256" loading="lazy" alt=""/></div>
    <div class="about-crew-copy"><h2 id="crew-title">Better with your crew.</h2><p>Start a party, invite your friends and ready up together.</p>
      <a class="pixel-menu-button site-btn site-btn-play" href="/">Play free ${arrow('right')}</a>
    </div>
  </section>
`;
}

function renderFooter(config) {
  return `<footer class="site-footer">
    <div class="site-footer-inner">
      <div class="site-footer-brand"><a href="/about" class="site-footer-logo"><img src="/assets/logos/wordmark.webp" width="240" height="47" loading="lazy" alt="Bro Battles"/></a><p>Pixel arena battles, right in your browser.</p><a class="pixel-menu-button site-btn site-btn-play" href="/">Play free ${arrow('right')}</a></div>
      <nav aria-label="The game"><h2>The game</h2><a href="/about">About</a><a href="/about#fighters">Fighters</a><a href="/about#modes">Modes</a><a href="/news">News</a></nav>
      <nav aria-label="Support"><h2>Support</h2><a href="/help">Help Center</a><a href="/help/contact">Contact us</a><a href="/help/requests">My requests</a><a href="/feedback">Feedback</a></nav>
      <nav aria-label="Legal"><h2>Legal</h2><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="mailto:${escape(config.supportEmail)}">Email us</a></nav>
    </div>
    <div class="site-footer-bottom"><span>© ${new Date().getUTCFullYear()} Bro Battles</span><a href="#main">Back to top ${arrow('up', 'sm')}</a></div>
  </footer>`;
}
module.exports = { renderAboutPage, renderFooter };
