import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceSpin, attachTeamFootRing, drawPixelFootRing, footPoint, footRingColor, footRingSize, rasterizeFootRing } from '../src/client/game/players/teamFootRing.js';

function fakeScene() {
  const listeners = new Map();
  const ring = {
    visible: true, x: 0, y: 0, alpha: 1, destroyed: false,
    setDepth() { return this; }, setVisible(v) { this.visible = v; return this; },
    setPosition(x, y) { this.x = x; this.y = y; return this; }, setAlpha(a) { this.alpha = a; return this; },
    clear() {}, fillStyle() {}, fillRect() {},
    destroy() { this.destroyed = true; },
  };
  const events = {
    on(name, fn) { listeners.set(name, fn); }, off(name) { listeners.delete(name); }, once(name, fn) { listeners.set(name, fn); },
    emit(name) { listeners.get(name)?.(); }, has(name) { return listeners.has(name); },
  };
  return { ring, events, add: { graphics: () => ring } };
}

function fakeSprite() {
  const handlers = {};
  return {
    x: 100, y: 50, scaleX: 2, scaleY: 2, displayOriginX: 10, displayOriginY: 20,
    active: true, visible: true, alpha: 1,
    body: { offset: { x: 4, y: 6 }, width: 20, height: 30 },
    once(name, fn) { handlers[name] = fn; }, fire(name) { handlers[name]?.(); },
  };
}

test('the ring sits at the body bottom-centre, as Arcade places the body', () => {
  const sprite = fakeSprite();
  const foot = footPoint(sprite);
  assert.equal(foot.x, sprite.x + sprite.scaleX * (4 - 10) + 10);
  assert.equal(foot.y, sprite.y + sprite.scaleY * (6 - 20) + 30);
});

test('the ring follows the sprite and hides with it', () => {
  const scene = fakeScene(), sprite = fakeSprite();
  let dead = false;
  attachTeamFootRing(scene, sprite, { isAlly: true, hidden: () => dead });
  scene.events.emit('postupdate');
  assert.equal(scene.ring.visible, true);
  // Anchored to sprite.x like the health bar, so turning never shifts it.
  assert.equal(scene.ring.x, Math.round(sprite.x));
  sprite.x += 0.4;
  scene.events.emit('postupdate');
  assert.equal(scene.ring.x, Math.round(sprite.x));
  sprite.alpha = 0.4;
  scene.events.emit('postupdate');
  assert.equal(scene.ring.alpha, 0.4);
  sprite.alpha = 0;
  scene.events.emit('postupdate');
  assert.equal(scene.ring.visible, false);
  sprite.alpha = 1; dead = true;
  scene.events.emit('postupdate');
  assert.equal(scene.ring.visible, false);
});

test('ducking or a narrower body never resizes the ring', () => {
  const scene = fakeScene(), sprite = fakeSprite();
  const widths = [];
  scene.ring.fillRect = (_x, _y, w) => widths.push(w);
  attachTeamFootRing(scene, sprite, { isAlly: true });
  scene.events.emit('postupdate');
  const first = [...widths];
  widths.length = 0;
  sprite.body.width = 12;
  sprite.x += 30; // moving forces a redraw, which must keep the same shape
  scene.events.emit('postupdate');
  assert.ok(first.length > 0);
  assert.equal(Math.max(...widths), Math.max(...first));
});

test('the glints roll with movement and rest when the player stops', () => {
  assert.ok(advanceSpin(0, 10) < 0);
  assert.ok(advanceSpin(0, -10) > 0);
  assert.equal(advanceSpin(1, 500), 1); // teleports and respawns do not spin it
  const scene = fakeScene(), sprite = fakeSprite();
  let draws = 0;
  scene.ring.clear = () => { draws++; };
  attachTeamFootRing(scene, sprite, { isAlly: true });
  scene.events.emit('postupdate');
  const still = draws;
  scene.events.emit('postupdate');
  assert.equal(draws, still);
  sprite.x += 20;
  scene.events.emit('postupdate');
  assert.equal(draws, still + 1);
});

test('destroying the sprite removes the ring', () => {
  const scene = fakeScene(), sprite = fakeSprite();
  attachTeamFootRing(scene, sprite, { isAlly: false });
  sprite.fire('destroy');
  assert.equal(scene.ring.destroyed, true);
  assert.equal(scene.events.has('postupdate'), false);
});

test('your team and the other team get different ring colours', () => {
  assert.notEqual(footRingColor(true), footRingColor(false));
});

test('the ring is a flattened oval of grid-aligned cells, brightest along its front', () => {
  const rects = [];
  let style = null;
  const g = { fillStyle(color, alpha) { style = { color, alpha }; }, fillRect(x, y, w, h) { rects.push({ x, y, w, h, ...style }); } };
  const { width, height } = footRingSize(30, 2);
  assert.ok(width > height * 2);
  drawPixelFootRing(g, rasterizeFootRing(width, height, 2), 0x3d8bff);
  assert.ok(rects.every(r => r.x % 2 === 0 && r.y % 2 === 0 && r.h === 2));
  const team = rects.filter(r => r.color === 0x3d8bff);
  const peak = side => Math.max(...team.filter(side).map(r => r.alpha));
  assert.ok(peak(r => r.y > 0) > peak(r => r.y < 0));
});
