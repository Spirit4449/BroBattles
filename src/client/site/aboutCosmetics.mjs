// "Make it yours": a collection grid of real cosmetics. While it's on screen,
// one tile at a time unlocks a different item of the same kind, swapping with
// a pixel dissolve: the old item breaks into blocks, the new one assembles.
const SWAP_MS = 1900;
const BLOCK = 10;
const COVER_MS = 300;
const REVEAL_MS = 380;

function escape(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}
function tileMarkup(item) {
  const label = `<span class="about-tile-label"><span class="rarity-tag tag rarity-${escape(item.rarity)}">${escape(item.rarity)}</span><strong>${escape(item.name)}</strong></span>`;
  if (item.kind === 'card') {
    const w = item.window;
    return `<span class="about-tile-art about-card-art"><span class="about-card"><img class="about-card-frame" src="${escape(item.image)}" alt=""/><img class="about-card-bro" src="${escape(item.bro)}" alt="" style="left:${(w.x * 100).toFixed(2)}%;top:${(w.y * 100).toFixed(2)}%;width:${(w.w * 100).toFixed(2)}%;height:${(w.h * 100).toFixed(2)}%"/></span></span>${label}`;
  }
  if (item.kind === 'title') return `<span class="about-tile-art about-title-art"><span class="bb-player-title" style="--title-color:${escape(item.color)};--title-gleam:${escape(item.gleam)}">${escape(item.name)}</span></span>${label}`;
  return `<span class="about-tile-art"><img src="${escape(item.image)}" alt=""/></span>${label}`;
}
const shuffled = count => {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  return order;
};
const solid = (color, fallback) => (!color || /rgba\(.*,\s*0\)$/.test(color) || color === 'transparent' ? fallback : color);

// Blocks in the tile's own colours cover the old item (a rarity-coloured edge
// leads the way), the content swaps underneath, then the blocks clear at random.
function dissolve(tile, swapContent) {
  return new Promise(resolve => {
    const box = tile.getBoundingClientRect();
    const art = tile.querySelector('.about-tile-art')?.getBoundingClientRect();
    const cols = Math.ceil(box.width / BLOCK), rows = Math.ceil(box.height / BLOCK);
    const canvas = document.createElement('canvas');
    canvas.className = 'about-tile-dissolve';
    canvas.width = cols; canvas.height = rows;
    const ctx = canvas.getContext('2d');
    const style = getComputedStyle(tile);
    const tileColor = solid(style.backgroundColor, '#16243a');
    const artColor = solid(art && getComputedStyle(tile.querySelector('.about-tile-art')).backgroundColor, '#0b1629');
    const edge = solid(style.getPropertyValue('--bb-rarity-fill').trim(), '#ffd36a');
    const colorOf = index => {
      if (!art) return tileColor;
      const x = box.left + (index % cols + 0.5) * BLOCK, y = box.top + (Math.floor(index / cols) + 0.5) * BLOCK;
      return x >= art.left && x <= art.right && y >= art.top && y <= art.bottom ? artColor : tileColor;
    };
    const paint = (index, color) => { ctx.fillStyle = color; ctx.fillRect(index % cols, Math.floor(index / cols), 1, 1); };
    let order = shuffled(cols * rows), done = 0, front = [], phase = 'cover', started = performance.now();
    tile.append(canvas);
    function frame(now) {
      const elapsed = now - started;
      if (phase === 'cover') {
        const target = Math.min(order.length, Math.ceil(order.length * Math.min(1, elapsed / COVER_MS)));
        front.forEach(index => paint(index, colorOf(index)));
        front = order.slice(done, target);
        front.forEach(index => paint(index, edge));
        done = target;
        if (elapsed >= COVER_MS) {
          front.forEach(index => paint(index, colorOf(index)));
          swapContent();
          tile.append(canvas);
          phase = 'reveal'; order = shuffled(cols * rows); done = 0; started = now;
        }
      } else {
        const target = Math.min(order.length, Math.ceil(order.length * Math.min(1, elapsed / REVEAL_MS)));
        for (; done < target; done++) ctx.clearRect(order[done] % cols, Math.floor(order[done] / cols), 1, 1);
        if (elapsed >= REVEAL_MS) { canvas.remove(); resolve(); return; }
      }
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  });
}
const preload = src => new Promise(resolve => { if (!src) return resolve(); const image = new Image(); image.onload = image.onerror = () => resolve(); image.src = src; });

export function initializeAboutCosmetics(root = document.querySelector('[data-cosmetics]')) {
  const dataNode = document.getElementById('about-cosmetic-data');
  if (!root || !dataNode || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const pools = JSON.parse(dataNode.textContent);
  const tiles = [...root.querySelectorAll('[data-kind]')];
  let timer = 0, inView = false, last = null;

  async function swap() {
    // Pick a tile (not the one just changed) whose kind has an item not on show.
    const shown = new Set(tiles.map(tile => tile.dataset.name));
    const options = tiles.filter(tile => tile !== last && pools[tile.dataset.kind]?.some(item => !shown.has(item.name)));
    if (!options.length) return;
    const tile = options[Math.floor(Math.random() * options.length)];
    const choices = pools[tile.dataset.kind].filter(item => !shown.has(item.name));
    const item = choices[Math.floor(Math.random() * choices.length)];
    await Promise.all([preload(item.image), preload(item.bro)]);
    last = tile;
    await dissolve(tile, () => {
      tile.innerHTML = tileMarkup(item);
      tile.dataset.name = item.name;
      tile.className = tile.className.replace(/\brarity-\w+/, `rarity-${item.rarity}`);
    });
    tile.classList.remove('is-unlocking'); void tile.offsetWidth; tile.classList.add('is-unlocking');
  }
  function schedule() {
    clearTimeout(timer);
    if (!inView || document.hidden) return;
    timer = setTimeout(async () => { await swap(); schedule(); }, SWAP_MS);
  }
  new IntersectionObserver(entries => { inView = entries[0].isIntersecting; schedule(); }, { threshold: 0.25 }).observe(root);
  document.addEventListener('visibilitychange', schedule);
}
