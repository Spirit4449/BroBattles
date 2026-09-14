import { playSound } from '../lib/uiSounds.js';

// Move the real card so its layout, artwork, and inherited styles stay intact.
export function createPartySlotDrag({ canMove, move, render, onError }) {
  let drag = null;
  let pending = false;
  let deferred = null;
  let suppressClickUntil = 0;
  const placementOrigins = new Map();
  const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const slots = () => [...document.querySelectorAll('#lobby-area .character-slot:not(.party-seat-silhouette)')].filter(el => el.getClientRects().length);
  const announce = message => {
    let live = document.getElementById('party-slot-announcement');
    if (!live) {
      live = document.createElement('div');
      live.id = 'party-slot-announcement';
      live.className = 'party-slot-announcement';
      live.setAttribute('role', 'status');
      document.body.append(live);
    }
    live.textContent = message;
  };
  function targetAt(x, y) {
    return slots().find(slot => {
      const r = drag?.seatRects.get(slot) || slot.getBoundingClientRect();
      return x >= r.left - 22 && x <= r.right + 22 && y >= r.top - 24 && y <= r.bottom + 24;
    });
  }
  function select(target) {
    if (target?.dataset.botCharacter) target = null;
    if (drag.target === target) return;
    drag.target?.classList.remove('party-drop-target');
    drag.target = target;
    target?.classList.add('party-drop-target');
    if (target) {
      playSound('cursor3', 0.16);
      announce(`${target.dataset.playerName && target !== drag.source ? 'Swap with ' + target.dataset.playerName : 'Move to ' + target.dataset.slotLabel}. Release to place; Escape to cancel.`);
    }
  }
  function start(source, x, y, pointerId = null) {
    const rect = source.getBoundingClientRect();
    const seatRects = new Map(slots().map(slot => [slot, slot.getBoundingClientRect()]));
    const platform = source.closest('.platform');
    let silhouette = null;
    if (platform) {
      const platformRect = platform.getBoundingClientRect();
      silhouette = source.cloneNode(true);
      silhouette.removeAttribute('id');
      silhouette.removeAttribute('tabindex');
      silhouette.removeAttribute('aria-label');
      silhouette.removeAttribute('title');
      delete silhouette.dataset.playerName;
      delete silhouette.dataset.slotMovable;
      silhouette.querySelectorAll('[id]').forEach(node => node.removeAttribute('id'));
      silhouette.querySelectorAll('.lobby-spawn-fx, .lobby-ready-fx, .lobby-selecting-ring').forEach(node => node.remove());
      silhouette.classList.remove('lobby-spawn-enter', 'lobby-spawn-exit', 'character-splash');
      silhouette.classList.add('party-seat-silhouette');
      silhouette.setAttribute('aria-hidden', 'true');
      silhouette.inert = true;
      Object.assign(silhouette.style, {
        position: 'absolute',
        left: `${rect.left - platformRect.left}px`,
        top: `${rect.top - platformRect.top}px`,
        width: `${rect.width}px`, height: `${rect.height}px`,
        boxSizing: 'border-box', margin: '0', transform: 'none', translate: 'none',
      });
      platform.append(silhouette);
    }
    // Animate the cards independently of sprite idle/spawn animation rules.
    const shakes = reducedMotion() ? [] : slots().filter(slot => slot.dataset.playerName).map(slot =>
      slot.animate([
        { rotate: '-2.5deg' }, { rotate: '2.5deg' }, { rotate: '-2.5deg' },
      ], { duration: slot === source ? 260 : 340, iterations: Infinity, easing: 'ease-in-out' }),
    );
    drag = { source, x, y, pointerId, target: null, seatRects, rect, silhouette, shakes };
    source.classList.add('party-drag-source');
    source.closest('.platform')?.classList.add('party-drag-platform');
    document.body.classList.add('party-dragging');
    playSound('cursor4', 0.3);
    select(source);
  }
  async function finish(cancel = false) {
    if (!drag) return;
    const { source, target, pointerId, rect, silhouette, shakes } = drag;
    shakes.forEach(animation => animation.cancel());
    const playerName = source.dataset.playerName;
    drag = null;
    pending = true;
    suppressClickUntil = Date.now() + 300;
    document.body.classList.remove('party-dragging');
    target?.classList.remove('party-drop-target');
    let settleAnimation = null;
    try {
      if (!cancel && target && target !== source && canMove()) {
        const r = target.getBoundingClientRect();
        const from = source.style.translate || '0px 0px';
        const to = `${r.left - rect.left}px ${r.top - rect.top}px`;
        source.style.translate = to;
        const settle = settleAnimation = source.animate([{ translate: from }, { translate: to }], {
          duration: reducedMotion() ? 0 : 180, easing: 'cubic-bezier(.2,.8,.2,1)',
        });
        announce('Saving party positions…');
        await Promise.all([move(playerName, target), settle.finished]);
        playSound('click', 0.35, { playbackRate: 1.2 });
        announce('Party positions updated.');
      } else {
        playSound('cancel2', 0.2);
        announce('Move canceled.');
      }
    } catch (error) {
      playSound('error', 0.25);
      announce(error.message);
      onError(error.message);
    } finally {
      // Carry the actual release/settled position into the roster commit. This
      // prevents the old seat from becoming the animation origin a second time.
      if (deferred) placementOrigins.set(playerName.toLowerCase(), source.getBoundingClientRect());
      if (!deferred && source.style.translate && !reducedMotion()) {
        const current = getComputedStyle(source).translate;
        settleAnimation?.cancel();
        source.style.translate = '0px 0px';
        await source.animate([{ translate: current }, { translate: '0px 0px' }], { duration: 160, easing: 'ease-out' }).finished.catch(() => {});
      }
      settleAnimation?.cancel();
      silhouette?.remove();
      source.style.translate = '';
      source.classList.remove('party-drag-source');
      source.closest('.platform')?.classList.remove('party-drag-platform');
      pending = false;
      if (deferred) { const latest = deferred; deferred = null; render(latest); }
      sync();
      if (pointerId == null) slots().find(slot => slot.dataset.playerName === playerName)?.focus();
    }
  }
  let press = null;
  document.addEventListener('pointerdown', event => {
    const source = event.target.closest?.('#lobby-area .character-slot:not(.party-seat-silhouette)');
    if (!source?.dataset.playerName || !canMove() || pending || drag || event.button !== 0) return;
    if (event.target.closest('.status, .switch-character')) return;
    press = { source, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    source.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointermove', event => {
    if (!press || event.pointerId !== press.pointerId) return;
    if (!drag && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6) start(press.source, press.x, press.y, press.pointerId);
    if (!drag) return;
    event.preventDefault();
    drag.source.style.translate = `${event.clientX - drag.x}px ${event.clientY - drag.y}px`;
    select(targetAt(event.clientX, event.clientY));
  }, { passive: false });
  document.addEventListener('pointerup', event => {
    if (event.pointerId !== press?.pointerId) return;
    press = null;
    void finish();
  });
  document.addEventListener('pointercancel', () => { press = null; void finish(true); });
  window.addEventListener('blur', () => { press = null; void finish(true); });
  document.addEventListener('dragstart', event => {
    if (event.target.closest?.('.character-slot[data-slot-movable="true"]')) event.preventDefault();
  });
  document.addEventListener('click', event => {
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && drag) { event.preventDefault(); press = null; void finish(true); return; }
    const handle = event.target.matches?.('.character-slot[data-slot-movable="true"]') ? event.target : null;
    if (!handle || !canMove() || pending) return;
    if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault();
      if (drag) void finish();
      else { const source = handle.closest('.character-slot'); const r = source.getBoundingClientRect(); start(source, r.left, r.top); }
    } else if (drag && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
      event.preventDefault();
      const choices = slots().filter(slot => !slot.dataset.botCharacter);
      const direction = ['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1;
      select(choices[(choices.indexOf(drag.target) + direction + choices.length) % choices.length]);
    }
  });
  function sync() {
    for (const slot of slots()) {
      const movable = canMove() && !!slot.dataset.playerName && !pending;
      slot.dataset.slotMovable = String(movable);
      slot.querySelector('.party-move-handle')?.remove();
      if (movable) {
        slot.tabIndex = 0;
        slot.setAttribute('aria-label', `Move ${slot.dataset.playerName}. Press Space, use arrow keys to choose a slot, then Space to place.`);
        slot.title = 'Drag to move · Space + arrow keys';
      } else {
        slot.removeAttribute('tabindex');
        slot.removeAttribute('aria-label');
        slot.removeAttribute('title');
      }
    }
  }
  return { sync, takeOrigin(name) { const origin = placementOrigins.get(name); placementOrigins.delete(name); return origin; }, defer(data) { if (!drag && !pending) return false; deferred = data; return true; } };
}
