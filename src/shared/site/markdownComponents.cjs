// Game-specific Markdown for Help and News articles (raw HTML stays off).
//
// Inline:  {gems:50}  {coins:150}  {trophies:250}   currency with its icon
//          {path:Profile > Account > Change Name}    a highlighted click path
//          {key:Space}  {mouse:left}  {mouse:right}  keyboard and mouse inputs
// Blocks:  a blockquote starting with [!TIP], [!NOTE], [!WARNING] or [!REWARD]
//          becomes a callout.
const { escapeHtml: escape, arrowHtml: arrow } = require('./html.cjs');

const CURRENCY = {
  gems: { icon: '/assets/icons/gem.webp', one: 'gem', many: 'gems' },
  coins: { icon: '/assets/icons/coin.webp', one: 'coin', many: 'coins' },
  trophies: { icon: '/assets/icons/trophy.webp', one: 'trophy', many: 'trophies' },
};
const CALLOUTS = {
  tip: { label: 'Tip', icon: '/assets/icons/special.webp' },
  note: { label: 'Good to know', icon: '/assets/icons/menu/help.webp' },
  warning: { label: 'Heads up', icon: '/assets/ui/report-flag-pixel.png' },
  reward: { label: 'Reward', icon: '/assets/icons/trophy.webp' },
};
const TOKEN = /\{(gems|coins|trophies|path|key|mouse):([^{}]+)\}/g;
const TEXT_ARROWS = { '→': 'right', '←': 'left', '↑': 'up', '↓': 'down' };

function renderToken(kind, value) {
  const text = value.trim();
  if (CURRENCY[kind]) {
    const amount = Number(text.replace(/,/g, ''));
    if (!Number.isFinite(amount)) return escape(text);
    const unit = CURRENCY[kind];
    return `<span class="md-currency is-${kind}"><img src="${unit.icon}" width="16" height="16" alt=""/><b>${escape(amount.toLocaleString('en-US'))}</b> ${amount === 1 ? unit.one : unit.many}</span>`;
  }
  if (kind === 'path') {
    const steps = text.split('>').map(step => step.trim()).filter(Boolean);
    return `<span class="md-path">${steps.map(step => `<span>${escape(step)}</span>`).join(`${arrow('right', 'sm')}<span class="bb-visually-hidden"> then </span>`)}</span>`;
  }
  if (kind === 'key') {
    const direction = { left: 'left', right: 'right', up: 'up', down: 'down', '←': 'left', '→': 'right', '↑': 'up', '↓': 'down' }[text.toLowerCase()];
    return direction
      ? `<kbd class="md-key">${arrow(direction, 'sm')}<span class="bb-visually-hidden">${direction} arrow</span></kbd>`
      : `<kbd class="md-key">${escape(text)}</kbd>`;
  }
  if (kind === 'mouse' && ['left', 'right'].includes(text)) {
    return `<span class="md-mouse"><img src="/assets/icons/mouse_${text}.webp" width="60" height="91" alt=""/>${text === 'left' ? 'Left click' : 'Right click'}</span>`;
  }
  return escape(text);
}

// Escapes text, then swaps in components and pixel arrows (Settings → Controls).
function renderInline(content) {
  let html = '', last = 0;
  for (const match of content.matchAll(TOKEN)) {
    html += escapeWithArrows(content.slice(last, match.index)) + renderToken(match[1], match[2]);
    last = match.index + match[0].length;
  }
  return html + escapeWithArrows(content.slice(last));
}
function escapeWithArrows(text) {
  return escape(text).replace(/[→←↑↓]/g, glyph => `${arrow(TEXT_ARROWS[glyph], 'sm')}<span class="bb-visually-hidden"> then </span>`);
}

// Same content as plain words, for search indexes and summaries.
function plainComponents(markdown) {
  return String(markdown || '')
    .replace(TOKEN, (_, kind, value) => {
      if (CURRENCY[kind]) return `${value.trim()} ${kind}`;
      if (kind === 'path') return value.split('>').map(step => step.trim()).join(' then ');
      if (kind === 'mouse') return `${value.trim()} click`;
      return value.trim();
    })
    .replace(/^>[ \t]*\[!(\w+)\][ \t]*/gm, '> ');
}

function useMarkdownComponents(md) {
  md.renderer.rules.text = (tokens, index) => renderInline(tokens[index].content);
  // [!TIP] and friends turn their blockquote into a callout.
  md.core.ruler.push('bb_callouts', state => {
    const stack = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const token = state.tokens[i];
      if (token.type === 'blockquote_open') {
        const inline = state.tokens[i + 2];
        const match = inline?.type === 'inline' && inline.content.match(/^\[!(\w+)\]\s*/);
        const kind = match && CALLOUTS[match[1].toLowerCase()] ? match[1].toLowerCase() : null;
        stack.push(kind);
        if (!kind) continue;
        token.meta = { callout: kind };
        inline.content = inline.content.slice(match[0].length);
        const first = inline.children?.[0];
        if (first?.type === 'text') first.content = first.content.replace(/^\[!\w+\]\s*/, '');
        if (first?.type === 'text' && !first.content && inline.children[1]?.type === 'softbreak') inline.children.splice(0, 2);
        // A marker on its own line (before a list) leaves no empty paragraph.
        if (!inline.content.trim()) { state.tokens[i + 1].hidden = true; state.tokens[i + 3].hidden = true; inline.children = []; }
      } else if (token.type === 'blockquote_close') {
        const kind = stack.pop();
        if (kind) token.meta = { callout: kind };
      }
    }
  });
  const open = md.renderer.rules.blockquote_open || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  const close = md.renderer.rules.blockquote_close || ((tokens, index, options, _env, self) => self.renderToken(tokens, index, options));
  md.renderer.rules.blockquote_open = (tokens, index, options, env, self) => {
    const kind = tokens[index].meta?.callout;
    if (!kind) return open(tokens, index, options, env, self);
    const callout = CALLOUTS[kind];
    return `<aside class="md-callout is-${kind}"><span class="md-callout-label"><img src="${callout.icon}" width="20" height="20" alt=""/>${callout.label}</span>\n`;
  };
  md.renderer.rules.blockquote_close = (tokens, index, options, env, self) => tokens[index].meta?.callout ? '</aside>\n' : close(tokens, index, options, env, self);
  return md;
}

module.exports = { useMarkdownComponents, plainComponents, renderInline };
