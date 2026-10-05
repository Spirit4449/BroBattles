const PLACEHOLDERS = [
  'How does matchmaking work?',
  'Can I rejoin a battle?',
  'How do trophies work?',
  'What does leveling up do?',
  'How can I play with friends?',
];

const normalize = (value) => String(value || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
const words = (value) => normalize(value).split(' ').filter(Boolean);

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(previous[j] + 1, previous[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1));
      diagonal = above;
    }
  }
  return previous[b.length];
}

function wordSimilarity(queryWord, candidate) {
  if (candidate === queryWord) return 1;
  if (candidate.startsWith(queryWord) || queryWord.startsWith(candidate)) return .88;
  const longest = Math.max(queryWord.length, candidate.length);
  if (longest < 4) return 0;
  return Math.max(0, 1 - editDistance(queryWord, candidate) / longest);
}

function scoreDocument(document, query) {
  const clean = normalize(query);
  if (!clean) return 1;
  const title = normalize(document.title);
  const summary = normalize(document.summary);
  const category = normalize(document.category);
  const content = normalize(document.content);
  const haystack = `${title} ${summary} ${category} ${content}`;
  let score = title.includes(clean) ? 8 : summary.includes(clean) ? 6 : content.includes(clean) ? 4 : 0;
  const haystackWords = words(haystack);
  for (const token of words(clean)) {
    let best = 0;
    for (const candidate of haystackWords) {
      best = Math.max(best, wordSimilarity(token, candidate));
      if (best === 1) break;
    }
    if (best >= .72) score += best * (title.split(' ').includes(token) ? 3 : 1.35);
    else score -= 1.5;
  }
  return score;
}

function excerpt(document, query) {
  const content = String(document.content || '');
  const tokens = words(query).filter((token) => token.length > 2);
  let index = -1;
  for (const token of tokens) {
    index = normalize(content).indexOf(token);
    if (index >= 0) break;
  }
  if (index < 0) return document.summary;
  const start = Math.max(0, index - 54);
  const end = Math.min(content.length, index + 120);
  return `${start ? '…' : ''}${content.slice(start, end).trim()}${end < content.length ? '…' : ''}`;
}

function highlight(node, query) {
  const title = node.dataset.originalTitle || node.textContent;
  node.dataset.originalTitle = title;
  node.replaceChildren();
  const tokens = words(query).filter((token) => token.length > 1).sort((a, b) => b.length - a.length);
  if (!tokens.length) return node.append(title);
  const pattern = new RegExp(`(${tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'ig');
  for (const part of title.split(pattern)) {
    if (tokens.includes(part.toLowerCase())) {
      const mark = document.createElement('mark'); mark.textContent = part; node.append(mark);
    } else node.append(part);
  }
}

export function initializeHelpSearch() {
  const input = document.getElementById('help-search');
  const data = document.getElementById('help-search-documents');
  if (!input || !data) return;
  let documents;
  try { documents = JSON.parse(data.textContent); } catch (_) { return; }
  const bySlug = new Map(documents.map((document) => [document.slug, document]));
  const links = new Map([...document.querySelectorAll('[data-help-slug]')].map((link) => {
    const summary = link.querySelector('small');
    if (summary) summary.dataset.originalSummary = summary.textContent;
    return [link.dataset.helpSlug, link];
  }));
  const status = document.getElementById('help-search-status');
  const empty = document.getElementById('help-empty');
  const statusCount = document.createElement('span');
  const finding = document.createElement('span');
  const findingIcon = document.createElement('i');
  const findingLabel = document.createTextNode('');
  finding.className = 'site-ai-finding';
  finding.setAttribute('aria-label', 'Finding results');
  findingIcon.setAttribute('aria-hidden', 'true');
  finding.append(findingIcon, findingLabel);
  finding.hidden = true;
  status.replaceChildren(statusCount, finding);
  let request = null;
  let debounce = null;
  let placeholderIndex = 0;

  const render = (query, localMatches, aiMatches = [], aiAvailable = null) => {
    const aiBySlug = new Map(aiMatches.map((match, index) => [match.slug, { ...match, index }]));
    const ranked = [...new Set([...aiMatches.map((match) => match.slug), ...localMatches.map((match) => match.slug)])];
    const rank = new Map(ranked.map((slug, index) => [slug, index]));
    let visible = 0;
    for (const [slug, link] of links) {
      const show = !query || rank.has(slug);
      link.hidden = !show;
      link.classList.toggle('is-search-match', !!query && show);
      link.classList.toggle('is-ai-match', aiBySlug.has(slug));
      link.style.order = show ? String(rank.get(slug) ?? 0) : '';
      const title = link.querySelector('strong');
      const summary = link.querySelector('small');
      highlight(title, query);
      if (summary) summary.textContent = query
        ? (aiBySlug.has(slug) ? summary.dataset.originalSummary : excerpt(bySlug.get(slug), query))
        : summary.dataset.originalSummary;
      if (show) visible++;
    }
    for (const category of document.querySelectorAll('[data-help-category]')) {
      const count = category.querySelectorAll('[data-help-slug]:not([hidden])').length;
      category.hidden = !count;
      category.classList.toggle('has-search-match', !!query && count > 0);
    }
    const isFinding = !!query && aiAvailable === null;
    empty.hidden = visible > 0 || !query || isFinding;
    statusCount.textContent = query && visible > 0 ? `${visible} ${visible === 1 ? 'answer' : 'answers'} found` : '';
    findingLabel.data = isFinding && visible === 0 ? 'Finding results' : '';
    finding.hidden = !isFinding;
  };

  const run = () => {
    const query = input.value.trim();
    clearTimeout(debounce);
    request?.abort();
    const localMatches = query ? documents
      .map((document) => ({ slug: document.slug, score: scoreDocument(document, query) }))
      .filter((match) => match.score >= Math.max(1.4, words(query).length * .4))
      .sort((a, b) => b.score - a.score) : documents.map((document) => ({ slug: document.slug, score: 1 }));
    render(query, localMatches, [], query.length >= 2 ? null : false);
    if (query.length < 2) return;
    debounce = setTimeout(async () => {
      request = new AbortController();
      try {
        const response = await fetch('/api/site/help-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: request.signal,
        });
        if (!response.ok) throw new Error('AI search unavailable');
        const result = await response.json();
        if (input.value.trim() === query) render(query, localMatches, result.matches || [], result.available === true);
      } catch (error) {
        if (error.name !== 'AbortError' && input.value.trim() === query) render(query, localMatches, [], false);
      }
    }, 180);
  };

  input.addEventListener('input', run);
  const rotatePlaceholder = () => {
    if (input.value || document.activeElement === input) return;
    input.classList.add('is-placeholder-changing');
    setTimeout(() => {
      placeholderIndex = (placeholderIndex + 1) % PLACEHOLDERS.length;
      input.placeholder = PLACEHOLDERS[placeholderIndex];
      input.classList.remove('is-placeholder-changing');
    }, 180);
  };
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(rotatePlaceholder, 2600);
}

export { scoreDocument };
