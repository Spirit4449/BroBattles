const { characterStats } = require('../../../shared/characters');
const { escapeHtml: escape } = require('../../../shared/site/html.cjs');


function renderAboutPage(modes) {
  return `
  <section class="about-intro" aria-labelledby="about-title">
    <div class="about-intro-copy">
      <h1 id="about-title">Pick your fighter.<br/><em>Own the arena.</em></h1>
      <p>A multiplayer 2D arena game. Dodge, aim, and unleash your super in quick battles with friends.</p>
      <div class="about-actions"><a class="pixel-menu-button site-play" href="/">Play in your browser <span aria-hidden="true">↗</span></a><a class="about-text-link" href="#how-to-play">How it works <span aria-hidden="true">↓</span></a></div>
      <ul class="about-facts" aria-label="Game features"><li>No download</li><li>Try as a guest</li></ul>
    </div>
    <div class="about-cinema" id="gameplay" aria-label="Bro Battles gameplay highlights" data-about-reel>
      <div class="about-video-frame">
        <video class="about-video" muted playsinline preload="none" poster="/assets/site/gameplay/duel.jpg" aria-label="Recorded 2v2 bot gameplay from Bro Battles"></video>
        <div class="about-film-label"><span class="about-recording-mark" aria-hidden="true"></span>In the arena <span>Recorded gameplay · Bot matches</span></div>
        <button class="about-reel-toggle" type="button" aria-label="Play gameplay highlights" data-reel-toggle>▶ Play highlights</button>
        <div class="about-video-progress" aria-hidden="true"><span data-reel-progress></span></div>
      </div>
      <p class="about-reel-status" data-reel-status role="status" hidden></p>
    <noscript><p><a href="/assets/site/gameplay/duel.mp4">Watch the gameplay clip</a></p></noscript>
    </div>
  </section>
  <section class="about-basics" id="how-to-play" aria-labelledby="basics-title">
    <div class="about-section-heading"><div><h2 id="basics-title">Jump in. Fight back.</h2></div></div>
    <div class="about-basics-grid">
      <article><h3>Move.</h3><p>Jump between platforms and dash out of danger.</p><div class="about-key-hint"><kbd>W A S D</kbd><span>move &amp; jump</span><kbd>Space</kbd><span>dash</span></div></article>
      <article><h3>Aim.</h3><p>Aim your weapon and make each shot count.</p><div class="about-key-hint"><kbd>Mouse</kbd><span>aim</span><kbd>Click</kbd><span>attack</span></div></article>
      <article><h3>Unleash.</h3><p>Land hits to charge a powerful super.</p><a class="about-text-link" href="/help/controls">See all controls <span aria-hidden="true">→</span></a></article>
    </div>
  </section>
  <section class="about-roster" id="fighters" aria-labelledby="fighters-title">
    <div class="about-section-heading"><div><h2 id="fighters-title">Meet the fighters.</h2></div></div>
    <div class="about-roster-grid">${Object.entries(characterStats).map(([key, stats]) => `
      <details class="about-fighter" id="fighter-${escape(key)}"><summary><span class="about-fighter-art"><img src="/assets/${escape(key)}/body.webp" width="256" height="256" loading="lazy" alt=""/></span><span class="about-fighter-name">${escape(key[0].toUpperCase() + key.slice(1))} <span class="about-fighter-plus" aria-hidden="true">+</span></span></summary><div class="about-fighter-moves"><p><strong>Attack</strong>${escape(stats.attackDescription)}</p><p><strong>Super</strong>${escape(stats.specialDescription)}</p></div></details>`).join('')}
    </div>
  </section>
  <section class="about-game-modes" id="modes" aria-labelledby="modes-title">
    <div class="about-section-heading"><div><h2 id="modes-title">Two ways to battle.</h2></div></div>
    <div class="about-mode-grid">${modes.map(mode => `
      <article class="about-mode" id="mode-${escape(mode.id)}"><img src="${escape(mode.artAsset)}" width="1280" height="960" alt="" loading="lazy"/><div class="about-mode-copy"><span class="site-eyebrow">${mode.id === 'duels' ? '1v1 & 2v2 · Elimination' : `3v3 · Unlocks at ${Number(mode.unlockTrophies)} peak trophies`}</span><h3>${escape(mode.label)}</h3><p>${mode.id === 'duels' ? 'One life per round. Fight solo or with a teammate to be the last side standing.' : 'Empty the enemy vault or finish with more coins. Build defenses, raid as a team, and respawn when you fall.'}</p><a class="about-text-link" href="/help/modes-and-maps#${mode.id === 'duels' ? 'duels' : 'bank-bust'}">Learn ${escape(mode.label)} <span aria-hidden="true">→</span></a></div></article>`).join('')}
    </div>
  </section>
  <section class="about-crew" id="your-crew" aria-labelledby="crew-title">
    <div class="about-crew-art" aria-hidden="true"><img src="/assets/thorg/body.webp" width="256" height="256" loading="lazy" alt=""/><img src="/assets/ozzy/body.webp" width="256" height="256" loading="lazy" alt=""/><img src="/assets/gloop/body.webp" width="256" height="256" loading="lazy" alt=""/></div>
    <div><h2 id="crew-title">Bring your crew.</h2><p>Invite your friends to a party and head into battle together.</p><div class="about-actions"><a class="about-text-link" href="/help/parties">How to party up <span aria-hidden="true">→</span></a><a class="about-text-link" href="/help/getting-started">First match guide <span aria-hidden="true">→</span></a></div></div>
  </section>
`;
}

function renderFooter(config) {
  return `<footer class="arena-footer">
    <div class="arena-footer-scene" aria-hidden="true"><img src="/assets/serenity/full-preview.webp" width="1920" height="937" loading="lazy" alt=""/><span>See you in the arena.</span><div><img src="/assets/ninja/body.webp" width="180" height="180" loading="lazy" alt=""/><img src="/assets/sparrow/body.webp" width="180" height="180" loading="lazy" alt=""/></div></div>
    <div class="arena-footer-links"><div class="arena-footer-brand"><a href="/about"><img src="/assets/logos/wordmark.webp" width="240" height="80" loading="lazy" alt="Bro Battles"/></a></div>
    <nav aria-label="Explore"><h2>The game</h2><a href="/about#fighters">Meet the fighters</a><a href="/about#modes">Ways to play</a><a href="/news">News &amp; updates</a></nav>
    <nav aria-label="Player support"><h2>Need backup?</h2><a href="/help/getting-started">First match guide</a><a href="/help">Help Center</a><a href="/help/contact">Contact support</a><a href="/feedback">Send feedback</a></nav>
    <nav aria-label="Account and legal"><h2>Your corner</h2><a href="/help/requests">My support requests</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:${escape(config.supportEmail)}">Email us</a></nav>
    <div class="arena-footer-bottom"><span>© ${new Date().getUTCFullYear()} Bro Battles</span><span>${escape(config.releaseName || config.version || 'Beta')}</span><a href="#main">Back to top ↑</a></div></div>
  </footer>`;
}
module.exports = { renderAboutPage, renderFooter };
