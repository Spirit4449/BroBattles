import { getTemplateResources } from './preload';

const routeLoaderFontStyleId = 'bb-route-loader-font';

// Navigation is the one stylesheet that remains mounted while pages swap.
// Keep the loading font here as well, otherwise removing game.css can briefly
// make the route bar fall back to a system font before lobby.css has settled.
export function ensureRouteLoaderFont() {
  if (!document.head?.append || document.getElementById?.(routeLoaderFontStyleId)) return;
  const style = document.createElement('style');
  style.id = routeLoaderFontStyleId;
  style.dataset.navigation = 'route-loader-font';
  style.textContent = '@font-face{font-family:"Press Start 2P";src:url("/assets/PressStart2P.woff2") format("woff2");font-display:block}';
  document.head.append(style);
  // Begin fetching before a player starts a route, so the loader never shows
  // a fallback font on the first game or lobby transition.
  document.fonts?.load?.('16px "Press Start 2P"').catch(() => {});
}

export function createRouteStyles() {
  let routeHints = [];
  const styleLoadsByNode = new WeakMap();
  const styleOwners = new WeakMap();

  function clearRouteHints() {
    routeHints.forEach(link => link.remove());
    routeHints = [];
  }

  function preloadRouteScripts(html) {
    for (const url of getTemplateResources(html).filter(url => /\.js(?:\?|$)/.test(url))) {
      if (url.includes('phaser-arcade-physics') && window.Phaser) continue;
      const link = document.createElement('link');
      link.rel = 'preload';
      link.as = 'script';
      link.href = url;
      document.head.append(link);
      routeHints.push(link);
    }
  }

  function createStyleSwap(ticket) {
    const newStyles = [];
    const retained = new Set();
    let oldStyles = [];

    function prepare(destinationHead) {
      oldStyles = [...document.head.querySelectorAll('link[rel="stylesheet"], style:not([data-navigation])')];
      const styleLoads = [];
      // Retain shared sheets without detaching them: moving a loaded <link>
      // can deactivate its CSS until the browser processes it again. Insert new
      // sheets around retained anchors so the destination cascade is still exact.
      const destinationStyles = [...destinationHead.querySelectorAll('link[rel="stylesheet"], style')];
      let previousStyleIndex = -1;
      const anchors = destinationStyles.map(node => {
        const index = oldStyles.findIndex((old, index) => index > previousStyleIndex &&
          node.tagName === old.tagName &&
          (node.tagName === 'LINK' ? node.href === old.href : node.textContent === old.textContent));
        if (index < 0) return null;
        previousStyleIndex = index;
        return oldStyles[index];
      });
      for (const [index, node] of destinationStyles.entries()) {
        const existing = anchors[index];
        if (existing) {
          retained.add(existing);
          styleOwners.set(existing, ticket);
          if (styleLoadsByNode.has(existing)) styleLoads.push(styleLoadsByNode.get(existing));
          continue;
        }
        const copy = node.cloneNode(true);
        styleOwners.set(copy, ticket);
        newStyles.push(copy);
        if (copy.tagName === 'LINK' && new URL(copy.href).origin === location.origin) {
          const loading = new Promise((resolve, reject) => {
            copy.onload = resolve;
            copy.onerror = () => {
              copy.remove();
              reject(new Error(`Unable to load ${copy.href}`));
            };
          });
          styleLoadsByNode.set(copy, loading);
          styleLoads.push(loading);
        }
        const nextAnchor = anchors.slice(index + 1).find(Boolean);
        if (nextAnchor) document.head.insertBefore(copy, nextAnchor);
        else document.head.append(copy);
      }
      for (const node of destinationHead.querySelectorAll('link[rel="preload"][as="font"]')) {
        if (![...document.head.querySelectorAll('link[rel="preload"]')].some(old => old.href === node.href)) {
          document.head.append(node.cloneNode(true));
        }
      }
      return styleLoads;
    }

    function commit() {
      oldStyles.filter(node => !retained.has(node)).forEach(node => node.remove());
    }

    function discard() {
      newStyles.forEach(node => {
        if (styleOwners.get(node) === ticket) node.remove();
      });
    }

    return { prepare, commit, discard };
  }

  return { clearRouteHints, preloadRouteScripts, createStyleSwap };
}
