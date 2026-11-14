// Contact, feedback and My requests. Conversations reuse the in-game chat look
// (bb-chat-* classes from styles/chat.css), the same as the admin inbox.
import { api, element, refreshUnread } from './shell';
import { createPixelSelect } from '../ui/pixelSelect.js';
import { pixelArrow } from '../ui/pixelArrow.js';
import config from '../../shared/site/siteConfig.json';

// Ideas and opinions belong in Feedback, so support topics are all problems.
const TOPICS = [
  { value: 'account', label: 'Account' },
  { value: 'purchase', label: 'Purchase' },
  { value: 'bug', label: 'Bug or crash' },
  { value: 'gameplay', label: 'Gameplay' },
  { value: 'safety', label: 'Player safety' },
  { value: 'privacy', label: 'Privacy' },
  { value: 'other', label: 'Something else' },
];
const TOPIC_LABEL = { ...Object.fromEntries(TOPICS.map(topic => [topic.value, topic.label])), idea: 'Idea', reports: 'Player report' };
const STATUS_LABEL = { open: 'Open', in_progress: 'In progress', closed: 'Closed' };
// Each topic borrows its Help Center icon, so a request reads at a glance.
const TOPIC_ICON = { account: 'accounts', purchase: 'purchases', bug: 'troubleshooting', gameplay: 'gameplay', safety: 'safety', privacy: 'safety', reports: 'safety', idea: 'getting-started', other: 'getting-started' };
const topicIcon = category => `/assets/site/help-icons/${TOPIC_ICON[category] || 'getting-started'}.png`;
const FILTERS = [['', 'All'], ['open', 'Open'], ['in_progress', 'Active'], ['closed', 'Closed']];
const MESSAGE_MAX = 4000;
const key = () => crypto.randomUUID();

const clock = value => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
function ago(value) {
  const timestamp = new Date(value);
  const elapsed = Date.now() - timestamp;
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} h ago`;
  if (elapsed < 7 * 86_400_000) return `${Math.floor(elapsed / 86_400_000)} d ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}
function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86_400_000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(date);
}
function openedLabel(value) {
  const day = dayLabel(value);
  return ['Today', 'Yesterday'].includes(day) ? day.toLowerCase() : day;
}
function errorNode() { const node = element('p', null, 'site-error'); node.setAttribute('role', 'alert'); return node; }
function statusTag(status) { return element('span', STATUS_LABEL[status] || status, `site-status site-status-${status}`); }
function panel(title, tone = '') {
  const frame = element('section', null, `site-frame site-support-panel${tone ? ` is-${tone}` : ''}`);
  const head = element('header', null, 'site-frame-head');
  head.append(element('h2', title));
  const body = element('div', null, 'site-frame-body');
  frame.append(head, body);
  return { frame, head, body };
}
function linkButton(label, href, tone = '', direction = 'right') {
  const link = element('a', label, `pixel-menu-button site-btn${tone ? ` site-btn-${tone}` : ''}`);
  link.href = href;
  if (direction) link.append(pixelArrow(direction));
  return link;
}
function field(label, control, hint) {
  const wrap = element('div', null, 'site-field');
  const name = element('label', label);
  if (control.id) name.htmlFor = control.id;
  wrap.append(name, control);
  if (hint) wrap.append(hint);
  return wrap;
}
function messageBox(id, placeholder) {
  const textarea = element('textarea');
  textarea.id = id; textarea.name = 'message'; textarea.required = true;
  textarea.minLength = 5; textarea.maxLength = MESSAGE_MAX; textarea.rows = 6; textarea.placeholder = placeholder;
  const count = element('small', `0 / ${MESSAGE_MAX}`, 'site-field-count');
  textarea.addEventListener('input', () => { count.textContent = `${textarea.value.length} / ${MESSAGE_MAX}`; });
  return { textarea, count };
}

export function renderSubmit(root, kind) {
  const feedback = kind === 'feedback';
  const { frame, body } = panel(feedback ? 'Your feedback' : 'New request', feedback ? 'warm' : '');
  const form = element('form', null, 'site-form');
  let submissionKey = key();
  let topic;
  if (!feedback) {
    topic = createPixelSelect({ options: TOPICS, value: TOPICS[0].value, label: 'Topic', onChange: () => { submissionKey = key(); } });
    const topicField = element('div', null, 'site-field');
    topicField.append(element('span', 'Topic', 'site-field-label'), topic.element);
    form.append(topicField);
  }
  const subject = element('input');
  subject.id = `${kind}-subject`; subject.name = 'subject'; subject.required = true; subject.minLength = 3; subject.maxLength = 120; subject.autocomplete = 'off';
  subject.placeholder = feedback ? 'Sum it up in a few words' : 'What do you need help with?';
  const { textarea, count } = messageBox(`${kind}-message`, feedback ? 'What would make the game better?' : 'Tell us what happened. Include your Bro, the mode and roughly when.');
  form.append(field('Subject', subject), field(feedback ? 'Your thoughts' : 'Details', textarea, count));
  const footer = element('div', null, 'site-form-footer');
  footer.append(element('small', 'Don\'t include passwords or card details.', 'site-form-note'));
  const button = element('button', feedback ? 'Send feedback' : 'Send request', `pixel-menu-button site-btn${feedback ? ' site-btn-play' : ''}`);
  button.type = 'submit';
  button.append(pixelArrow('right'));
  footer.append(button);
  const error = errorNode();
  form.append(error, footer);
  form.addEventListener('input', () => { submissionKey = key(); });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    button.disabled = true; error.textContent = '';
    try {
      const fields = { subject: subject.value, message: textarea.value, submissionKey };
      if (topic) fields.category = topic.value;
      const result = await api(feedback ? '/api/feedback' : '/api/support/requests', fields);
      // A new request opens straight into its conversation.
      if (!feedback) { location.assign(`/help/requests?request=${encodeURIComponent(result.id)}`); return; }
      const done = panel('Sent', 'warm');
      done.body.classList.add('site-submit-success');
      done.body.setAttribute('role', 'status');
      done.body.tabIndex = -1;
      const art = element('img'); art.src = '/assets/ui/pixel-check.webp'; art.alt = ''; art.width = art.height = 56;
      const actions = element('div', null, 'site-actions');
      actions.append(linkButton('Back to the game', '/', 'play'));
      done.body.append(art, element('h3', 'Thanks for the feedback!'), element('p', 'Every note gets read by the team.'), actions);
      root.replaceChildren(done.frame);
      done.body.focus({ preventScroll: true });
    } catch (e) { error.textContent = e.message; button.disabled = false; }
  });
  body.append(form);
  root.replaceChildren(frame);
}

function signInPanel(view) {
  const feedback = view === 'feedback';
  const { frame, body } = panel(feedback ? 'Open the game first' : 'Log in for support', feedback ? 'warm' : '');
  body.classList.add('site-support-gate');
  const art = element('img'); art.src = feedback ? '/assets/icons/menu/feedback.webp' : '/assets/icons/menu/help.webp'; art.alt = ''; art.width = art.height = 56;
  const copy = element('p', feedback
    ? 'Feedback needs a game session so we can keep spam out. Open the lobby, then come back here.'
    : 'Support lives on your account, so you can come back and read our replies.');
  const actions = element('div', null, 'site-actions');
  if (feedback) actions.append(linkButton('Go to the lobby', '/', 'play'));
  else {
    const next = encodeURIComponent(location.pathname + location.search);
    actions.append(linkButton('Log in', `/login?next=${next}`), linkButton('Create account', `/signup?next=${next}`, 'quiet', ''));
  }
  body.append(art, copy, actions);
  return frame;
}

function placeholderRows(count = 3) {
  const group = element('div', null, 'site-request-skeletons');
  group.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < count; i++) {
    const row = element('div', null, 'site-request-skeleton');
    row.append(element('span', null, 'site-skeleton-title'), element('span', null, 'site-skeleton-meta'));
    group.append(row);
  }
  return group;
}

export function renderInbox(root, session) {
  root.classList.add('site-inbox');
  // The list is the lobby's Friends drawer: same header, tabs and rows.
  const listPane = element('section', null, 'bb-chat-shell bb-friends-panel site-inbox-list');
  const listHead = element('header', null, 'bb-chat-header');
  const listHeading = element('div', null, 'bb-chat-heading');
  const listCount = element('div', null, 'bb-chat-subtitle');
  listHeading.append(element('h2', 'Requests', 'bb-chat-title'), listCount);
  const create = element('a', 'New', 'pixel-menu-button site-btn site-btn-play site-inbox-new');
  create.href = '/help/contact';
  create.setAttribute('aria-label', 'New request');
  listHead.append(listHeading, create);
  const filters = element('div', null, 'bb-friends-tabs');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Filter requests');
  const filterButtons = FILTERS.map(([value, text]) => {
    const button = element('button', text, value ? '' : 'is-active');
    button.type = 'button';
    button.setAttribute('aria-pressed', String(!value));
    button.addEventListener('click', () => {
      state.status = value; state.page = 1;
      filterButtons.forEach(other => { other.classList.toggle('is-active', other === button); other.setAttribute('aria-pressed', String(other === button)); });
      loadList({ keepThread: true });
    });
    filters.append(button);
    return button;
  });
  const list = element('div', null, 'bb-friends-content site-inbox-items');
  const pager = element('div', null, 'site-inbox-pager');
  listPane.append(listHead, filters, list, pager);
  const thread = element('section', null, 'site-inbox-thread');
  thread.setAttribute('aria-live', 'polite');
  root.replaceChildren(listPane, thread);
  list.append(placeholderRows());

  const state = { page: 1, status: '', selected: Number(new URLSearchParams(location.search).get('request')) || null, generation: 0, items: [] };
  const playerIcon = `/assets/profile-icons/${session.icon || 'ninja'}.webp`;

  function showPane(pane) { root.dataset.pane = pane; }
  function emptyThread() {
    const empty = element('div', null, 'bb-chat-shell site-inbox-empty');
    const art = element('img'); art.src = '/assets/icons/chat.webp'; art.alt = ''; art.width = art.height = 48;
    empty.append(art, element('p', state.items.length ? 'Pick a request to read the conversation.' : 'No requests yet. When you contact support, the conversation shows up here.'));
    if (!state.items.length) empty.append(linkButton('Contact support', '/help/contact'));
    thread.replaceChildren(empty);
  }
  function itemButton(item) {
    const button = element('button', null, `bb-friends-row site-inbox-item${item.id === state.selected ? ' is-active' : ''}${item.unread ? ' is-unread' : ''}`);
    button.type = 'button';
    button.dataset.requestId = item.id;
    const avatar = element('span', null, 'bb-friends-avatar-wrap');
    const icon = element('img', null, 'bb-friends-avatar site-inbox-topic');
    icon.src = topicIcon(item.category); icon.alt = '';
    avatar.append(icon);
    const text = element('span', null, 'bb-friends-text');
    const sub = element('span', `${STATUS_LABEL[item.status] || item.status} · ${ago(item.updated_at)}`, `bb-friends-sub is-${item.status}`);
    text.append(element('span', item.subject, 'bb-friends-name'), sub);
    button.append(avatar, text);
    if (item.unread) { const count = element('span', '1', 'bb-friends-unread'); count.setAttribute('aria-label', 'New reply'); button.append(count); }
    button.addEventListener('click', () => open(item.id));
    return button;
  }
  async function loadList({ keepThread = false } = {}) {
    const generation = ++state.generation;
    try {
      const data = await api(`/api/support/requests?page=${state.page}${state.status ? `&status=${state.status}` : ''}`);
      if (generation !== state.generation) return;
      state.items = data.items;
      list.replaceChildren(...data.items.map(itemButton));
      listCount.textContent = `${data.total} ${data.total === 1 ? 'request' : 'requests'}`;
      if (!data.items.length) list.append(element('p', state.status ? 'Nothing in this filter.' : 'Nothing here yet.', 'bb-friends-loading site-inbox-none'));
      const pages = Math.max(1, Math.ceil(data.total / 20));
      if (pages > 1) {
        const prev = element('button', null, 'pixel-menu-button site-btn site-btn-quiet');
        const next = element('button', null, 'pixel-menu-button site-btn site-btn-quiet');
        prev.append(pixelArrow('left', 'sm')); next.append(pixelArrow('right', 'sm'));
        prev.setAttribute('aria-label', 'Newer requests'); next.setAttribute('aria-label', 'Older requests');
        prev.disabled = state.page <= 1; next.disabled = state.page >= pages;
        prev.onclick = () => { state.page -= 1; loadList(); };
        next.onclick = () => { state.page += 1; loadList(); };
        pager.replaceChildren(prev, element('span', `${state.page} / ${pages}`), next);
      } else pager.replaceChildren();
      if (keepThread) return;
      if (state.selected) open(state.selected, { keepPane: !matchMedia('(max-width: 760px)').matches });
      else { emptyThread(); showPane('list'); }
    } catch (error) {
      if (generation !== state.generation) return;
      const retry = element('button', 'Retry', 'pixel-menu-button site-btn site-btn-quiet');
      retry.onclick = loadList;
      list.replaceChildren(element('p', error.message, 'site-error'), retry);
    }
  }
  function chatMessage(message) {
    const self = message.sender !== 'admin';
    const row = element('div', null, `bb-chat-message${self ? ' is-self' : ''}`);
    const avatar = element('div', null, 'bb-chat-avatar');
    const img = element('img');
    img.alt = '';
    img.src = self ? playerIcon : '/assets/logos/logo-small.webp';
    img.onerror = () => { img.onerror = null; img.src = '/assets/profile-icons/ninja.webp'; };
    avatar.append(img);
    const bubble = element('div', null, 'bb-chat-bubble');
    const header = element('div', null, 'bb-chat-message-header');
    const author = element('span', self ? 'You' : 'Bro Battles Support', 'bb-chat-author');
    header.append(author, element('span', clock(message.created_at), 'bb-chat-time'));
    bubble.append(header, element('div', message.body, 'bb-chat-body-text'));
    if (self) row.append(bubble, avatar); else row.append(avatar, bubble);
    return row;
  }
  function composer(id, request) {
    const form = element('form', null, 'bb-chat-composer');
    if (request.status === 'closed') form.append(element('p', 'This request is closed. Replying opens it again.', 'site-inbox-closed'));
    const row = element('div', null, 'bb-chat-input-row');
    const text = element('textarea', null, 'bb-chat-textarea');
    text.name = 'message'; text.maxLength = MESSAGE_MAX; text.rows = 1;
    text.placeholder = 'Write a reply…';
    text.setAttribute('aria-label', 'Reply');
    const send = element('button', 'Send', 'bb-chat-send');
    send.type = 'submit';
    row.append(text, send);
    const error = errorNode();
    form.append(row, error);
    let submissionKey = key();
    const grow = () => { text.style.height = 'auto'; text.style.height = `${Math.min(140, text.scrollHeight + 4)}px`; };
    text.addEventListener('input', () => { submissionKey = key(); error.textContent = ''; grow(); });
    text.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); form.requestSubmit(); }
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      const message = text.value.trim();
      if (message.length < 5) { error.textContent = 'Replies need at least 5 characters.'; return; }
      send.disabled = true;
      try {
        await api(`/api/support/requests/${id}/messages`, { message, submissionKey });
        await open(id, { keepPane: true, focusComposer: true });
        loadListQuietly();
      } catch (e) { error.textContent = e.message; send.disabled = false; }
    });
    return form;
  }
  async function loadListQuietly() {
    try {
      const data = await api(`/api/support/requests?page=${state.page}${state.status ? `&status=${state.status}` : ''}`);
      state.items = data.items;
      list.replaceChildren(...data.items.map(itemButton));
    } catch (_) { /* The open conversation is still current. */ }
  }
  async function open(id, { keepPane = false, focusComposer = false } = {}) {
    state.selected = id;
    const url = new URL(location.href);
    url.searchParams.set('request', id);
    history.replaceState(null, '', url);
    list.querySelectorAll('.site-inbox-item').forEach(node => node.classList.toggle('is-active', Number(node.dataset.requestId) === id));
    thread.setAttribute('aria-busy', 'true');
    try {
      const { request, messages } = await api(`/api/support/requests/${id}`);
      if (state.selected !== id) return;
      refreshUnread();
      const card = list.querySelector(`[data-request-id="${id}"]`);
      card?.classList.remove('is-unread');
      card?.querySelector('.bb-friends-unread')?.remove();
      const shell = element('div', null, 'bb-chat-shell site-inbox-chat');
      const header = element('div', null, 'bb-chat-header');
      const back = element('button', null, 'bb-friends-back site-inbox-back');
      back.type = 'button';
      back.setAttribute('aria-label', 'Back to requests');
      back.append(element('span', null, 'bb-friends-back-icon'));
      back.onclick = () => showPane('list');
      const heading = element('div', null, 'bb-chat-heading site-inbox-heading');
      heading.append(element('h2', request.subject, 'bb-chat-title'), element('div', `#${request.id} · ${TOPIC_LABEL[request.category] || request.category} · Opened ${openedLabel(request.created_at)}`, 'bb-chat-subtitle'));
      header.append(back, heading, statusTag(request.status));
      const log = element('div', null, 'bb-chat-messages');
      let lastDay = '';
      for (const message of messages) {
        const day = dayLabel(message.created_at);
        if (day !== lastDay) { const divider = element('div', null, 'bb-chat-divider'); divider.append(element('span', day)); log.append(divider); lastDay = day; }
        log.append(chatMessage(message));
      }
      if (!messages.some(message => message.sender === 'admin')) log.append(element('p', 'We\'ve got your request. Replies show up right here.', 'site-inbox-waiting'));
      const reply = composer(id, request);
      shell.append(header, log, reply);
      thread.replaceChildren(shell);
      log.scrollTop = log.scrollHeight;
      if (!keepPane) showPane('thread');
      if (focusComposer) reply.querySelector('textarea')?.focus({ preventScroll: true });
    } catch (error) {
      if (state.selected !== id) return;
      state.selected = null;
      const failed = element('div', null, 'bb-chat-shell site-inbox-empty');
      failed.append(element('p', error.message, 'site-error'));
      thread.replaceChildren(failed);
    } finally { thread.removeAttribute('aria-busy'); }
  }
  showPane(state.selected ? 'thread' : 'list');
  loadList();
}

export async function initializeSupportPage() {
  const root = document.getElementById('support-app');
  if (!root) return;
  const view = root.dataset.view;
  const session = await refreshUnread();
  if (!session) {
    const { frame, body } = panel('Support is offline');
    body.append(element('p', `Refresh to try again, or email ${config.supportEmail}.`));
    root.replaceChildren(frame);
    return;
  }
  if (view === 'feedback') {
    if (session.guest || session.member) renderSubmit(root, 'feedback');
    else root.replaceChildren(signInPanel(view));
    return;
  }
  if (!session.member) { root.replaceChildren(signInPanel(view)); return; }
  if (view === 'contact') renderSubmit(root, 'support');
  else renderInbox(root, session);
}
