// "Meet the Bros": the lobby's character cards as tabs, each Bro's real idle
// animation standing on a lobby platform, and a level-up demo built from the
// lobby's own stat boxes and animated level badges, with real stats.
import { buildFramedBodyPortrait } from '../views/bodyPortraitAssets.js';
import { renderLevelBadge } from '../views/levelBadgeView.js';
import { platformSurfaceOffset } from '../lobby/party/platformGrounding.mjs';
import { createSpriteLoop, loadIdleSheet } from './spriteLoop.mjs';

const AUTO_STEP_MS = 1800;
const AUTO_HOLD_MS = 2800;
const STATS = ['health', 'attack', 'special'];
const STAT_FIELD = { health: 'health', attack: 'damage', special: 'special' };

export function initializeAboutBros(root = document.querySelector('[data-about-bros]')) {
  const dataNode = document.getElementById('about-fighter-data');
  if (!root || !dataNode) return;
  const fighters = JSON.parse(dataNode.textContent);
  const keys = Object.keys(fighters);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const tabs = [...root.querySelectorAll('[role="tab"]')];
  const stage = root.querySelector('.about-bro-stage');
  const sky = root.querySelector('[data-bro-sky]');
  const ground = root.querySelector('[data-bro-ground]');
  const platform = root.querySelector('[data-bro-platform]');
  const canvas = root.querySelector('[data-bro-sprite]');
  const still = root.querySelector('[data-bro-still]');
  const sprite = createSpriteLoop(canvas, { reducedMotion });
  const levelWrap = root.querySelector('.about-bro-level');
  const badge = root.querySelector('[data-level-badge]');
  const aura = root.querySelector('[data-bro-aura]');
  const statusLine = root.querySelector('[data-upgrade-status]');
  // Tracks compare every Bro against the strongest fully upgraded one, as in the lobby.
  const max = Object.fromEntries(STATS.map(stat => [stat, Math.max(...keys.map(key => fighters[key].levels.at(-1)[STAT_FIELD[stat]]))]));
  let selected = keys[0], level = 1, auto = !reducedMotion, inView = false, timer = 0, counters = [], token = 0;

  for (const image of root.querySelectorAll('[data-portrait]')) {
    try { image.src = buildFramedBodyPortrait(image.dataset.portrait, `/assets/${image.dataset.portrait}/body.webp`); } catch (_) { /* keep the plain portrait */ }
  }

  // Plant the Bro's feet on the platform's walkable surface, using the
  // lobby's own per-platform standing offsets (the box is the lobby's 638:300).
  function plant() {
    const { width, height } = platform.getBoundingClientRect();
    if (!width) return;
    ground.style.setProperty('--surface', `${Math.round(height - platformSurfaceOffset(platform.src, width))}px`);
  }
  platform.addEventListener('load', plant);
  new ResizeObserver(plant).observe(platform);

  const preload = src => new Promise(resolve => { const image = new Image(); image.onload = image.onerror = () => resolve(); image.src = src; });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  // Switching Bros: the old Bro and platform ease out, the next stage's art
  // loads, then everything is swapped in one go and eases back in while the
  // sky cross-fades. Nothing moves until the new art is ready.
  async function changeStage(key, animate) {
    const mine = ++token;
    const next = fighters[key].stage;
    const sheet = loadIdleSheet(`/assets/${key}/spritesheet.webp`, `/assets/${key}/animations.json`).catch(() => null);
    if (animate) ground.classList.add('is-leaving');
    await Promise.all([next && preload(next.sky), next && preload(next.platform), sheet, animate && wait(200)]);
    if (mine !== token) return;
    if (next) {
      if (animate) {
        const layer = sky.cloneNode();
        layer.classList.add('is-incoming');
        layer.style.backgroundImage = `url('${next.sky}')`;
        sky.after(layer);
        requestAnimationFrame(() => requestAnimationFrame(() => layer.classList.add('is-in')));
        setTimeout(() => { sky.style.backgroundImage = layer.style.backgroundImage; layer.remove(); }, 520);
      } else sky.style.backgroundImage = `url('${next.sky}')`;
      if (!platform.src.endsWith(next.platform)) {
        platform.src = next.platform;
        await platform.decode?.().catch(() => {});
        if (mine !== token) return;
      }
      plant();
    }
    still.src = `/assets/${key}/body.webp`;
    const loaded = await sheet;
    if (mine !== token) return;
    if (loaded) { sprite.show(loaded, fighters[key]); stage.classList.add('is-live'); }
    else stage.classList.remove('is-live');
    ground.classList.remove('is-leaving');
  }

  function countTo(node, from, to) {
    if (reducedMotion || from === to) { node.textContent = to; return; }
    const started = performance.now();
    const step = now => {
      const progress = Math.min(1, (now - started) / 620);
      node.textContent = Math.round(from + (to - from) * (1 - (1 - progress) ** 3));
      if (progress < 1) counters.push(requestAnimationFrame(step));
    };
    counters.push(requestAnimationFrame(step));
  }
  function panel() { return root.querySelector(`#fighter-${selected}`); }
  // Level up: pixels gather around the Bro and rise off them.
  function flare() {
    if (reducedMotion) return;
    const pixels = [];
    for (let i = 0; i < 32; i++) {
      const angle = (i / 32) * Math.PI * 2;
      const pixel = document.createElement('i');
      pixel.style.setProperty('--x', `${Math.round(Math.cos(angle) * 46)}%`);
      pixel.style.setProperty('--y', `${Math.round(Math.sin(angle) * 12)}%`);
      pixel.style.setProperty('--rise', `${Math.round(70 + Math.random() * 110)}px`);
      pixel.style.setProperty('--delay', `${Math.round(Math.random() * 480)}ms`);
      if (i % 3 === 0) pixel.className = 'is-light';
      pixels.push(pixel);
    }
    aura.replaceChildren(...pixels);
    aura.classList.remove('is-on'); void aura.offsetWidth; aura.classList.add('is-on');
  }
  function renderLevel(previous) {
    const levels = fighters[selected].levels;
    const now = levels[level - 1];
    counters.forEach(cancelAnimationFrame); counters = [];
    renderLevelBadge(badge, level, { className: 'level-badge--framed about-level-badge', ariaLabel: `Level ${level}` });
    for (const stat of STATS) {
      const box = panel().querySelector(`[data-stat="${stat}"]`);
      const value = now[STAT_FIELD[stat]];
      const fill = box.querySelector('[data-stat-fill]');
      const gain = box.querySelector('[data-stat-gain]');
      fill.classList.toggle('is-stat-leveling', !!previous);
      fill.style.width = `${(value / max[stat]) * 100}%`;
      if (previous) {
        countTo(box.querySelector('[data-stat-value]'), previous[STAT_FIELD[stat]], value);
        gain.textContent = `+${value - previous[STAT_FIELD[stat]]}`;
        gain.classList.remove('is-shown'); void gain.offsetWidth; gain.classList.add('is-shown');
      } else {
        box.querySelector('[data-stat-value]').textContent = value;
        gain.classList.remove('is-shown');
      }
    }
    const maxed = level >= levels.length;
    const button = panel().querySelector('[data-upgrade-button]');
    const label = button.querySelector('[data-upgrade-label]');
    const price = button.querySelector('[data-upgrade-price]');
    const cost = button.querySelector('[data-upgrade-cost]');
    label.textContent = maxed ? 'Max level' : 'Level up';
    cost.hidden = maxed;
    if (!maxed) price.textContent = now.price.toLocaleString('en-US');
    button.setAttribute('aria-label', maxed ? 'Back to level 1' : `Level up for ${now.price} coins`);
    if (previous) {
      levelWrap.classList.remove('is-leveling'); void levelWrap.offsetWidth; levelWrap.classList.add('is-leveling');
      flare();
      statusLine.textContent = `${fighters[selected].name} reached level ${level}.`;
    }
  }
  function select(key, { focus = false, animate = true } = {}) {
    if (key === selected && animate) return;
    selected = key; level = 1;
    tabs.forEach(tab => {
      const on = tab.dataset.fighter === key;
      tab.classList.toggle('selected', on);
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    for (const article of root.querySelectorAll('[role="tabpanel"]')) {
      const on = article.id === `fighter-${key}`;
      article.classList.toggle('is-active', on);
      article.toggleAttribute('inert', !on);
      if (on) article.removeAttribute('aria-hidden'); else article.setAttribute('aria-hidden', 'true');
    }
    changeStage(key, animate && !reducedMotion);
    renderLevel(null);
  }
  function levelUp() {
    const levels = fighters[selected].levels;
    if (level >= levels.length) { level = 1; renderLevel(null); return; }
    const previous = levels[level - 1];
    level += 1;
    renderLevel(previous);
  }
  // Until someone takes over, the demo levels each Bro up, then moves on.
  function schedule() {
    clearTimeout(timer);
    if (!auto || !inView || document.hidden) return;
    const maxed = level >= fighters[selected].levels.length;
    timer = setTimeout(() => {
      if (maxed) select(keys[(keys.indexOf(selected) + 1) % keys.length]);
      else levelUp();
      schedule();
    }, maxed ? AUTO_HOLD_MS : AUTO_STEP_MS);
  }
  function takeOver() { auto = false; clearTimeout(timer); }

  const tablist = root.querySelector('[role="tablist"]');
  tablist.addEventListener('click', event => {
    const tab = event.target.closest('[role="tab"]');
    if (!tab) return;
    takeOver(); select(tab.dataset.fighter);
  });
  tablist.addEventListener('keydown', event => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault(); takeOver();
    select(keys[(keys.indexOf(selected) + step + keys.length) % keys.length], { focus: true });
  });
  root.addEventListener('click', event => {
    if (!event.target.closest('[data-upgrade-button]')) return;
    takeOver(); levelUp();
  });
  const observer = new IntersectionObserver(entries => {
    inView = entries[0].isIntersecting;
    sprite.setRunning(inView && !document.hidden);
    schedule();
  }, { threshold: 0.35 });
  observer.observe(root);
  document.addEventListener('visibilitychange', () => { sprite.setRunning(inView && !document.hidden); schedule(); });
  select(selected, { animate: false });
}
