// "Play with friends": a short scripted scene. A message goes out in the
// game's chat, the friend comes online and types back (in the chat header, as
// in game), joins your lobby, both ready up with the lobby's own effects, the
// party searches and the match is found. Then it loops.

import { previewRoster } from './aboutParty.mjs';

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
  const frame = lobby.querySelector('iframe');
  // Give the game a landscape viewport on desktop and its responsive lobby on phones.
  new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    if (!width || !height) return;
    const scale = Math.min(0.72, width / 570, height / 680);
    frame.style.width = `${width / scale}px`;
    frame.style.height = `${height / scale}px`;
    frame.style.transform = `scale(${scale})`;
  }).observe(lobby);
  let timers = [], running = false;
  let scene;
  function update(patch) {
    Object.assign(scene, patch);
    frame.dataset.scene = JSON.stringify(scene);
  }

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
    scene = { bro: 'ninja', friend: 'empty', self: 'Online', found: 0 };
    update({});
    root.classList.remove('is-resetting');
  }
  const script = [
    [500, () => typeOut('yo hop on', () => add(message(ME, 'yo hop on', true)))],
    [1800, () => { setOnline(true); update({ self: 'Selecting Character' }); }],
    [800, () => { setTyping(); update({ bro: 'thorg', self: 'Online' }); }],
    [1500, () => { setOnline(true); add(message(FRIEND, 'omw. bro ball?', false)); }],
    [1000, () => typeOut('bet, invite sent', () => { add(message(ME, 'bet, invite sent', true)); update({ friend: 'invited' }); })],
    [2200, () => update({ friend: 'Online' })],
    [1500, () => update({ friend: 'Ready' })],
    [1100, () => update({ self: 'Ready' })],
    [700, () => update({ found: 2 })],
    ...previewRoster.slice(2).map((_, i) => [850, () => update({ found: i + 3 })]),
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
    add(message(ME, 'yo hop on', true)); setOnline(true); add(message(FRIEND, 'omw. bro ball?', false));
    update({ bro: 'thorg', self: 'Ready', friend: 'Ready', found: previewRoster.length });
    return;
  }
  new IntersectionObserver(entries => {
    const visible = entries[0].isIntersecting;
    if (visible && !running) { running = true; reset(); play(); }
    if (!visible && running) { running = false; timers.forEach(clearTimeout); timers = []; }
  }, { threshold: 0.4 }).observe(root);
}
