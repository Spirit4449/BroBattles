export async function executeScript(source, owner) {
  if (!owner.active || !source.src) return;
  // The edge may inject analytics into fetched HTML. The initial document has
  // already handled those scripts; replaying them on a route change can make a
  // browser extension's blocked beacon fail the entire navigation.
  if (new URL(source.src, location.href).origin !== location.origin) return;
  if ((/\/socket\.io\/socket\.io\.js/.test(source.src) || /\/bundles\/navigation[.]/.test(source.src))) return;
  if (/phaser-arcade-physics/.test(source.src) && window.Phaser) return;
  const script = document.createElement('script');
  Object.assign(script.dataset, source.dataset);
  script.src = source.src;
  script.dataset.bbPageScope = owner.id;
  script.async = false;
  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Unable to load ${source.src}`));
    document.body.append(script);
  });
  script.remove();
}
