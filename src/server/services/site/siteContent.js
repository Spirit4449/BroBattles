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
const { escapeHtml: escape, arrowHtml: arrow } = require("../../../shared/site/html.cjs");
// Currency chips, click paths, inputs, callouts and pixel arrows.
require('../../../shared/site/markdownComponents.cjs').useMarkdownComponents(md);
function article(kind, slug) {
  if (!['news','help','legal'].includes(kind) || !/^[a-z0-9-]+$/.test(slug)) return null;
  const item = kind === 'legal' ? ({terms:{title:'Terms of Service'},privacy:{title:'Privacy Policy'}}[slug]) : manifest[kind].find(item=>item.slug===slug);
  if (!item) return null;
  const source = fs.readFileSync(path.join(root,kind,`${slug}.md`),'utf8');
  return { ...item, html:md.render(source), words:source.split(/\s+/).filter(Boolean).length };
}
function dateLabel(date) {
  const parsed = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? date : new Intl.DateTimeFormat('en-US', { month:'long', day:'numeric', year:'numeric', timeZone:'UTC' }).format(parsed);
}
const newest = () => [...manifest.news].sort((a,b)=>b.date.localeCompare(a.date));
const readTime = words => `${Math.max(1, Math.round(words / 220))} min read`;
function newsMeta(item, extra = '') {
  return `<div class="site-news-meta"><time datetime="${escape(item.date)}">${escape(dateLabel(item.date))}</time>${extra}</div>`;
}
function card(item, featured = false) {
  return `<a class="site-tile site-news-card${featured ? ' site-news-featured' : ''}" href="/news/${escape(item.slug)}">${item.image ? `<span class="site-news-art"><img src="${escape(item.image)}" width="1280" height="960" alt="" ${featured ? 'fetchpriority="high"' : 'loading="lazy"'}/></span>` : ''}<span class="site-news-body">${newsMeta(item)}<h2>${escape(item.title)}</h2><p>${escape(item.summary)}</p><span class="site-news-read" aria-hidden="true">Read more ${arrow('right', 'sm')}</span></span></a>`;
}
function intro(title, line, back) {
  return `<header class="site-intro">${back ? `<nav class="site-breadcrumb" aria-label="Breadcrumb"><a href="${back[1]}">${arrow('left', 'sm')}<span>${back[0]}</span></a></nav>` : ''}<h1>${title}</h1>${line ? `<p class="site-intro-line">${line}</p>` : ''}</header>`;
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
    <link rel="icon" href="/assets/logos/logo-small.webp"/>
    <link rel="preload" href="/assets/PressStart2P.woff2" as="font" type="font/woff2" crossorigin/><link rel="preload" href="/assets/fonts/lato/lato-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin/>
    <link rel="stylesheet" href="/styles/lato.css"/><link rel="stylesheet" href="/styles/ui-system.css"/><link rel="stylesheet" href="/bundles/site.css"/>
    </head><body class="site-page${options.bodyClass ? ` ${options.bodyClass}` : ''}"><a class="site-skip" href="#main">Skip to content</a>${renderHeader(urlPath)}
    <main id="main" class="site-main">${body}</main>${renderFooter(config)}<script src="/bundles/site.bundle.js" defer></script></body></html>`;
}
function helpIndex() {
  const categories = [...new Set(manifest.help.map(item=>item.category))];
  const searchDocuments = helpSearchDocuments();
  const inCategory = category => manifest.help.filter(item=>item.category===category);
  const action = (href, icon, title, line, badge = '') => `<a class="site-tile site-help-action" href="${href}"><img src="${icon}" width="40" height="40" alt=""/><span><strong>${title}${badge}</strong><small>${line}</small></span>${arrow('right', 'sm')}</a>`;
  return `<section class="site-frame site-help-hero"><div class="site-help-hero-copy"><h1>How can we help?</h1><div class="site-search"><label class="site-visually-hidden" for="help-search">Search the Help Center</label><span class="site-search-icon" aria-hidden="true"></span><input id="help-search" type="search" placeholder="How does matchmaking work?" autocomplete="off"/><span class="site-search-status" id="help-search-status" role="status" aria-live="polite" aria-atomic="true"></span></div></div><img class="site-help-hero-art" src="/assets/site/help-banner.webp" alt=""/></section>
    <div class="site-help-actions">${action('/help/contact','/assets/icons/menu/help.webp','Contact support','Account, purchase or player trouble')}${action('/help/requests','/assets/icons/chat.webp','My requests','Read replies from the team',' <span class="site-support-badge" data-support-unread aria-hidden="true">NEW</span>')}${action('/feedback','/assets/icons/menu/feedback.webp','Send feedback','Ideas and opinions, no reply needed')}</div>
    <div class="site-section-heading site-help-heading"><h2>Browse by topic</h2><span>${manifest.help.length} articles</span></div>
    <div class="site-help-topics" id="help-categories">${categories.map(category=>`<section class="site-tile site-help-card" data-help-category><div class="site-help-card-header"><img class="site-help-art" src="/assets/site/help-icons/${helpArt[category] || 'getting-started'}.png" width="48" height="48" alt="" loading="lazy"/><div><h2>${escape(category)}</h2><span class="site-help-count">${inCategory(category).length} ${inCategory(category).length === 1 ? 'article' : 'articles'}</span></div></div>${inCategory(category).map(item=>`<a class="site-help-link" data-help-slug="${escape(item.slug)}" href="/help/${item.slug}"><span class="site-help-link-copy"><strong>${escape(item.title)}</strong><small>${escape(item.summary)}</small></span>${arrow('right', 'sm')}</a>`).join('')}</section>`).join('')}</div>
    <p id="help-empty" class="site-empty" hidden>No matching answers yet. Try different words or <a href="/help/contact">contact us</a>.</p><script id="help-search-documents" type="application/json">${JSON.stringify(searchDocuments).replace(/</g,'\\u003c')}</script>`;
}
function newsArticle(item) {
  const related = newest().filter(other=>other.slug!==item.slug);
  return `<article class="site-article site-story">
    <nav class="site-breadcrumb" aria-label="Breadcrumb"><a href="/news">${arrow('left', 'sm')}<span>News</span></a></nav>
    <header class="site-story-head">${newsMeta(item, `<span>${readTime(item.words)}</span>`)}<h1>${escape(item.title)}</h1></header>
    ${item.image ? `<figure class="site-story-art"><img src="${escape(item.image)}" width="1280" height="960" alt="" fetchpriority="high"/></figure>` : ''}
    <div class="site-prose site-story-body">${item.html}</div>
    <aside class="site-frame site-cta-band site-news-cta"><img src="/assets/profile-icons/ninja.webp" width="64" height="64" alt=""/><div><h2>Ready to fight?</h2><p>The lobby is one click away. No download.</p></div><a class="pixel-menu-button site-btn site-btn-play" href="/">Play free ${arrow('right')}</a></aside>
    ${related.length ? `<section class="site-more" aria-labelledby="more-stories"><div class="site-section-heading"><h2 id="more-stories">More stories</h2><a class="site-link" href="/news">All news ${arrow('right', 'sm')}</a></div><div class="site-related site-news-grid">${related.map(other=>card(other)).join('')}</div></section>` : ''}
  </article>`;
}
function helpArticle(item) {
  const related = manifest.help.filter(other=>other.category===item.category && other.slug!==item.slug);
  return `<article class="site-article site-guide">
    <nav class="site-breadcrumb" aria-label="Breadcrumb"><a href="/help">${arrow('left', 'sm')}<span>Help Center</span></a>${item.category ? `<span class="site-breadcrumb-separator" aria-hidden="true">/</span><span class="site-breadcrumb-current">${escape(item.category)}</span>` : ''}</nav>
    <header class="site-guide-head"><h1>${escape(item.title)}</h1>${item.summary ? `<p class="site-article-summary">${escape(item.summary)}</p>` : ''}</header>
    <div class="site-prose">${item.html}</div>
    <aside class="site-frame site-cta-band site-article-support"><img src="/assets/icons/menu/help.webp" width="48" height="48" alt=""/><div><h2>Still stuck?</h2><p>Send us a request and we'll reply in My requests.</p></div><a class="pixel-menu-button site-btn" href="/help/contact">Contact us ${arrow('right')}</a></aside>
    ${related.length ? `<section class="site-more" aria-labelledby="more-help"><div class="site-section-heading"><h2 id="more-help">More in ${escape(item.category)}</h2></div><div class="site-related site-guide-links">${related.map(other=>`<a class="site-tile" href="/help/${escape(other.slug)}"><span><strong>${escape(other.title)}</strong><small>${escape(other.summary)}</small></span>${arrow('right', 'sm')}</a>`).join('')}</div></section>` : ''}
  </article>`;
}
const SUPPORT_PAGES = {
  '/feedback': { view:'feedback', title:'Feedback', heading:'Tell us what you think', line:'Ideas, balance takes, things you love or hate. We read every note. We can\'t reply here, so for account help <a href="/help/contact">contact support</a>.' },
  '/help/contact': { view:'contact', title:'Contact us', heading:'Contact support', line:'Something wrong with your account, a purchase or another player? Tell us and we\'ll reply in My requests.' },
  '/help/requests': { view:'requests', title:'My requests', heading:'My requests', line:'' },
};
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
  app.get('/about',(_req,res)=>res.send(frame('About the Game','Bro Battles is a free 2D arena game you play in your browser. Meet the fighters, watch real gameplay, and jump into Duels or Bank Bust.',renderAboutPage(modes),'/about',{image:'/assets/site/gameplay/last-stand.jpg',bodyClass:'site-about'})));
  app.get('/news',(_req,res)=> {
    const stories = newest();
    res.send(frame('News','The latest from Bro Battles: beta news, Duels, and Bank Bust.',`<header class="site-intro site-news-heading"><h1>Bro Battles News</h1></header><div class="site-news-board">${stories.length ? card(stories[0],true) : '<p class="site-empty">No stories yet. Check back soon.</p>'}${stories.length > 1 ? `<section class="site-news-grid" aria-label="More news">${stories.slice(1).map(item=>card(item)).join('')}</section>` : ''}</div>`, '/news'));
  });
  app.get('/help',(_req,res)=>res.send(frame('Help Center','Answers and support for Bro Battles.',helpIndex(),'/help')));
  for (const [route, page] of Object.entries(SUPPORT_PAGES)) {
    app.get(route,(_req,res)=>res.send(frame(page.title,`${page.title} for Bro Battles.`,`${intro(page.heading,page.line,['Help Center','/help'])}<div id="support-app" data-view="${page.view}" class="site-support-app"><div class="site-frame site-support-loading" role="status">Loading…</div></div><p class="site-contact-note">Can't sign in? Email <a href="mailto:${config.supportEmail}">${config.supportEmail}</a>. Never send passwords or card details.</p>`,route,{noindex:true,bodyClass:'site-support-page'})));
  }
  for (const kind of ['news','help']) app.get(`/${kind}/:slug`,(req,res)=> {
    const item=article(kind,req.params.slug);
    if (!item) return res.status(404).send(frame('Not found','Article not found.',`${intro('Article not found',`It may have moved. <a href="/${kind}">Back to ${kind === 'news' ? 'News' : 'the Help Center'}</a>.`)}`,req.path));
    res.send(frame(item.title,item.summary || item.title,kind === 'news' ? newsArticle(item) : helpArticle(item),req.path,{article:kind==='news',image:item.image}));
  });
  for (const kind of ['terms','privacy']) app.get(`/${kind}`,(_req,res)=> {
    const item=article('legal',kind);
    const effective = dateLabel(config[`${kind}Version`]);
    const other = kind === 'terms' ? ['Privacy Policy','/privacy'] : ['Terms of Service','/terms'];
    res.send(frame(item.title,item.title+' for Bro Battles.',`<article class="site-article site-legal">
      <header class="site-legal-head"><img src="/assets/ui/${kind === 'terms' ? 'terms-scroll' : 'privacy-shield'}-pixel.webp" width="72" height="72" alt=""/><div><h1>${item.title}</h1><p>Effective ${escape(effective)} · <a href="${other[1]}">${other[0]}</a></p></div></header>
      <div class="site-legal-layout"><nav class="site-frame site-toc" aria-label="Document sections"><div class="site-frame-head"><h2>Contents</h2></div></nav><div class="site-frame site-legal-doc"><div class="site-prose">${item.html.replace(/^<p><strong>Effective date:[^<]*<\/strong><\/p>\n?/, '')}</div></div></div>
    </article>`,`/${kind}`));
  });
}
module.exports={registerSitePages,article,frame};
