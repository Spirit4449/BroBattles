// Discover both script tags and the ordered loadScript calls in game.html.
// Reading a template must never execute it or initialize the other screen.
export function getTemplateResources(html) {
  return [...new Set([...html.matchAll(/["'](\/(?:bundles|styles)\/[^"'\s]+\.(?:js|css)(?:\?[^"'\s]*)?)["']/g)]
    .map(match => match[1]))].filter(url => !/\/navigation[.]/.test(url));
}

export function createPreloadManifest(add) {
  const templates = new Map();
  let manifest;
  let modeId;

  function addMode() {
    for (const url of manifest || []) {
      if (typeof url === 'string' && url.startsWith('/bundles/mode-' + modeId + '.')) add(url, 'battle', 1);
      else if (typeof url === 'string' && url.startsWith('/assets/')) add(url, 'battle', 3);
    }
  }
  function seed(target) {
    if (target === 'cards') return;
    const template = templates.get(target);
    if (template) {
      for (const url of template) add(url, target, 1);
    } else add(target === 'battle' ? '/game.html' : '/index.html', target, 0, 'template');
    if (target === 'battle' && modeId) {
      if (manifest) addMode();
      else add('/battle-preload.json', target, 1, 'manifest');
    }
  }

  function accept(job, body) {
    if (job.kind === 'template') {
      templates.set(job.target, getTemplateResources(body));
      seed(job.target);
      return;
    }
    const urls = JSON.parse(body);
    if (!Array.isArray(urls)) throw new Error('Invalid preload manifest');
    manifest = urls;
    addMode();
  }

  function selectMode(value) {
    modeId = String(value || 'duels');
    return modeId;
  }

  return { accept, seed, selectMode };
}
