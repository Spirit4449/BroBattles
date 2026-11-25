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
  const ground = root.querySelector('[data-bro-ground]');
  const platform = root.querySelector('[data-bro-platform]');
  const canvas = root.querySelector('[data-bro-sprite]');
  const still = root.querySelector('[data-bro-still]');
  const sprite = createSpriteLoop(canvas, { reducedMotion });
  const levelWrap = root.querySelector('.about-bro-level');
  const badge = root.querySelector('[data-level-badge]');
  const statusLine = root.querySelector('[data-upgrade-status]');
  // Tracks compare every Bro against the strongest fully upgraded one, as in the lobby.
  const max = Object.fromEntries(STATS.map(stat => [stat, Math.max(...keys.map(key => fighters[key].levels.at(-1)[STAT_FIELD[stat]]))]));
  let selected = keys[0], level = 1, auto = !reducedMotion, inView = false, timer = 0, token = 0;

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

  function idleSheet(key) {
    return loadIdleSheet(`/assets/${key}/spritesheet.webp`, `/assets/${key}/animations.json`).catch(() => null);
  }
  async function showFighter(key) {
    const selection = ++token;
    still.src = `/assets/${key}/body.webp`;
    stage.classList.remove('is-live');
    sprite.clear();
    const sheet = await idleSheet(key);
    if (selection !== token || !sheet) return;
    sprite.show(sheet, fighters[key]);
    stage.classList.add('is-live');
  }
  function panel() { return root.querySelector(`#fighter-${selected}`); }
  function renderLevel(previous) {
    const levels = fighters[selected].levels;
    const now = levels[level - 1];
    renderLevelBadge(badge, level, { className: 'level-badge--framed about-level-badge', ariaLabel: `Level ${level}` });
    for (const stat of STATS) {
      const box = panel().querySelector(`[data-stat="${stat}"]`);
      const value = now[STAT_FIELD[stat]];
      const fill = box.querySelector('[data-stat-fill]');
      const gain = box.querySelector('[data-stat-gain]');
      fill.classList.toggle('is-stat-leveling', !!previous);
      fill.style.width = `${(value / max[stat]) * 100}%`;
      box.querySelector('[data-stat-value]').textContent = value;
      if (previous) {
        gain.textContent = `+${value - previous[STAT_FIELD[stat]]}`;
        gain.classList.remove('is-shown'); void gain.offsetWidth; gain.classList.add('is-shown');
      } else {
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
      if (!reducedMotion) levelWrap.animate([
        { transform: 'translateY(0)' }, { transform: 'translateY(-4px)', offset: 0.38 }, { transform: 'translateY(0)' },
      ], { duration: 280, easing: 'ease-out' });
      statusLine.textContent = `${fighters[selected].name} reached level ${level}.`;
    }
  }
  function select(key, { focus = false } = {}) {
    if (key === selected && token) return;
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
    statusLine.textContent = '';
    showFighter(key);
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
  for (const tab of tabs) {
    const warm = () => idleSheet(tab.dataset.fighter);
    tab.addEventListener('pointerenter', warm, { once: true });
    tab.addEventListener('focus', warm, { once: true });
  }
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
  select(selected);
}
