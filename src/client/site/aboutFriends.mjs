// "Play with friends": a short scripted scene. A message goes out in the
// game's chat, the friend comes online and types back (in the chat header, as
// in game), joins your lobby, both ready up with the lobby's own effects, the
// party searches and the match is found. Then it loops.
import { applyLobbyStatusVisualState, playLobbySpawnAnimation } from '../lobby/party/slotEffects.js';

const ME = { name: 'You', icon: '/assets/profile-icons/thorg.webp' };
const FRIEND = { name: 'ArrowRain', icon: '/assets/profile-icons/sparrow.webp' };

function clock() {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(Date.now());
}
function message(author, text, self) {
  const row = document.createElement('div');
  row.className = `bb-chat-message about-scene-in${self ? ' is-self' : ''}`;
  const avatar = document.createElement('div');
  avatar.className = 'bb-chat-avatar';
  const img = document.createElement('img'); img.src = author.icon; img.alt = '';
  avatar.append(img);
  const bubble = document.createElement('div');
  bubble.className = 'bb-chat-bubble';
  const header = document.createElement('div');
  header.className = 'bb-chat-message-header';
  const name = document.createElement('span'); name.className = 'bb-chat-author'; name.textContent = author.name;
  const time = document.createElement('span'); time.className = 'bb-chat-time'; time.textContent = clock();
  header.append(name, time);
  const body = document.createElement('div'); body.className = 'bb-chat-body-text'; body.textContent = text;
  bubble.append(header, body);
  if (self) row.append(bubble, avatar); else row.append(avatar, bubble);
  return row;
}

export function initializeAboutFriends(root = document.querySelector('[data-friends-scene]')) {
  if (!root) return;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const log = root.querySelector('[data-scene-log]');
  const input = root.querySelector('[data-scene-input]');
  const presence = root.querySelector('[data-scene-presence]');
  const chatStatus = root.querySelector('[data-scene-chat-status]');
  const lobby = root.querySelector('[data-scene-lobby]');
  const slots = { you: root.querySelector('[data-lobby-slot="you"]'), friend: root.querySelector('[data-lobby-slot="friend"]') };
  const ready = root.querySelector('[data-scene-ready]');
  let timers = [], running = false;

  const add = node => { log.append(node); log.scrollTop = log.scrollHeight; };
  const setOnline = on => {
    presence.classList.toggle('is-online', on);
    presence.classList.toggle('is-offline', !on);
    chatStatus.classList.remove('is-typing');
    chatStatus.textContent = on ? 'Online' : 'Offline';
  };
  // The in-game header typing line: a blinking pixel dot and who is typing.
  const setTyping = () => {
    chatStatus.classList.add('is-typing');
    chatStatus.innerHTML = '<span class="bb-chat-typing-dot" aria-hidden="true"></span><span class="bb-chat-typing-text"></span>';
    chatStatus.querySelector('.bb-chat-typing-text').textContent = `${FRIEND.name} is typing`;
  };
  const LABELS = { empty: 'Invite', invited: 'Invited', online: 'Online', ready: 'Ready' };
  // Seats change state the lobby's way: the join beam, then ready bursts.
  const setSeat = (side, state, { animate = true } = {}) => {
    const slot = slots[side];
    const previous = slot.dataset.state;
    slot.dataset.state = state;
    slot.querySelector('[data-lobby-status]').textContent = LABELS[state];
    if (!animate) return;
    if (state === 'online' && previous === 'invited') playLobbySpawnAnimation(slot, 'enter');
    if (state === 'ready') applyLobbyStatusVisualState(slot, 'online', 'ready');
  };
  const setReady = (state, text) => { ready.dataset.state = state; ready.textContent = text; };
  // Type into the composer, then send.
  const typeOut = (text, then) => {
    input.textContent = '';
    [...text].forEach((character, i) => timers.push(setTimeout(() => { input.textContent += character; }, i * 55)));
    timers.push(setTimeout(() => { input.textContent = ''; then(); }, text.length * 55 + 250));
  };
  function reset() {
    log.replaceChildren();
    input.textContent = '';
    setOnline(false);
    setSeat('you', 'online', { animate: false });
    setSeat('friend', 'empty', { animate: false });
    setReady('idle', 'Ready');
    lobby.classList.remove('is-matched');
  }
  const script = [
    [500, () => typeOut('yo hop on', () => add(message(ME, 'yo hop on', true)))],
    [1800, () => setOnline(true)],
    [800, setTyping],
    [1500, () => { setOnline(true); add(message(FRIEND, 'omw. bank bust?', false)); }],
    [1000, () => typeOut('bet, invite sent', () => { add(message(ME, 'bet, invite sent', true)); setSeat('friend', 'invited'); })],
    [2200, () => setSeat('friend', 'online')],
    [1500, () => setSeat('friend', 'ready')],
    [1100, () => { setReady('pressed', 'Ready'); setSeat('you', 'ready'); }],
    [700, () => setReady('searching', 'Searching')],
    [2300, () => { setReady('found', 'Match found'); lobby.classList.add('is-matched'); }],
    [3400, () => root.classList.add('is-resetting')],
    [400, () => { root.classList.remove('is-resetting'); reset(); play(); }],
  ];
  function play() {
    timers.forEach(clearTimeout); timers = [];
    let at = 0;
    for (const [delay, step] of script) { at += delay; timers.push(setTimeout(step, at)); }
  }
  reset();
  // Reduced motion shows the finished moment instead of playing it.
  if (reduced) {
    add(message(ME, 'yo hop on', true)); setOnline(true); add(message(FRIEND, 'omw. bank bust?', false));
    setSeat('friend', 'ready', { animate: false }); setSeat('you', 'ready', { animate: false }); setReady('searching', 'Searching');
    return;
  }
  new IntersectionObserver(entries => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; reset(); play(); }
    if (!visible && running) { running = false; timers.forEach(clearTimeout); timers = []; }
  }, { threshold: 0.4 }).observe(root);
}
