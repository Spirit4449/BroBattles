const {renderHeader}=require('../../shared/siteHeader.cjs');
const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const config = require('../../shared/siteConfig.json');
const root = path.resolve(__dirname,'../../..','content');
const manifest = require('../../../content/manifest.json');
const { defaultCharacterList } = require('../../shared/characterStats');
const { helpSearchDocuments } = require('./helpSearchService');
const modes = require('../../shared/gameModes.catalog.json').modes.filter(mode=>mode.implemented && mode.queueable);
const helpArt={'Getting Started':'/assets/profile-icons/ninja.webp','Gameplay':'/assets/profile-icons/thorg.webp','Accounts':'/assets/profile-icons/blob.webp','Purchases':'/assets/gem.webp','Troubleshooting':'/assets/settings.webp','Safety & Privacy':'/assets/powerups/shield/icon.webp'};
const md = new MarkdownIt({ html:false, linkify:false, breaks:false });
const escape = value => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
function article(kind, slug) {
  if (!['news','help','legal'].includes(kind) || !/^[a-z0-9-]+$/.test(slug)) return null;
  const item = kind === 'legal' ? ({terms:{title:'Terms of Service'},privacy:{title:'Privacy Policy'}}[slug]) : manifest[kind].find(item=>item.slug===slug);
  if (!item) return null;
  return { ...item, html:md.render(fs.readFileSync(path.join(root,kind,`${slug}.md`),'utf8')) };
}
function card(item, kind) {
  return `<a class="site-card" href="/${kind}/${escape(item.slug)}">${item.image ? `<img src="${escape(item.image)}" alt="" loading="lazy"/>` : ''}<div>${item.date ? `<time>${escape(item.date)}</time>` : ''}<h3>${escape(item.title)}</h3><p>${escape(item.summary)}</p><span aria-hidden="true">Read more →</span></div></a>`;
}
function frame(title, description, body, urlPath) {
  let canonical = '';
  try { if (process.env.PUBLIC_BASE_URL) canonical = `<link rel="canonical" href="${escape(new URL(urlPath,process.env.PUBLIC_BASE_URL).href)}"/>`; } catch (_) {}
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${escape(title)} · Bro Battles</title><meta name="description" content="${escape(description)}"/>${canonical}
    <link rel="icon" href="/assets/logos/logo-small.webp"/><link rel="stylesheet" href="/styles/ui-system.css"/><link rel="stylesheet" href="/bundles/site.css"/>
    </head><body class="site-page ${urlPath==='/about'?'site-about':''}"><a class="site-skip" href="#main">Skip to content</a>${renderHeader(urlPath)}
    <main id="main" class="site-main">${body}</main><footer class="site-footer"><div class="site-footer-brand"><img src="/assets/logos/wordmark.webp" alt="Bro Battles"/></div><div><h3>Explore</h3><a href="/about">The game</a><a href="/about#modes">Game modes</a><a href="/news">News</a></div><div><h3>Player support</h3><a href="/help">Help Center</a><a href="/help/requests">My requests</a><a href="/feedback">Feedback</a></div><div><h3>The essentials</h3><a href="/privacy">Privacy Policy</a><a href="/terms">Terms of Service</a><a href="mailto:${config.supportEmail}">Contact us</a></div></footer><script src="/bundles/site.bundle.js" defer></script></body></html>`;
}
function registerSitePages(app) {
  app.get('/api/site/legal/:kind',(req,res)=> {
    const value = article('legal',req.params.kind);
    if (!value) return res.status(404).json({error:'Document not found.'});
    res.json(value);
  });
  app.get('/about',(_req,res)=>res.send(frame('About','Fast browser battles. Pick your fighter and play with friends.',`
    <section class="site-hero" data-media-slot="about-hero"><div class="site-hero-copy"><h1>One more match.<br/>One more rivalry.</h1><p>Outplay your rivals in Duels. Raid the vault in Bank Bust. Bring your crew and make the arena yours.</p><a class="pixel-menu-button site-play" href="/">Enter the arena</a></div><img src="/assets/lushy/lobbyBg.webp" alt="The Lushy Peaks arena"/></section>
    <section class="site-grid site-features"><article class="site-panel"><h2>Built for battles</h2><p>Quick browser action with real-time multiplayer combat.</p></article><article class="site-panel"><h2>Your playstyle</h2><p>Choose a fighter and master their attacks and special abilities.</p></article><article class="site-panel"><h2>Better with friends</h2><p>Create a party, ready up, and take on the arena together.</p></article></section>
    <section class="site-fighters" id="fighters"><span class="site-eyebrow">Meet your fighter</span><h2>Pick a favorite. Master their moves.</h2><div class="site-fighter-grid">${Object.keys(defaultCharacterList()).map(key=>`<a class="site-fighter" href="/"><img src="/assets/profile-icons/${escape(key)}.webp" alt="" loading="lazy"/><strong>${escape(key[0].toUpperCase()+key.slice(1))}</strong></a>`).join('')}</div></section>
    <section class="site-modes" id="modes"><span class="site-eyebrow">Choose your kind of chaos</span><h2>More than one way to win.</h2><div class="site-mode-grid">${modes.map(mode=>`<article class="site-card site-mode"><div class="site-mode-art" data-media-slot="mode-${mode.id}"><img src="${escape(mode.artAsset)}" alt="${escape(mode.label)}" loading="lazy"/></div><div><span class="site-eyebrow">${mode.id==='duels'?'Outplay. Outsmart. Outlast.':'Get in. Grab it. Get out.'}</span><h3>${escape(mode.label)}</h3><p>${mode.id==='duels'?'Make every dodge count. Face a rival in 1v1 or bring backup for 2v2 and 3v3 elimination battles.':'Crack the opposing bank while protecting your own. Balance daring raids with a defense your squad can count on.'}</p><a class="pixel-menu-button site-play" href="/">Jump in</a></div></article>`).join('')}</div></section>
    <section class="site-showcase"><div><span class="site-eyebrow">Find your arena</span><h2>Different maps. New rivalries.</h2><p>Explore the available fighters and maps in the lobby. Bro Battles is in beta, and your feedback helps shape what comes next.</p><a href="/news">Latest news →</a></div><img src="/assets/mangrove/lobbyBg.webp" alt="Mangrove Meadow arena" loading="lazy"/></section>
    <section class="site-panel site-cta"><h2>Ready to battle?</h2><a class="pixel-menu-button site-play" href="/">Play now</a></section>`,'/about')));
  app.get('/news',(_req,res)=>res.send(frame('News','Updates from Bro Battles.',`<div class="site-heading"><span class="site-eyebrow">From the arena</span><h1>News</h1><p>Updates, announcements, and what comes next.</p></div><div class="site-grid">${[...manifest.news].sort((a,b)=>b.date.localeCompare(a.date)).map(item=>card(item,'news')).join('')}</div>`,'/news')));
  app.get('/help',(_req,res)=> {
    const categories = [...new Set(manifest.help.map(item=>item.category))];
    const searchDocuments = helpSearchDocuments();
    res.send(frame('Help Center','Answers and support for Bro Battles.',`<section class="site-help-hero"><span class="site-eyebrow">Help Center</span><h1>How can we help?</h1><label class="site-search"><span class="site-visually-hidden">Search the Help Center</span><input id="help-search" type="search" placeholder="How does matchmaking work?" aria-label="Search the Help Center" autocomplete="off"/><span class="site-search-status" id="help-search-status" role="status" aria-live="polite"></span></label></section>
      <div class="site-help-actions"><a class="pixel-menu-button" href="/help/contact">Contact us</a><a class="pixel-menu-button site-secondary" href="/help/requests">My requests <span class="site-support-badge" data-support-unread aria-hidden="true">NEW</span></a></div>
      <div class="site-grid" id="help-categories">${categories.map(category=>`<section class="site-panel site-help-card" data-help-category><img class="site-help-art" src="${helpArt[category] || '/assets/coin.webp'}" alt="" loading="lazy"/><h2>${escape(category)}</h2>${manifest.help.filter(item=>item.category===category).map(item=>`<a class="site-help-link" data-help-slug="${escape(item.slug)}" href="/help/${item.slug}"><span class="site-help-link-copy"><strong>${escape(item.title)}</strong><small>${escape(item.summary)}</small></span><span aria-hidden="true">→</span></a>`).join('')}</section>`).join('')}</div><p id="help-empty" hidden>No matching answers yet. Try different words or <a href="/help/contact">contact us</a>.</p><script id="help-search-documents" type="application/json">${JSON.stringify(searchDocuments).replace(/</g,'\\u003c')}</script>`, '/help'));
  });
  for (const route of ['/feedback','/help/contact','/help/requests']) {
    const title = route==='/feedback' ? 'Feedback' : route.endsWith('contact') ? 'Contact us' : 'My requests';
    app.get(route,(_req,res)=>res.send(frame(title,`${title} for Bro Battles.`,`<div class="site-heading"><a href="/help">← Help Center</a><h1>${title}</h1><p>${route==='/feedback' ? 'Found a bug? Have an idea? Tell us.' : 'Support, right here in the game.'}</p></div><div id="support-app" data-view="${route==='/feedback'?'feedback':route.endsWith('contact')?'contact':'requests'}" class="site-panel"><p role="status">Loading…</p></div><p class="site-contact-note">Cannot access your account? Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>. Never send passwords or card details.</p>`,route)));
  }
  for (const kind of ['news','help']) app.get(`/${kind}/:slug`,(req,res)=> {
    const item=article(kind,req.params.slug);
    if (!item) return res.status(404).send(frame('Not found','Article not found.',`<h1>Article not found</h1><a href="/${kind}">Back to ${kind}</a>`,req.path));
    res.send(frame(item.title,item.summary || item.title,`<article class="site-article"><a href="/${kind}">← ${kind==='help'?'Help Center':'News'}</a><h1>${escape(item.title)}</h1>${item.date?`<time>${escape(item.date)}</time>`:''}<div class="site-prose">${item.html}</div>${kind==='help'?'<a class="pixel-menu-button" href="/help/contact">Still need help?</a>':''}</article>`,req.path));
  });
  for (const kind of ['terms','privacy']) app.get(`/${kind}`,(_req,res)=> {
    const item=article('legal',kind);
    res.send(frame(item.title,item.title+' for Bro Battles.',`<article class="site-article"><h1>${item.title}</h1><nav class="site-toc" aria-label="Document sections"></nav><div class="site-prose">${item.html}</div></article>`,`/${kind}`));
  });
}
module.exports={registerSitePages,article,frame};
