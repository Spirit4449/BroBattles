import './hud.css';
import { prefersReducedMotion } from '../../../ui/domMotion';
import { ballRules } from '../../../../shared/broBall';

const TEAMS = ['team1', 'team2'];
const TEAM_NAMES = { team1: 'Blue', team2: 'Red' };
const GOAL_LAYOUTS = [
  { text: 'GOAAAAL!!', scale: x => 1 + x * 0.22, y: x => x * 0.12, tilt: x => x * 4 },
  { text: 'GOAAAAAL!', scale: x => 1.12 - x * x * 0.19, y: x => x * x * 0.56 - 0.26, tilt: x => x * 19 },
  { text: 'GOOOAL!!', scale: x => 1.04 + Math.cos(x * Math.PI) * 0.1, y: x => Math.sin(x * Math.PI) * 0.22, tilt: x => Math.cos(x * Math.PI) * 9 },
];
const GOAL_MOTIONS = [
  { name: 'rise', order: index => index },
  { name: 'drop', order: (index, last) => last - index },
  { name: 'spread', order: (index, last) => {
    const offset = index - last / 2;
    return offset <= 0 ? 2 * Math.floor(-offset) : 2 * Math.ceil(offset) - 1;
  } },
  { name: 'slide', order: (index, last) => index <= last / 2 ? index * 2 : (last - index) * 2 + 1 },
];
const LETTER_IN_MS = 210;
const LETTER_OUT_MS = 230;
const LETTER_STEP_MS = 34;
const GOAL_EXIT_MS = 1450;
const CONFETTI_COLORS = ['var(--goal-accent)', '#54f1dc', '#ffd952', '#ff7b63', '#fff8d8'];
// Full and compact labels; the stylesheet shows the compact one on narrow screens.
const labelFor = (team, yourTeam) => !yourTeam ? [TEAM_NAMES[team], TEAM_NAMES[team]]
  : yourTeam === team ? ['Your team', 'You'] : ['Enemy', 'Enemy'];

function goalConfetti() {
  return Array.from({ length: 52 }, (_, index) => {
    const paper = document.createElement('span');
    const side = index % 2 ? 1 : -1;
    paper.style.setProperty('--paper-origin', `${side * 10}vw`);
    paper.style.setProperty('--paper-x', `${side * (3 + Math.random() * 25)}vw`);
    paper.style.setProperty('--paper-y', `${-5 - Math.random() * 21}vh`);
    paper.style.setProperty('--paper-drop', `${9 + Math.random() * 22}vh`);
    paper.style.setProperty('--paper-spin', `${side * (180 + Math.random() * 580)}deg`);
    paper.style.setProperty('--paper-color', CONFETTI_COLORS[index % CONFETTI_COLORS.length]);
    paper.style.setProperty('--paper-size', `${Math.random() * 0.38 + 0.36}vmin`);
    paper.style.animationDelay = `${Math.round(Math.random() * 135 + (side > 0 ? 60 : 0))}ms`;
    paper.style.animationDuration = `${Math.round(1050 + Math.random() * 650)}ms`;
    return paper;
  });
}

function scoreConfetti() {
  const count = 20;
  return Array.from({ length: count }, (_, index) => {
    const paper = document.createElement('span');
    const spread = index / (count - 1) * 2 - 1;
    paper.style.left = `${50 + spread * 44}%`;
    paper.style.setProperty('--score-paper-x', `${spread * (28 + Math.random() * 42)}px`);
    paper.style.setProperty('--score-paper-drop', `${62 + Math.random() * 68}px`);
    paper.style.setProperty('--score-paper-spin', `${Math.sign(spread) * (160 + Math.random() * 320)}deg`);
    paper.style.setProperty('--score-paper-color', CONFETTI_COLORS[index % CONFETTI_COLORS.length]);
    paper.style.animationDelay = `${Math.round(Math.random() * 125)}ms`;
    paper.style.animationDuration = `${Math.round(650 + Math.random() * 380)}ms`;
    return paper;
  });
}

// Goal counters either side of the match clock, plus the clock itself: Bro Ball
// runs its own clock, so the server's match timer events never arrive.
export function createBroBallHud(isIntroBlocking) {
  const top = document.getElementById('battle-top-hud') || document.body;
  document.body.classList.add('bro-ball-match');
  const boxes = Object.fromEntries(TEAMS.map(team => {
    const box = document.createElement('div');
    box.className = `bro-ball-score ${team}`;
    box.setAttribute('aria-live', 'polite');
    box.innerHTML = '<strong class="bro-ball-score-value">0</strong>' +
      '<span class="bro-ball-score-label"><span class="long"></span><span class="short"></span></span>' +
      '<span class="bro-ball-score-chips" aria-hidden="true"></span>' +
      '<span class="bro-ball-score-confetti" aria-hidden="true"></span>';
    const [value, label, strip, confetti] = box.children;
    const chips = Array.from({ length: ballRules.scoreLimit }, () => document.createElement('span'));
    strip.append(...chips);
    top.append(box);
    return [team, { box, value, label, chips, confetti }];
  }));
  const banner = document.createElement('div');
  banner.className = 'bro-ball-goal-banner';
  banner.hidden = true;
  banner.innerHTML = '<div class="bro-ball-goal-flare" aria-hidden="true"></div>' +
    '<div class="bro-ball-goal-confetti" aria-hidden="true"></div>' +
    '<div class="bro-ball-goal-word" aria-hidden="true"></div>' +
    '<div class="bro-ball-goal-scorer" role="status"></div>';
  document.body.append(banner);
  const [, confetti, word, scorer] = banner.children;
  let score = null;
  let bannerTimer = null;
  let layoutIndex = Math.floor(Math.random() * GOAL_LAYOUTS.length);
  let motionIndex = 0;
  const motions = GOAL_MOTIONS.slice();
  for (let i = motions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [motions[i], motions[j]] = [motions[j], motions[i]];
  }

  function announce(team, yourTeam) {
    const { text, scale, y, tilt } = GOAL_LAYOUTS[layoutIndex];
    const motion = motions[motionIndex];
    // Three layouts and four motions produce twelve distinct combinations before repeating.
    layoutIndex = (layoutIndex + 1) % GOAL_LAYOUTS.length;
    motionIndex = (motionIndex + 1) % motions.length;
    banner.hidden = true;
    banner.dataset.team = team;
    banner.dataset.motion = motion.name;
    banner.style.setProperty('--goal-in', `${LETTER_IN_MS}ms`);
    banner.style.setProperty('--goal-out', `${LETTER_OUT_MS}ms`);
    banner.style.setProperty('--goal-exit', `${GOAL_EXIT_MS}ms`);
    confetti.replaceChildren(...(prefersReducedMotion() ? [] : goalConfetti()));
    word.replaceChildren(...Array.from(text, (letter, index) => {
      // Keep the word centered while each letter animates in its own slot.
      const last = text.length - 1;
      const x = index / last * 2 - 1;
      const glyph = document.createElement('span');
      glyph.textContent = letter;
      glyph.style.setProperty('--glyph-position', x);
      glyph.style.setProperty('--glyph-scale', scale(x));
      glyph.style.setProperty('--glyph-y', `${y(x)}em`);
      glyph.style.setProperty('--glyph-tilt', `${tilt(x)}deg`);
      glyph.style.setProperty('--glyph-delay', `${motion.order(index, last) * LETTER_STEP_MS}ms`);
      return glyph;
    }));
    // Commit the hidden state so a new score also restarts the flare.
    void banner.offsetWidth;
    banner.hidden = false;
    scorer.textContent = !yourTeam ? `${TEAM_NAMES[team]} scores`
      : yourTeam === team ? 'Your team scores' : 'Enemy scores';
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; },
      GOAL_EXIT_MS + (text.length - 1) * LETTER_STEP_MS + LETTER_OUT_MS);
  }

  function syncClock(state) {
    const hud = document.getElementById('game-timer-hud');
    const display = document.getElementById('game-timer-display');
    const label = document.getElementById('game-timer-label');
    if (!hud || !display || !label) return;
    const seconds = Math.max(0, Math.ceil(state.remainingMs / 1000));
    const time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    const golden = state.phase === 'overtime';
    display.textContent = state.practice ? '--:--' : time;
    label.textContent = state.practice ? 'Practice' : golden ? 'Golden Goal' : 'Time Remaining';
    hud.classList.toggle('bro-ball-golden', golden && !state.practice);
  }

  return {
    sync(state, yourTeam) {
      if (!state?.score) return;
      syncClock(state);
      for (const team of TEAMS) {
        const { box, value, label, chips, confetti } = boxes[team];
        const next = Number(state.score[team]) || 0;
        const previous = score?.[team];
        const scored = score !== null && next > previous && !isIntroBlocking?.();
        if (next !== previous) {
          box.classList.remove('scored');
          value.textContent = String(next);
          chips.forEach((chip, index) => {
            chip.classList.toggle('filled', index < next);
            chip.classList.toggle('just-filled', scored && index >= previous && index < next);
          });
          confetti.replaceChildren(...(scored && !prefersReducedMotion() ? scoreConfetti() : []));
        }
        const [long, short] = labelFor(team, yourTeam);
        if (label.firstChild.textContent !== long) label.firstChild.textContent = long;
        if (label.lastChild.textContent !== short) label.lastChild.textContent = short;
        box.classList.toggle('friendly', yourTeam === team);
        if (scored) {
          void box.offsetWidth;
          box.classList.add('scored');
          announce(team, yourTeam);
        }
      }
      score = { ...state.score };
    },
    destroy() {
      clearTimeout(bannerTimer);
      for (const { box } of Object.values(boxes)) box.remove();
      banner.remove();
      document.body.classList.remove('bro-ball-match');
      document.getElementById('game-timer-hud')?.classList.remove('bro-ball-golden');
    },
  };
}
