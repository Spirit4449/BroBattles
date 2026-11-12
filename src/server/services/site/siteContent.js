const {renderHeader}=require('../../../shared/site/siteHeader.cjs');
const fs = require('node:fs');
const path = require('node:path');
const MarkdownIt = require('markdown-it');
const config = require('../../../shared/site/siteConfig.json');
const root = path.resolve(__dirname,"../../../../content");
const manifest = require('../../../../content/manifest.json');
const { renderAboutPage, renderFooter } = require('./aboutPage');
const { helpSearchDocuments } = require('./helpSearchService');
const modes = require('../../../shared/catalogs/gameModes.catalog.json').modes.filter(mode=>mode.implemented && mode.queueable);
const helpArt={'Getting Started':'getting-started','Gameplay':'gameplay','Progression & Rewards':'progression','Accounts':'accounts','Purchases':'purchases','Troubleshooting':'troubleshooting','Safety & Privacy':'safety'};
const md = new MarkdownIt({ html:false, linkify:false, breaks:false });
md.renderer.rules.heading_open = (tokens, index, options, _env, renderer) => {
  const heading = tokens[index + 1];
  if (heading?.type === 'inline') tokens[index].attrSet('id', heading.content.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-'));
  return renderer.renderToken(tokens, index, options);
};
const { escapeHtml: escape } = require("../../../shared/site/html.cjs");
function article(kind, slug) {
  if (!['news','help','legal'].includes(kind) || !/^[a-z0-9-]+$/.test(slug)) return null;
  const item = kind === 'legal' ? ({terms:{title:'Terms of Service'},privacy:{title:'Privacy Policy'}}[slug]) : manifest[kind].find(item=>item.slug===slug);
  if (!item) return null;
  return { ...item, html:md.render(fs.readFileSync(path.join(root,kind,`${slug}.md`),'utf8')) };
}
function dateLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en-US', { month:'long', day:'numeric', year:'numeric', timeZone:'UTC' }).format(parsed);
}
function card(item, featured = false) {
  return `<a class="site-card site-news-card${featured ? ' site-news-featured' : ''}" href="/news/${escape(item.slug)}">${item.image ? `<img src="${escape(item.image)}" alt="" ${featured ? 'fetchpriority="high"' : 'loading="lazy"'}/>` : ''}<div><div class="site-news-meta"><time datetime="${escape(item.date)}">${escape(dateLabel(item.date))}</time></div><h2>${escape(item.title)}</h2><p>${escape(item.summary)}</p><span class="site-news-read" aria-hidden="true">Read more <span class="site-pixel-arrow"></span></span></div></a>`;
}
function publicOrigin() {
  try {
    const url = new URL(process.env.PUBLIC_BASE_URL);
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch (_) { return null; }
}
function frame(title, description, body, urlPath, options = {}) {
  const origin = publicOrigin();
  const fullTitle = `${title} · Bro Battles`;
  const canonical = origin ? new URL(urlPath, origin).href : null;
  const image = origin ? new URL(options.image || '/assets/site/about-hero-v2.webp', origin).href : null;
  const meta = (property, value) => `<meta property="${property}" content="${escape(value)}"/>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
    <title>${escape(fullTitle)}</title><meta name="description" content="${escape(description)}"/>${options.noindex ? '<meta name="robots" content="noindex, follow"/>' : ''}${canonical ? `<link rel="canonical" href="${escape(canonical)}"/>` : ''}
    ${meta('og:site_name','Bro Battles')}${meta('og:type',options.article ? 'article' : 'website')}${meta('og:title',fullTitle)}${meta('og:description',description)}${canonical ? meta('og:url',canonical) : ''}${image ? meta('og:image',image) : ''}
    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}"/><meta name="twitter:title" content="${escape(fullTitle)}"/><meta name="twitter:description" content="${escape(description)}"/>${image ? `<meta name="twitter:image" content="${escape(image)}"/>` : ''}
    <link rel="icon" href="/assets/logos/logo-small.webp"/><link rel="stylesheet" href="/styles/ui-system.css"/><link rel="stylesheet" href="/bundles/site.css"/>
    </head><body class="site-page ${urlPath==='/about'?'site-about':''}"><a class="site-skip" href="#main">Skip to content</a>${renderHeader(urlPath)}
    <main id="main" class="site-main">${body}</main>${renderFooter(config)}<script src="/bundles/site.bundle.js" defer></script></body></html>`;
}
function registerSitePages(app) {
  app.get('/robots.txt', (_req, res) => {
    const origin = publicOrigin();
    res.type('text/plain').send(`User-agent: *\nAllow: /\n${origin ? `Sitemap: ${origin}/sitemap.xml\n` : ''}`);
  });
  app.get('/sitemap.xml', (_req, res) => {
    const origin = publicOrigin();
    if (!origin) return res.status(503).type('text/plain').send('Sitemap unavailable: PUBLIC_BASE_URL is not configured.');
    const paths = ['/', '/about', '/news', '/help', '/privacy', '/terms', ...['news','help'].flatMap(kind => manifest[kind].map(item => `/${kind}/${item.slug}`))];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${paths.map(urlPath => `<url><loc>${escape(new URL(urlPath, origin).href)}</loc></url>`).join('')}</urlset>`);
  });
  app.get('/api/site/legal/:kind',(req,res)=> {
    const value = article('legal',req.params.kind);
    if (!value) return res.status(404).json({error:'Document not found.'});
    res.json(value);
  });
  app.get('/about',(_req,res)=>res.send(frame('About the Game','Bro Battles is a real-time 2D browser arena game. Meet the fighters, watch real gameplay, and discover Duels and Bank Bust.',renderAboutPage(modes),'/about',{image:'/assets/site/gameplay/duel.jpg'})));
  app.get('/news',(_req,res)=> {
    const stories = [...manifest.news].sort((a,b)=>b.date.localeCompare(a.date));
    res.send(frame('News','The latest from Bro Battles: beta news, Duels, and Bank Bust.',`<header class="site-news-heading"><h1>Bro Battles News</h1></header><div class="site-news-board">${stories.length ? card(stories[0],true) : '<p>No stories yet. Check back soon.</p>'}${stories.length > 1 ? `<section class="site-news-more" aria-label="More news"><div class="site-news-grid">${stories.slice(1).map(item=>card(item)).join('')}</div></section>` : ''}</div>`, '/news'));
  });
  app.get('/help',(_req,res)=> {
    const categories = [...new Set(manifest.help.map(item=>item.category))];
    const searchDocuments = helpSearchDocuments();
    res.send(frame('Help Center','Answers and support for Bro Battles.',`<section class="site-help-hero"><span class="site-eyebrow">Help Center</span><h1>How can we help?</h1><div class="site-search"><label class="site-visually-hidden" for="help-search">Search the Help Center</label><input id="help-search" type="search" placeholder="How does matchmaking work?" aria-label="Search the Help Center" autocomplete="off"/><span class="site-search-status" id="help-search-status" role="status" aria-live="polite" aria-atomic="true"></span></div></section>
      <div class="site-help-actions"><a class="pixel-menu-button" href="/help/contact">Contact us</a><a class="pixel-menu-button site-secondary" href="/help/requests">My requests <span class="site-support-badge" data-support-unread aria-hidden="true">NEW</span></a></div>
      <div class="site-section-heading site-help-heading"><div><span class="site-eyebrow">Browse by topic</span><h2>Find your answer</h2></div><span>${manifest.help.length} articles</span></div><div class="site-help-topics" id="help-categories">${categories.map(category=>`<section class="site-panel site-help-card" data-help-category><div class="site-help-card-header"><img class="site-help-art" src="/assets/site/help-icons/${helpArt[category] || 'getting-started'}.png" alt="" loading="lazy"/><div><span class="site-help-count">${manifest.help.filter(item=>item.category===category).length} ${manifest.help.filter(item=>item.category===category).length === 1 ? 'article' : 'articles'}</span><h2>${escape(category)}</h2></div></div>${manifest.help.filter(item=>item.category===category).map(item=>`<a class="site-help-link" data-help-slug="${escape(item.slug)}" href="/help/${item.slug}"><span class="site-help-link-copy"><strong>${escape(item.title)}</strong><small>${escape(item.summary)}</small></span><span class="site-help-arrow" aria-hidden="true"></span></a>`).join('')}</section>`).join('')}</div><p id="help-empty" hidden>No matching answers yet. Try different words or <a href="/help/contact">contact us</a>.</p><script id="help-search-documents" type="application/json">${JSON.stringify(searchDocuments).replace(/</g,'\\u003c')}</script>`, '/help'));
  });
  for (const route of ['/feedback','/help/contact','/help/requests']) {
    const title = route==='/feedback' ? 'Feedback' : route.endsWith('contact') ? 'Contact us' : 'My requests';
    app.get(route,(_req,res)=>res.send(frame(title,`${title} for Bro Battles.`,`<div class="site-heading site-support-heading"><a href="/help">← Help Center</a><h1>${title}</h1><p>${route==='/feedback' ? 'Found a bug? Have an idea? Tell us.' : 'Support, right here in the game.'}</p></div><div id="support-app" data-view="${route==='/feedback'?'feedback':route.endsWith('contact')?'contact':'requests'}" class="site-panel"><p role="status">Loading…</p></div><p class="site-contact-note">Cannot access your account? Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>. Never send passwords or card details.</p>`,route,{noindex:true})));
  }
  for (const kind of ['news','help']) app.get(`/${kind}/:slug`,(req,res)=> {
    const item=article(kind,req.params.slug);
    if (!item) return res.status(404).send(frame('Not found','Article not found.',`<h1>Article not found</h1><a href="/${kind}">Back to ${kind}</a>`,req.path));
    const related = kind === 'help' ? manifest.help.filter(other=>other.category===item.category && other.slug!==item.slug) : manifest.news.filter(other=>other.slug!==item.slug).sort((a,b)=>b.date.localeCompare(a.date)).slice(0,2);
    res.send(frame(item.title,item.summary || item.title,`<article class="site-article site-editorial site-editorial-${kind}"><nav class="site-breadcrumb" aria-label="Breadcrumb"><a href="/${kind}"><span class="site-pixel-arrow site-breadcrumb-arrow" aria-hidden="true"></span><span>${kind==='help'?'Help Center':'News'}</span></a>${item.category ? `<span class="site-breadcrumb-separator" aria-hidden="true">/</span><span class="site-breadcrumb-current">${escape(item.category)}</span>` : ''}</nav>${kind==='news' ? '<div class="site-news-lead">' : ''}<header class="site-article-header">${kind==='help' && !item.category ? `<span class="site-eyebrow">Help</span>` : ''}<h1>${escape(item.title)}</h1>${kind==='help' && item.summary ? `<p class="site-article-summary">${escape(item.summary)}</p>` : ''}${item.date?`<time datetime="${escape(item.date)}">${escape(dateLabel(item.date))}</time>`:''}</header>${kind==='news' && item.image ? `<img class="site-article-art" src="${escape(item.image)}" width="1280" height="960" alt=""/>` : ''}${kind==='news' ? '</div>' : ''}<div class="site-prose">${item.html}</div>${kind==='news' ? '<div class="site-news-cta"><a class="pixel-menu-button site-play" href="/">To the lobby <span class="site-pixel-arrow" aria-hidden="true"></span></a></div>' : ''}${kind==='help'?'<aside class="site-article-support"><div><h2>Still need a hand?</h2><p>Our support team can help you find an answer.</p></div><a class="pixel-menu-button" href="/help/contact">Contact us</a></aside>':''}${related.length ? `<aside class="site-related"><h2>${kind==='help'?'More in this topic':'More stories'}</h2>${related.map(other=>`<a href="/${kind}/${escape(other.slug)}"><span>${escape(other.title)}</span><span class="${kind==='news' ? 'site-pixel-arrow' : ''}" aria-hidden="true">${kind==='help' ? '→' : ''}</span></a>`).join('')}</aside>` : ''}</article>`,req.path,{article:kind==='news',image:item.image}));
  });
  for (const kind of ['terms','privacy']) app.get(`/${kind}`,(_req,res)=> {
    const item=article('legal',kind);
    res.send(frame(item.title,item.title+' for Bro Battles.',`<article class="site-article"><h1>${item.title}</h1><nav class="site-toc" aria-label="Document sections"></nav><div class="site-prose">${item.html}</div></article>`,`/${kind}`));
  });
}
module.exports={registerSitePages,article,frame};
