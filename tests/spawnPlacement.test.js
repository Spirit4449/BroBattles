const test = require('node:test');
const assert = require('node:assert/strict');
const { getDuelGeometry, spawnForParticipant, characterBody } = require('../src/shared/duelGeometry');
const { resolveLanding } = require('../src/shared/spawnPlacement');
const frames = require('../src/shared/characterFrames.json');

test('every map, character, facing, team and slot has solid support and clearance', () => {
  for (let map = 1; map <= 4; map++) for (const char of Object.keys(frames)) {
    for (const flip of [false, true]) for (const team of ['team1', 'team2']) {
      for (let size = 1; size <= 3; size++) for (let i = 0; i < size; i++) {
        const g = getDuelGeometry(map);
        const b = characterBody(char, flip);
        const p = spawnForParticipant(g, { char_class: char, flip, team }, i, size);
        const cx = p.x + b.offsetX, bottom = p.y + b.offsetY + b.halfHeight;
        const label = `${map}/${char}/${flip}/${team}/${size}/${i}`;
        assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), label);
        assert.ok(g.colliders.some(c => c.collision.up && Math.abs(c.top - bottom - 2) < 0.001 && cx - b.halfWidth >= c.left && cx + b.halfWidth <= c.right), label);
        assert.ok(!g.colliders.some(c => cx + b.halfWidth > c.left && cx - b.halfWidth < c.right && bottom > c.top && bottom - b.height < c.bottom), label + ' intersects geometry');
      }
    }
  }
});

test('disabled decorative anchors and embedded coordinates resolve to a clear surface', () => {
  const surface = { left: 100, right: 250, top: 200, bottom: 400, collision: { up: true } };
  const decoration = { left: 0, right: 400, top: 0, bottom: 500, enabled: false };
  const p = resolveLanding({ x: 249, y: 260 }, decoration, [decoration, surface], { width: 40, height: 60 });
  assert.equal(p.surface, surface);
  assert.equal(p.x, 228);
  assert.equal(p.y, 198);
});

test('invalid maps fail explicitly instead of spawning in the void', () => {
  assert.throws(() => resolveLanding({}, null, [], { width: 40, height: 60 }), /walkable/);
});
